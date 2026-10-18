import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { enqueue } from "../jobs/queue";
import { nowIso } from "../lib/hash";
import { paginate, serializeBooking } from "../lib/serialize";
import { requireAuth, requireRole } from "../middleware/auth";
import { parsePagination, validateJson } from "../middleware/validate";
import { rateLimit } from "../middleware/rateLimit";
import { expireStaleBookings, reservedQuantity } from "../services/bookings";
import { generateOtp, storeOtp, verifyOtp } from "../services/otp";
import type { AppEnv, BookingWithEvent, Event } from "../types";

const bookSchema = z.object({
  quantity: z.number().int().min(1),
});

const confirmSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, "otp must be 6 digits"),
});

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export const bookingRoutes = new Hono<AppEnv>();

bookingRoutes.post(
  "/events/:id/bookings",
  requireAuth,
  requireRole("customer", "Only customers can book tickets"),
  validateJson(bookSchema),
  (c) => {
    const eventId = parseId(c.req.param("id"));
    if (!eventId) return c.json({ error: "Event not found" }, 404);

    const body = c.get("body") as z.infer<typeof bookSchema>;
    const user = c.get("user");
    const db = getDb();

    expireStaleBookings();
    const created = db.transaction(() => {
      const event = db
        .query<Event, [number]>(`SELECT * FROM events WHERE id = ?`)
        .get(eventId);
      if (!event) return { error: "not_found" as const };
      if (event.status !== "active") {
        return { error: "sold_out" as const, message: "Event is not available for booking" };
      }

      const reserved = reservedQuantity(eventId);
      if (reserved + body.quantity > event.capacity) {
        return { error: "sold_out" as const, message: "Not enough tickets available" };
      }

      const now = nowIso();
      const result = db
        .query(
          `INSERT INTO bookings (event_id, user_id, quantity, status, created_at, updated_at)
           VALUES (?, ?, ?, 'pending', ?, ?)`,
        )
        .run(eventId, user.userId, body.quantity, now, now);

      const bookingId = Number(result.lastInsertRowid);
      const otp = generateOtp();
      const expiresAt = storeOtp(bookingId, otp);
      enqueue("booking_otp", { bookingId, otp });
      return { bookingId, expiresAt };
    })();

    if ("error" in created && created.error === "not_found") {
      return c.json({ error: "Event not found" }, 404);
    }
    if ("error" in created && created.error === "sold_out") {
      return c.json({ error: created.message }, 400);
    }
    if ("bookingId" in created) {
      return c.json(
        {
          bookingId: created.bookingId,
          message: "Check your email for OTP",
          expiresAt: created.expiresAt,
        },
        201,
      );
    }
    return c.json({ error: "Failed to create booking" }, 500);
  },
);

bookingRoutes.post(
  "/bookings/:id/confirm",
  requireAuth,
  requireRole("customer", "Only customers can book tickets"),
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 5,
    key: (c) => `otp:${c.get("user").userId}:${c.req.param("id")}`,
    message: "Too many OTP attempts",
  }),
  validateJson(confirmSchema),
  (c) => {
    const bookingId = parseId(c.req.param("id"));
    if (!bookingId) return c.json({ error: "Booking not found" }, 404);

    const body = c.get("body") as z.infer<typeof confirmSchema>;
    const user = c.get("user");
    const db = getDb();

    const booking = db
      .query<{ id: number; user_id: number; status: string }, [number]>(
        `SELECT id, user_id, status FROM bookings WHERE id = ?`,
      )
      .get(bookingId);

    if (!booking) return c.json({ error: "Booking not found" }, 404);
    if (booking.user_id !== user.userId) {
      return c.json({ error: "You do not own this booking" }, 403);
    }
    if (booking.status !== "pending") {
      return c.json({ error: "Invalid or expired OTP" }, 400);
    }

    if (!verifyOtp(bookingId, body.otp)) {
      return c.json({ error: "Invalid or expired OTP" }, 400);
    }

    const confirmedAt = nowIso();
    db.query(
      `UPDATE bookings SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ?`,
    ).run(confirmedAt, confirmedAt, bookingId);
    enqueue("booking_confirmation", { bookingId });

    return c.json({
      bookingId,
      status: "confirmed",
      confirmedAt,
    });
  },
);

bookingRoutes.get(
  "/bookings/my",
  requireAuth,
  requireRole("customer", "Only customers can view their bookings"),
  (c) => {
    const user = c.get("user");
    const { page, limit, offset } = parsePagination(c.req.query());
    const db = getDb();
    const total =
      db
        .query<{ n: number }, [number]>(`SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?`)
        .get(user.userId)?.n ?? 0;
    const rows = db
      .query<BookingWithEvent, [number, number, number]>(
        `SELECT b.id, b.event_id, b.user_id, b.quantity, b.status, b.created_at, b.updated_at, b.confirmed_at,
                e.title AS event_title, e.location AS event_location, e.starts_at AS event_starts_at
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.user_id = ?
         ORDER BY b.created_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(user.userId, limit, offset);

    return c.json(paginate(rows.map(serializeBooking), page, limit, total));
  },
);
