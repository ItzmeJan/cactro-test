import { getDb } from "../db";
import { nowIso } from "../lib/hash";

export function expireStaleBookings(): void {
  const db = getDb();
  const now = nowIso();
  const stale = db
    .query<{ id: number }, [string]>(
      `SELECT b.id
       FROM bookings b
       WHERE b.status = 'pending'
         AND NOT EXISTS (
           SELECT 1 FROM otp_codes o
           WHERE o.booking_id = b.id
             AND o.used = 0
             AND o.expires_at > ?
         )`,
    )
    .all(now);

  for (const row of stale) {
    db.query(`UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now, row.id);
  }
}

export function reservedQuantity(eventId: number): number {
  const row = getDb()
    .query<{ total: number | null }, [number, string]>(
      `SELECT COALESCE(SUM(b.quantity), 0) AS total
       FROM bookings b
       WHERE b.event_id = ?
         AND (
           b.status = 'confirmed'
           OR (
             b.status = 'pending'
             AND EXISTS (
               SELECT 1 FROM otp_codes o
               WHERE o.booking_id = b.id
                 AND o.used = 0
                 AND o.expires_at > ?
             )
           )
         )`,
    )
    .get(eventId, nowIso());
  return row?.total ?? 0;
}
