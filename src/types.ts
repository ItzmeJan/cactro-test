export type Role = "organizer" | "customer";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  created_at: string;
}

export interface PublicUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface Event {
  id: number;
  organizer_id: number;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  capacity: number;
  status: "active" | "cancelled";
  created_at: string;
  updated_at: string;
}

export interface EventWithOrganizer extends Event {
  organizer_name: string;
}

export type BookingStatus = "pending" | "confirmed" | "cancelled";

export interface Booking {
  id: number;
  event_id: number;
  user_id: number;
  quantity: number;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
}

export interface BookingWithEvent extends Booking {
  event_title: string;
  event_location: string;
  event_starts_at: string;
}

export interface Attendee {
  booking_id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  quantity: number;
  status: BookingStatus;
  booked_at: string;
}

export interface OtpCode {
  id: number;
  booking_id: number;
  code_hash: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

export type JobType =
  | "booking_otp"
  | "booking_confirmation"
  | "event_update_notification";

export type JobStatus = "pending" | "processing" | "completed" | "failed";

export interface Job {
  id: number;
  type: JobType;
  payload: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TokenPayload {
  userId: number;
  email: string;
  role: Role;
  jti: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export type AppEnv = {
  Variables: {
    user: TokenPayload;
    body: unknown;
  };
};
