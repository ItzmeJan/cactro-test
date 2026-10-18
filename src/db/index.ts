import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { config } from "../config";

let db: Database | null = null;

export function getDb(): Database {
  if (db) return db;
  mkdirSync(dirname(config.databasePath), { recursive: true });
  db = new Database(config.databasePath, { create: true });
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function migrate(): void {
  const sql = readFileSync(join(import.meta.dir, "schema.sql"), "utf8");
  getDb().exec(sql);
}

export function closeDb(): void {
  db?.close();
  db = null;
}
