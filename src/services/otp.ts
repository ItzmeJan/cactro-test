import { config } from "../config";
import { getDb } from "../db";
import { safeEqualHex, sha256, sqliteNowPlus } from "../lib/hash";

export function generateOtp(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

export function storeOtp(bookingId: number, otp: string): string {
  const expiresAt = sqliteNowPlus(config.otpTtlMs);
  getDb()
    .query(`INSERT INTO otp_codes (booking_id, code_hash, expires_at, used) VALUES (?, ?, ?, 0)`)
    .run(bookingId, sha256(otp), expiresAt);
  return expiresAt;
}

export function verifyOtp(bookingId: number, otp: string): boolean {
  const row = getDb()
    .query<{ id: number; code_hash: string; expires_at: string; used: number }, [number]>(
      `SELECT id, code_hash, expires_at, used
       FROM otp_codes
       WHERE booking_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(bookingId);

  if (!row) return false;
  if (row.used) return false;
  if (new Date(row.expires_at).getTime() <= Date.now()) return false;
  if (!safeEqualHex(row.code_hash, sha256(otp))) return false;

  getDb().query(`UPDATE otp_codes SET used = 1 WHERE id = ?`).run(row.id);
  return true;
}
