import { createHash, timingSafeEqual } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function sqliteNowPlus(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}
