import { getDb } from "../../db";
import { sendEmail } from "../../services/email";

export async function handleEventUpdateNotification(payload: { eventId: number }): Promise<void> {
  const event = getDb()
    .query<{ title: string; location: string; starts_at: string; status: string }, [number]>(
      `SELECT title, location, starts_at, status FROM events WHERE id = ?`,
    )
    .get(payload.eventId);

  if (!event) throw new Error(`Event ${payload.eventId} not found`);

  const attendees = getDb()
    .query<{ email: string; name: string }, [number]>(
      `SELECT u.email, u.name
       FROM bookings b
       JOIN users u ON u.id = b.user_id
       WHERE b.event_id = ? AND b.status = 'confirmed'`,
    )
    .all(payload.eventId);

  for (const attendee of attendees) {
    await sendEmail({
      to: attendee.email,
      subject: `Update: ${event.title}`,
      text: `Hi ${attendee.name},\n\nAn event you booked has been updated.\nTitle: ${event.title}\nLocation: ${event.location}\nStarts: ${event.starts_at}\nStatus: ${event.status}`,
      html: `<p>Hi ${attendee.name},</p><p>An event you booked has been updated.</p><p>Title: ${event.title}<br/>Location: ${event.location}<br/>Starts: ${event.starts_at}<br/>Status: ${event.status}</p>`,
    });
  }
}
