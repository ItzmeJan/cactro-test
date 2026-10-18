import type { MiddlewareHandler } from "hono";
import { verifyAccessToken } from "../services/tokens";
import type { Role } from "../types";

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "Missing or invalid token" }, 401);
  }

  try {
    const user = await verifyAccessToken(header.slice(7));
    c.set("user", user);
    await next();
  } catch {
    return c.json({ error: "Invalid or expired token" }, 401);
  }
};

export function requireRole(role: Role, message: string): MiddlewareHandler {
  return async (c, next) => {
    const user = c.get("user");
    if (user.role !== role) {
      return c.json({ error: message }, 403);
    }
    await next();
  };
}
