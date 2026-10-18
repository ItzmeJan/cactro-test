import { getDb } from "../db";
import { nowIso } from "../lib/hash";
import type { Job, JobType } from "../types";

export function enqueue(type: JobType, payload: unknown, maxAttempts = 5): number {
  const result = getDb()
    .query(
      `INSERT INTO jobs (type, payload, status, attempts, max_attempts, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?, ?)`,
    )
    .run(type, JSON.stringify(payload), maxAttempts, nowIso(), nowIso());
  return Number(result.lastInsertRowid);
}

export function claimNextJob(): Job | null {
  const db = getDb();
  const claim = db.transaction(() => {
    const job = db
      .query<Job, []>(
        `SELECT id, type, payload, status, attempts, max_attempts, last_error, created_at, updated_at
         FROM jobs
         WHERE status = 'pending' AND attempts < max_attempts
         ORDER BY created_at ASC
         LIMIT 1`,
      )
      .get();
    if (!job) return null;
    db.query(
      `UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = ? WHERE id = ?`,
    ).run(nowIso(), job.id);
    return { ...job, status: "processing" as const, attempts: job.attempts + 1 };
  });
  return claim();
}

export function completeJob(id: number): void {
  getDb()
    .query(`UPDATE jobs SET status = 'completed', last_error = NULL, updated_at = ? WHERE id = ?`)
    .run(nowIso(), id);
}

export function failJob(id: number, error: string, attempts: number, maxAttempts: number): void {
  const status = attempts >= maxAttempts ? "failed" : "pending";
  getDb()
    .query(`UPDATE jobs SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
    .run(status, error, nowIso(), id);
}
