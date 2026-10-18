import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { enqueue } from "../jobs/queue";
import { paginate, serializeAttendee, serializeEvent } from "../lib/serialize";
import { nowIso } from "../lib/hash";
import { requireAuth, requireRole } from "../middleware/auth";
import { parsePagination, validateJson } from "../middleware/validate";
import { reservedQuantity } from "../services/bookings";
import type { AppEnv, Attendee, EventWithOrganizer } from "../types";

const createEventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).default(""),
  location: z.string().max(500).default(""),
  startsAt: z.iso.datetime(),
  capacity: z.number().int().min(1),
});

const updateEventSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(5000).optional(),
    location: z.string().max(500).optional(),
    startsAt: z.iso.datetime().optional(),
    capacity: z.number().int().min(1).optional(),
    status: z.enum(["active", "cancelled"]).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });

const EVENT_SELECT = `
  SELECT e.id, e.organizer_id, e.title, e.description, e.location, e.starts_at,
         e.capacity, e.status, e.created_at, e.updated_at, u.name AS organizer_name
  FROM events e
  JOIN users u ON u.id = e.organizer_id
`;

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function getEvent(id: number): EventWithOrganizer | null {
  return (
    getDb().query<EventWithOrganizer, [number]>(`${EVENT_SELECT} WHERE e.id = ?`).get(id) ?? null
  );
}

export const eventRoutes = new Hono<AppEnv>();

eventRoutes.get("/", (c) => {
  const { page, limit, offset } = parsePagination(c.req.query());
  const db = getDb();
  const total =
    db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM events WHERE status = 'active'`).get()
      ?.n ?? 0;
  const rows = db
    .query<EventWithOrganizer, [number, number]>(
      `${EVENT_SELECT} WHERE e.status = 'active' ORDER BY e.starts_at ASC LIMIT ? OFFSET ?`,
    )
    .all(limit, offset);
  return c.json(paginate(rows.map(serializeEvent), page, limit, total));
});

eventRoutes.get("/:id", (c) => {
  const id = parseId(c.req.param("id"));
  if (!id) return c.json({ error: "Event not found" }, 404);
  const event = getEvent(id);
  if (!event) return c.json({ error: "Event not found" }, 404);
  return c.json(serializeEvent(event));
});

eventRoutes.post(
  "/",
  requireAuth,
  requireRole("organizer", "Only organizers can create events"),
  validateJson(createEventSchema),
  (c) => {
    const body = c.get("body") as z.infer<typeof createEventSchema>;
    if (new Date(body.startsAt).getTime() <= Date.now()) {
      return c.json({ error: "Validation failed", details: "startsAt must be in the future" }, 400);
    }

    const user = c.get("user");
    const now = nowIso();
    const result = getDb()
      .query(
        `INSERT INTO events (organizer_id, title, description, location, starts_at, capacity, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .run(user.userId, body.title, body.description, body.location, body.startsAt, body.capacity, now, now);

    const event = getEvent(Number(result.lastInsertRowid));
    return c.json(serializeEvent(event!), 201);
  },
);

eventRoutes.patch(
  "/:id",
  requireAuth,
  requireRole("organizer", "Only the event organizer can update this event"),
  validateJson(updateEventSchema),
  (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Event not found" }, 404);

    const existing = getEvent(id);
    if (!existing) return c.json({ error: "Event not found" }, 404);

    const user = c.get("user");
    if (existing.organizer_id !== user.userId) {
      return c.json({ error: "Only the event organizer can update this event" }, 403);
    }

    const body = c.get("body") as z.infer<typeof updateEventSchema>;
    if (body.capacity !== undefined && body.capacity < reservedQuantity(id)) {
      return c.json(
        { error: "Validation failed", details: "capacity cannot be below confirmed/pending tickets" },
        400,
      );
    }

    const next = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      location: body.location ?? existing.location,
      starts_at: body.startsAt ?? existing.starts_at,
      capacity: body.capacity ?? existing.capacity,
      status: body.status ?? existing.status,
    };

    getDb()
      .query(
        `UPDATE events
         SET title = ?, description = ?, location = ?, starts_at = ?, capacity = ?, status = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.title,
        next.description,
        next.location,
        next.starts_at,
        next.capacity,
        next.status,
        nowIso(),
        id,
      );

    enqueue("event_update_notification", { eventId: id });
    return c.json(serializeEvent(getEvent(id)!));
  },
);

export const organizerRoutes = new Hono<AppEnv>();

organizerRoutes.get(
  "/events",
  requireAuth,
  requireRole("organizer", "Only organizers can access this"),
  (c) => {
    const user = c.get("user");
    const { page, limit, offset } = parsePagination(c.req.query());
    const db = getDb();
    const total =
      db
        .query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM events WHERE organizer_id = ?`)
        .get(user.userId)?.n ?? 0;
    const rows = db
      .query<EventWithOrganizer, [number, number, number]>(
        `${EVENT_SELECT} WHERE e.organizer_id = ? ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(user.userId, limit, offset);
    return c.json(paginate(rows.map(serializeEvent), page, limit, total));
  },
);

organizerRoutes.get(
  "/events/:id/bookings",
  requireAuth,
  requireRole("organizer", "Only the event organizer can view attendees"),
  (c) => {
    const id = parseId(c.req.param("id"));
    if (!id) return c.json({ error: "Event not found" }, 404);

    const event = getEvent(id);
    if (!event) return c.json({ error: "Event not found" }, 404);

    const user = c.get("user");
    if (event.organizer_id !== user.userId) {
      return c.json({ error: "Only the event organizer can view attendees" }, 403);
    }

    const { page, limit, offset } = parsePagination(c.req.query());
    const db = getDb();
    const total =
      db
        .query<{ n: number }, [number]>(
          `SELECT COUNT(*) AS n FROM bookings WHERE event_id = ? AND status = 'confirmed'`,
        )
        .get(id)?.n ?? 0;

    const rows = db
      .query<Attendee, [number, number, number]>(
        `SELECT b.id AS booking_id, b.user_id, u.name AS user_name, u.email AS user_email,
                b.quantity, b.status, COALESCE(b.confirmed_at, b.created_at) AS booked_at
         FROM bookings b
         JOIN users u ON u.id = b.user_id
         WHERE b.event_id = ? AND b.status = 'confirmed'
         ORDER BY b.confirmed_at ASC
         LIMIT ? OFFSET ?`,
      )
      .all(id, limit, offset);

    return c.json(paginate(rows.map(serializeAttendee), page, limit, total));
  },
);
