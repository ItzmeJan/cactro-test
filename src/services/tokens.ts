import { sign, verify } from "hono/jwt";
import { config } from "../config";
import { getDb } from "../db";
import { nowIso, sha256, sqliteNowPlus } from "../lib/hash";
import type { Role, TokenPayload, User } from "../types";

export async function issueAccessToken(user: Pick<User, "id" | "email" | "role">): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      jti: crypto.randomUUID(),
      iat: now,
      exp: now + config.accessTokenTtlSec,
    },
    config.jwtSecret,
    "HS256",
  );
}

export function createRefreshToken(userId: number): string {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const tokenHash = sha256(token);
  const db = getDb();
  db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
  ).run(userId, tokenHash, sqliteNowPlus(config.refreshTokenTtlMs));
  return token;
}

export async function issueTokenPair(user: Pick<User, "id" | "email" | "role">) {
  return {
    accessToken: await issueAccessToken(user),
    refreshToken: createRefreshToken(user.id),
  };
}

export async function verifyAccessToken(token: string): Promise<TokenPayload> {
  const payload = await verify(token, config.jwtSecret, "HS256");
  return {
    userId: Number(payload.userId),
    email: String(payload.email),
    role: payload.role as Role,
    jti: String(payload.jti),
  };
}

export function rotateRefreshToken(refreshToken: string): { userId: number } | null {
  const tokenHash = sha256(refreshToken);
  const db = getDb();
  const row = db
    .query<{ id: number; user_id: number; expires_at: string }, [string]>(
      `SELECT id, user_id, expires_at FROM refresh_tokens WHERE token_hash = ?`,
    )
    .get(tokenHash);

  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.query(`DELETE FROM refresh_tokens WHERE id = ?`).run(row.id);
    return null;
  }

  db.query(`DELETE FROM refresh_tokens WHERE id = ?`).run(row.id);
  return { userId: row.user_id };
}

export function revokeRefreshToken(refreshToken: string, userId?: number): boolean {
  const tokenHash = sha256(refreshToken);
  const db = getDb();
  const row = db
    .query<{ id: number; user_id: number }, [string]>(
      `SELECT id, user_id FROM refresh_tokens WHERE token_hash = ?`,
    )
    .get(tokenHash);
  if (!row) return false;
  if (userId !== undefined && row.user_id !== userId) return false;
  db.query(`DELETE FROM refresh_tokens WHERE id = ?`).run(row.id);
  return true;
}

export function getUserById(id: number): User | null {
  return (
    getDb()
      .query<User, [number]>(
        `SELECT id, email, name, role, password_hash, created_at FROM users WHERE id = ?`,
      )
      .get(id) ?? null
  );
}

export { nowIso };
