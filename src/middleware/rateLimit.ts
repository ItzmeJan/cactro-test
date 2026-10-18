import type { Context, MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(options: {
  windowMs: number;
  max: number;
  key: (c: Context<AppEnv>) => string;
  message?: string;
}): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const key = options.key(c);
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      await next();
      return;
    }

    if (existing.count >= options.max) {
      return c.json({ error: options.message ?? "Too many requests" }, 429);
    }

    existing.count += 1;
    await next();
  };
}
