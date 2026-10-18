import type {
  Attendee,
  BookingWithEvent,
  EventWithOrganizer,
  Paginated,
  PublicUser,
} from "../types";

export function serializeUser(user: PublicUser & { created_at?: string }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.created_at,
  };
}

export function serializeEvent(event: EventWithOrganizer) {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startsAt: event.starts_at,
    capacity: event.capacity,
    status: event.status,
    organizerId: event.organizer_id,
    organizerName: event.organizer_name,
    createdAt: event.created_at,
  };
}

export function serializeBooking(booking: BookingWithEvent) {
  return {
    id: booking.id,
    eventId: booking.event_id,
    eventTitle: booking.event_title,
    eventLocation: booking.event_location,
    eventStartsAt: booking.event_starts_at,
    quantity: booking.quantity,
    status: booking.status,
    createdAt: booking.created_at,
    confirmedAt: booking.confirmed_at,
  };
}

export function serializeAttendee(row: Attendee) {
  return {
    bookingId: row.booking_id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    quantity: row.quantity,
    status: row.status,
    bookedAt: row.booked_at,
  };
}

export function paginate<T>(data: T[], page: number, limit: number, total: number): Paginated<T> {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
