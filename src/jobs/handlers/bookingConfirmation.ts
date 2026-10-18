import { getDb } from "../../db";
import { sendEmail } from "../../services/email";

export async function handleBookingConfirmation(payload: { bookingId: number }): Promise<void> {
  const row = getDb()
    .query<
      { email: string; name: string; title: string; location: string; starts_at: string; quantity: number },
      [number]
    >(
      `SELECT u.email, u.name, e.title, e.location, e.starts_at, b.quantity
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       JOIN events e ON e.id = b.event_id
       WHERE b.id = ?`,
    )
    .get(payload.bookingId);

  if (!row) throw new Error(`Booking ${payload.bookingId} not found`);

  await sendEmail({
    to: row.email,
    subject: `Booking confirmed: ${row.title}`,
    text: `Hi ${row.name},\n\nYour booking for ${row.quantity} ticket(s) to ${row.title} is confirmed.\nLocation: ${row.location}\nStarts: ${row.starts_at}`,
    html: `<p>Hi ${row.name},</p><p>Your booking for <strong>${row.quantity}</strong> ticket(s) to <strong>${row.title}</strong> is confirmed.</p><p>Location: ${row.location}<br/>Starts: ${row.starts_at}</p>`,
  });
}
