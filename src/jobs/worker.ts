import type { JobType } from "../types";
import { claimNextJob, completeJob, failJob } from "./queue";
import { handleBookingConfirmation } from "./handlers/bookingConfirmation";
import { handleBookingOtp } from "./handlers/bookingOtp";
import { handleEventUpdateNotification } from "./handlers/eventUpdateNotification";
import { expireStaleBookings } from "../services/bookings";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function processOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    expireStaleBookings();
    const job = claimNextJob();
    if (!job) return;

    try {
      const payload = JSON.parse(job.payload);
      switch (job.type as JobType) {
        case "booking_otp":
          await handleBookingOtp(payload);
          break;
        case "booking_confirmation":
          await handleBookingConfirmation(payload);
          break;
        case "event_update_notification":
          await handleEventUpdateNotification(payload);
          break;
        default:
          throw new Error(`Unknown job type: ${job.type}`);
      }
      completeJob(job.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failJob(job.id, message, job.attempts, job.max_attempts);
    }
  } finally {
    running = false;
  }
}

export function startWorker(): void {
  timer = setInterval(() => {
    void processOnce();
  }, 1000);
  void processOnce();
}

export function stopWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
