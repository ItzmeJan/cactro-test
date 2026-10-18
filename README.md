# Event Booking System — Backend API

> **Status:** Implemented
> **Last updated:** 2026-10-18

---

## Overview

A role-based event booking backend built with **Bun**, **SQLite**, and **Nodemailer + Gmail**. Two user roles — **Event Organizers** and **Customers** — with JWT-based auth, OTP-verified booking, and background email processing for confirmations and event-update notifications.

---

## Tech Stack

| Layer | Choice | Rationale |
|---|---|---|
| Runtime | **Bun** | Fast, native TypeScript, first-class SQLite via `bun:sqlite` |
| HTTP Server | **Hono** | Lightweight, framework-agnostic, runs on Bun via `hono/bun` |
| Database | **SQLite** (`bun:sqlite`) | Zero-config, embedded, perfect for single-instance deployments |
| Email | **Nodemailer + Gmail App Password** | No domain required, no API key service, free for low-volume sends |
| Auth | **JWT** (JWA HS256) + rotating refresh tokens | Stateless access tokens, secure refresh pattern |
| Job Queue | **In-process SQLite-backed queue** | Same-process worker, no extra infra, visible job state |

---

## Design Decisions

### 1. Authentication Strategy

We use **short-lived access tokens** (15 min) + **rotating refresh tokens** (7 days, stored hashed in DB). The access token carries `role`, `userId`, and `jti` (JWT ID) so role checks are stateless. Refresh tokens rotate on every use — a stolen token can only be used once.

```
Client → POST /auth/login → { accessToken, refreshToken }
Client → Authorization: Bearer <accessToken> → protected routes
Client → POST /auth/refresh (with refreshToken) → new token pair
```

**Why JWT over session cookies?** Simpler for API-first architecture, no session store needed, works natively with mobile/SPA clients.

**Why rotating refresh tokens?** If a refresh token is stolen, the attacker can only use it once before the legitimate user gets a new one and the stolen one is invalidated.

### 2. Booking Flow (OTP-Confirmed)

Booking is a **two-step process** to prevent accidental/unconfirmed bookings:

```
1. Customer → POST /events/:id/bookings { quantity }
   → Server creates booking with status "pending"
   → Server generates 6-digit OTP, stores hashed in DB (expires in 10 min)
   → Server sends OTP email via background job
   → Returns { bookingId, message: "Check your email for OTP" }

2. Customer → POST /bookings/:id/confirm { otp }
   → Server verifies OTP (constant-time comparison)
   → On success: booking status → "confirmed"
   → Triggers confirmation email via background job
   → Returns { status: "confirmed" }
```

**Why OTP?** Ensures the customer actually owns the email address they're booking with. Prevents fake bookings and gives a paper trail.

**Why store OTP hashed?** Same principle as passwords — if DB is leaked, OTPs are useless.

### 3. Background Job Queue

We use an **in-process SQLite-backed job queue** (no Redis/BullMQ needed for this scale). A `jobs` table acts as the queue, and a worker loop polls for pending jobs.

```
jobs table: id, type, payload (JSON), status, attempts, max_attempts, last_error, created_at, updated_at

Worker loop: every 1s → SELECT * FROM jobs WHERE status='pending' AND attempts < max_attempts ORDER BY created_at LIMIT 1 → process → update status
```

**Why in-process?** Single-instance deployment on Vercel/Render/Railway. No external dependencies. If the instance restarts, pending jobs are still in SQLite and will be processed on boot.

**Job types:**
- `booking_otp` — Send OTP email to customer after booking initiation
- `booking_confirmation` — Send confirmation email after OTP verified
- `event_update_notification` — Fan-out notification to all attendees when event is updated

### 4. Event Update Notification Fan-out

When an organizer updates an event, all customers with confirmed bookings receive an email.

```
PATCH /events/:id (organizer)
  → Update event in DB
  → INSERT INTO jobs (type='event_update_notification', payload={eventId})
  → Worker picks up job → queries all confirmed bookings for that event
  → Sends notification email to each attendee
```

**Why fan-out in worker?** Could be thousands of attendees. Doing this synchronously would time out the HTTP request.

### 5. Email via Nodemailer + Gmail

