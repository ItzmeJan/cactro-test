import { getDb } from "../../db";
import { sendEmail } from "../../services/email";

export async function handleBookingOtp(payload: { bookingId: number; otp: string }): Promise<void> {
  const row = getDb()
    .query<{ email: string; name: string; title: string }, [number]>(
      `SELECT u.email, u.name, e.title
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       JOIN events e ON e.id = b.event_id
       WHERE b.id = ?`,
    )
    .get(payload.bookingId);

  if (!row) throw new Error(`Booking ${payload.bookingId} not found`);

  await sendEmail({
    to: row.email,
    subject: `Your booking OTP for ${row.title}`,
    text: `Hi ${row.name},\n\nYour one-time code is ${payload.otp}. It expires in 10 minutes.\n\nIf you did not request this, you can ignore this email.`,
    html: `<p>Hi ${row.name},</p><p>Your one-time code is <strong>${payload.otp}</strong>. It expires in 10 minutes.</p>`,
  });
}
