import { Hono } from "hono";
import { z } from "zod";
import { getDb } from "../db";
import { requireAuth } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { validateJson } from "../middleware/validate";
import { serializeUser } from "../lib/serialize";
import { getUserById, issueTokenPair, rotateRefreshToken, revokeRefreshToken } from "../services/tokens";
import type { AppEnv } from "../types";

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
  role: z.enum(["organizer", "customer"]),
});

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token required"),
});

export const authRoutes = new Hono<AppEnv>();

const authLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  key: (c) => `auth:${c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "local"}`,
  message: "Too many authentication attempts",
});

authRoutes.post("/register", authLimit, validateJson(registerSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof registerSchema>;
  const db = getDb();
  const existing = db.query(`SELECT id FROM users WHERE email = ?`).get(body.email.toLowerCase());
  if (existing) {
    return c.json({ error: "Email already registered" }, 409);
  }

  const passwordHash = await Bun.password.hash(body.password, {
    algorithm: "bcrypt",
    cost: 12,
  });

  const result = db
    .query(`INSERT INTO users (email, password_hash, role, name, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(body.email.toLowerCase(), passwordHash, body.role, body.name, new Date().toISOString());

  const user = getUserById(Number(result.lastInsertRowid));
  if (!user) return c.json({ error: "Failed to create user" }, 500);

  return c.json(serializeUser(user), 201);
});

authRoutes.post("/login", authLimit, validateJson(loginSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof loginSchema>;
  const user = getDb()
    .query<{
      id: number;
      email: string;
      name: string;
      role: "organizer" | "customer";
      password_hash: string;
    }, [string]>(`SELECT id, email, name, role, password_hash FROM users WHERE email = ?`)
    .get(body.email.toLowerCase());

  if (!user || !(await Bun.password.verify(body.password, user.password_hash))) {
    return c.json({ error: "Invalid email or password" }, 401);
  }

  const tokens = await issueTokenPair(user);
  return c.json({
    ...tokens,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

authRoutes.post("/refresh", validateJson(refreshSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof refreshSchema>;
  const rotated = rotateRefreshToken(body.refreshToken);
  if (!rotated) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  const user = getUserById(rotated.userId);
  if (!user) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }

  const tokens = await issueTokenPair(user);
  return c.json(tokens);
});

authRoutes.post("/logout", requireAuth, validateJson(refreshSchema), async (c) => {
  const body = c.get("body") as z.infer<typeof refreshSchema>;
  const user = c.get("user");
  const ok = revokeRefreshToken(body.refreshToken, user.userId);
  if (!ok) {
    return c.json({ error: "Invalid or expired refresh token" }, 401);
  }
  return c.json({ message: "Logged out" });
});