We use **Gmail SMTP with an App Password** — no domain verification needed, no separate email API service.

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your-email@gmail.com>
SMTP_PASS=<16-char-app-password>
```

**Gmail limits:** 500 emails/day (consumer), 2000/day (Workspace). For stress testing, we can swap to **Mailpit** (local SMTP sink) via env var — same code, different SMTP target.

**Provider abstraction:** A single `sendEmail()` function wraps Nodemailer. Swap providers by changing env vars, not code.

### 6. Database Schema

```sql
-- Users (both roles)
users (id, email UNIQUE, password_hash, role, name, created_at)

-- Refresh tokens (hashed, rotating)
refresh_tokens (id, user_id, token_hash, expires_at, created_at)

-- Events
events (id, organizer_id, title, description, location, starts_at, capacity, status, created_at, updated_at)

-- Bookings
bookings (id, event_id, user_id, quantity, status, created_at, updated_at)
-- status: 'pending' | 'confirmed' | 'cancelled'

-- OTP codes (hashed, short-lived)
otp_codes (id, booking_id, code_hash, expires_at, used, created_at)

-- Background jobs
jobs (id, type, payload, status, attempts, max_attempts, last_error, created_at, updated_at)
-- status: 'pending' | 'processing' | 'completed' | 'failed'
```

### 7. API Endpoints — Detailed Parameters

All request/response bodies are JSON. All timestamps are ISO 8601 strings. All endpoints return appropriate HTTP status codes and a JSON error body on failure: `{ "error": string, "details?: string }`.

---

#### `POST /auth/register`

Creates a new user account. Public endpoint.

**Request Body:**
```json
{
  "email": "string (valid email, unique, max 255 chars)",
  "password": "string (min 8 chars, max 128 chars)",
  "name": "string (min 1 char, max 100 chars)",
  "role": "'organizer' | 'customer'"
}
```

**Responses:**

| Status | Body | Description |
|---|---|---|
| `201 Created` | `{ id: number, email: string, name: string, role: string, createdAt: string }` | Account created |
| `400 Bad Request` | `{ error: string, details?: string }` | Validation failed |
| `409 Conflict` | `{ error: "Email already registered" }` | Duplicate email |

---

#### `POST /auth/login`

Authenticates a user and returns a token pair. Public endpoint.

**Request Body:**
```json
{
  "email": "string",
  "password": "string"
}
```

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `{ accessToken: string, refreshToken: string, user: { id, email, name, role } }` | Login successful |
| `400 Bad Request` | `{ error: string, details?: string }` | Validation failed |
| `401 Unauthorized` | `{ error: "Invalid email or password" }` | Bad credentials |

---

#### `POST /auth/refresh`

Exchanges a valid refresh token for a new token pair. Rotates the refresh token.

**Request Body:**
```json
{
  "refreshToken": "string"
}
```

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `{ accessToken: string, refreshToken: string }` | New token pair issued |
| `400 Bad Request` | `{ error: "Refresh token required" }` | Missing token |
| `401 Unauthorized` | `{ error: "Invalid or expired refresh token" }` | Bad/expired token |

---

#### `POST /auth/logout`

Invalidates the provided refresh token. Authenticated endpoint.

**Headers:** `Authorization: Bearer <accessToken>`

**Request Body:**
```json
{
  "refreshToken": "string"
}
```

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `{ message: "Logged out" }` | Token invalidated |
| `401 Unauthorized` | `{ error: "Invalid or expired refresh token" }` | Bad/expired token |

---

#### `GET /events`

Lists all active events. Public endpoint.

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `page` | number (≥1) | No (default: 1) | Page number |
| `limit` | number (1–100) | No (default: 20) | Items per page |

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `{ data: Event[], pagination: { page, limit, total, totalPages } }` | List of events |

**Event object:**
```json
{
  "id": "number",
  "title": "string",
  "description": "string",
  "location": "string",
  "startsAt": "string (ISO 8601)",
  "capacity": "number",
  "status": "'active' | 'cancelled'",
  "organizerId": "number",
  "organizerName": "string",
  "createdAt": "string (ISO 8601)"
}
```

---

#### `GET /events/:id`

Gets a single event by ID. Public endpoint.

**Path Parameters:** `id` — number

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `Event` (as above) | Event details |
| `404 Not Found` | `{ error: "Event not found" }` | Invalid ID |

---

#### `POST /events`

Creates a new event. Organizer only.

**Headers:** `Authorization: Bearer <accessToken>`

**Request Body:**
```json
{
  "title": "string (min 1 char, max 200 chars)",
  "description": "string (max 5000 chars)",
  "location": "string (max 500 chars)",
  "startsAt": "string (ISO 8601, must be in the future)",
  "capacity": "number (integer, ≥1)"
}
```

**Responses:**

| Status | Body | Description |
|---|---|---|
| `201 Created` | `Event` (as above) | Event created |
| `400 Bad Request` | `{ error: string, details?: string }` | Validation failed |
| `401 Unauthorized` | `{ error: string }` | Missing/invalid token |
| `403 Forbidden` | `{ error: "Only organizers can create events" }` | Wrong role |

---

#### `PATCH /events/:id`

Updates an existing event. Organizer only. Triggers notification emails to all confirmed attendees.

**Headers:** `Authorization: Bearer <accessToken>`

**Path Parameters:** `id` — number

**Request Body (all fields optional):**
```json
{
  "title": "string (min 1 char, max 200 chars)",
  "description": "string (max 5000 chars)",
  "location": "string (max 500 chars)",
  "startsAt": "string (ISO 8601)",
  "capacity": "number (integer, ≥1)",
  "status": "'active' | 'cancelled'"
}
```

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `Event` (updated) | Event updated, notifications queued |
| `400 Bad Request` | `{ error: string, details?: string }` | Validation failed |
| `401 Unauthorized` | `{ error: string }` | Missing/invalid token |
| `403 Forbidden` | `{ error: "Only the event organizer can update this event" }` | Wrong role/not owner |
| `404 Not Found` | `{ error: "Event not found" }` | Invalid ID |

---

#### `POST /events/:id/bookings`

Initiates a ticket booking. Creates a pending booking and sends an OTP email. Customer only.

**Headers:** `Authorization: Bearer <accessToken>`

**Path Parameters:** `id` — event ID (number)

**Request Body:**
```json
{
  "quantity": "number (integer, ≥1)"
}
```

**Responses:**

| Status | Body | Description |
|---|---|---|
| `201 Created` | `{ bookingId: number, message: "Check your email for OTP", expiresAt: string (ISO 8601) }` | Booking pending, OTP sent |
| `400 Bad Request` | `{ error: string, details?: string }` | Validation failed or sold out |
| `401 Unauthorized` | `{ error: string }` | Missing/invalid token |
| `403 Forbidden` | `{ error: "Only customers can book tickets" }` | Wrong role |
| `404 Not Found` | `{ error: "Event not found" }` | Invalid event ID |

---

#### `POST /bookings/:id/confirm`

Confirms a pending booking using the OTP sent to the customer's email. Customer only.

**Headers:** `Authorization: Bearer <accessToken>`

**Path Parameters:** `id` — booking ID (number)

**Request Body:**
```json
{
  "otp": "string (6 digits)"
}
```

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `{ bookingId: number, status: "confirmed", confirmedAt: string (ISO 8601) }` | Booking confirmed |
| `400 Bad Request` | `{ error: "Invalid or expired OTP" }` | Bad OTP |
| `401 Unauthorized` | `{ error: string }` | Missing/invalid token |
| `403 Forbidden` | `{ error: "You do not own this booking" }` | Not the booking owner |
| `404 Not Found` | `{ error: "Booking not found" }` | Invalid booking ID |

---

#### `GET /bookings/my`

Lists all bookings belonging to the authenticated customer. Customer only.

**Headers:** `Authorization: Bearer <accessToken>`

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `page` | number (≥1) | No (default: 1) | Page number |
| `limit` | number (1–100) | No (default: 20) | Items per page |

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `{ data: Booking[], pagination: { page, limit, total, totalPages } }` | Customer's bookings |
| `401 Unauthorized` | `{ error: string }` | Missing/invalid token |

**Booking object:**
```json
{
  "id": "number",
  "eventId": "number",
  "eventTitle": "string",
  "eventLocation": "string",
  "eventStartsAt": "string (ISO 8601)",
  "quantity": "number",
  "status": "'pending' | 'confirmed' | 'cancelled'",
  "createdAt": "string (ISO 8601)",
  "confirmedAt": "string (ISO 8601) | null"
}
```

---

#### `GET /organizer/events`

Lists all events created by the authenticated organizer. Organizer only.

**Headers:** `Authorization: Bearer <accessToken>`

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `page` | number (≥1) | No (default: 1) | Page number |
| `limit` | number (1–100) | No (default: 20) | Items per page |

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `{ data: Event[], pagination: { page, limit, total, totalPages } }` | Organizer's events |
| `401 Unauthorized` | `{ error: string }` | Missing/invalid token |
| `403 Forbidden` | `{ error: "Only organizers can access this" }` | Wrong role |

---

#### `GET /organizer/events/:id/bookings`

Lists all confirmed attendees for a specific event. Organizer only.

**Headers:** `Authorization: Bearer <accessToken>`

**Path Parameters:** `id` — event ID (number)

**Query Parameters:**
| Param | Type | Required | Description |
|---|---|---|---|
| `page` | number (≥1) | No (default: 1) | Page number |
| `limit` | number (1–100) | No (default: 20) | Items per page |

**Responses:**

| Status | Body | Description |
|---|---|---|
| `200 OK` | `{ data: Attendee[], pagination: { page, limit, total, totalPages } }` | Attendee list |
| `401 Unauthorized` | `{ error: string }` | Missing/invalid token |
| `403 Forbidden` | `{ error: "Only the event organizer can view attendees" }` | Wrong role/not owner |
| `404 Not Found` | `{ error: "Event not found" }` | Invalid event ID |

**Attendee object:**
```json
{
  "bookingId": "number",
  "userId": "number",
  "userName": "string",
  "userEmail": "string",
  "quantity": "number",
  "status": "'confirmed'",
  "bookedAt": "string (ISO 8601)"
}
```

---

## Security Considerations

- **Password hashing:** bcrypt (cost factor 12)
- **OTP storage:** SHA-256 hashed, 10-min expiry, single-use
- **JWT signing:** HS256 with a strong secret (env var)
- **Refresh tokens:** SHA-256 hashed in DB, rotating
- **Rate limiting:** TODO — on auth endpoints and OTP attempts
- **Input validation:** Zod schemas on all request bodies
- **CORS:** Configurable comma-separated origins via `CORS_ORIGIN`; `https://itzmejan.github.io` is always allowed for the API tester
- **SQL injection:** Parameterized queries only (bun:sqlite prepared statements)

---

## Deployment

**Target:** Render, Railway, or Fly.io (any platform that supports Bun).

```bash
# Build
bun install
bun run db:migrate
bun run dev        # local development
bun run start      # production
```

**Environment variables:**
```
DATABASE_PATH=./data/app.db
JWT_SECRET=ABCDEFGHIJKLMNOPQRSTUVWXYZABCDEF
CORS_ORIGIN=https://itzmejan.github.io
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your-email@gmail.com>
SMTP_PASS=<gmail-app-password>
APP_URL=http://localhost:3000
```

---

## Scope defaults (v1)

These were left open in planning and are implemented as follows:

1. **Capacity, no waitlist.** Confirmed tickets plus unexpired pending OTPs count against capacity; oversell returns `400`.
2. **Single ticket type.** Bookings are a quantity against one capacity pool.
3. **Organizer cancel only.** `PATCH /events/:id` with `status: "cancelled"` notifies confirmed attendees. No customer self-cancel endpoint in v1.
4. **Free events.** No payment integration.
5. **No event images.**
6. **Rate limits.** Auth register/login: 10 requests / minute / IP. OTP confirm: 5 attempts / 10 minutes / user+booking.
7. **Status flags, not hard delete.** Events and bookings use `cancelled` instead of row deletion.
8. **Single instance.** In-process SQLite job worker.

## Project Structure

```
src/
├── index.ts              # Entry point, starts server + worker
├── app.ts                # Hono app setup, routes, middleware
├── db/
│   ├── index.ts          # Database connection & migrations
│   └── schema.sql        # Table definitions
├── middleware/
│   ├── auth.ts           # JWT verification, role checking
│   └── validate.ts       # Zod schema validation
├── routes/
│   ├── auth.ts
│   ├── events.ts
│   └── bookings.ts
├── jobs/
│   ├── queue.ts          # Job queue (SQLite-backed)
│   ├── worker.ts         # Worker loop
│   └── handlers/
│       ├── bookingOtp.ts
│       ├── bookingConfirmation.ts
│       └── eventUpdateNotification.ts
├── services/
│   ├── email.ts          # Nodemailer wrapper
│   └── otp.ts            # OTP generation & verification
└── types.ts              # Shared TypeScript types
```

Copy `.env.example` to `.env` and set `JWT_SECRET` plus Gmail SMTP credentials. Without SMTP credentials, emails are logged to the console so local testing still works.
