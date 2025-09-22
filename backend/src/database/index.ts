// backend/src/database/index.ts
import sqlite3 from "sqlite3";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DB_PATH = process.env.DB_PATH || "/data/app.db";
export const db = new sqlite3.Database(DB_PATH);

// Trouve schema.sql soit à côté de ce fichier compilé (dist/database/schema.sql),
// soit dans les sources (src/database/schema.sql) — pratique en dev.
function readSchema(): string {
  const here = dirname(fileURLToPath(import.meta.url)); // .../dist/database
  const candidates = [
    join(here, "schema.sql"),
    join(process.cwd(), "src", "database", "schema.sql"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  throw new Error("schema.sql introuvable (dist/database/schema.sql ou src/database/schema.sql)");
}

export function initDb() {
  const schema = readSchema();
  db.serialize(() => db.exec(schema));
}

// --- helpers promisifiés ---
const get = <T = any>(sql: string, params: any[] = []) =>
  new Promise<T | undefined>((res, rej) =>
    db.get(sql, params, (e, row) => (e ? rej(e) : res(row as T | undefined)))
  );

const all = <T = any>(sql: string, params: any[] = []) =>
  new Promise<T[]>((res, rej) =>
    db.all(sql, params, (e, rows) => (e ? rej(e) : res(rows as T[])))
  );

const run = (sql: string, params: any[] = []) =>
  new Promise<number>((res, rej) =>
    db.run(sql, params, function (this: sqlite3.RunResult, e) {
      e ? rej(e) : res(this.lastID);
    })
  );

// ================= USERS =================
export async function users_findByUsername(username: string) {
  return get(`SELECT * FROM users WHERE username = ?`, [username]);
}

export async function users_findById(id: number) {
  return get(
    `SELECT id, username, email, avatar, created_at FROM users WHERE id = ?`,
    [id]
  );
}

export async function users_create(u: {
  username: string;
  email: string;
  password_hash: string;
  avatar?: string;
}) {
  return run(
    `INSERT INTO users (username, email, password, avatar) VALUES (?,?,?,?)`,
    [u.username, u.email, u.password_hash, u.avatar ?? null]
  );
}

// =============== TOURNAMENTS ===============
export async function tournaments_create(
  name: string,
  maxPlayers: number,
  createdBy: number
) {
  return run(
    `INSERT INTO tournaments (name, max_players, status, created_by, created_at)
     VALUES (?, ?, 'pending', ?, strftime('%s','now'))`,
    [name, maxPlayers, createdBy]
  );
}

export async function tournaments_get(id: number) {
  return get(`SELECT * FROM tournaments WHERE id = ?`, [id]);
}

export async function tournaments_list() {
  return all(`SELECT * FROM tournaments ORDER BY id DESC`);
}

export async function tournaments_join(tournamentId: number, userId: number) {
  const exists = await get(
    `SELECT 1 FROM tournament_participants WHERE tournament_id=? AND user_id=?`,
    [tournamentId, userId]
  );
  if (!exists) {
    const cnt = await get<{ c: number }>(
      `SELECT COUNT(*) as c FROM tournament_participants WHERE tournament_id=?`,
      [tournamentId]
    );
    const seed = (cnt?.c ?? 0) + 1;
    await run(
      `INSERT INTO tournament_participants (tournament_id, user_id, seed, joined_at)
       VALUES (?,?,?, strftime('%s','now'))`,
      [tournamentId, userId, seed]
    );
  }
}

// =============== VISITS (pour le testeur) ===============
async function ensureVisitsRow() {
  await run(
    `CREATE TABLE IF NOT EXISTS visits_total (
       id INTEGER PRIMARY KEY CHECK (id=1),
       total INTEGER NOT NULL
     )`,
    []
  );
  await run(
    `INSERT OR IGNORE INTO visits_total (id, total) VALUES (1, 0)`,
    []
  );
}

export async function getVisitTotal(): Promise<number> {
  await ensureVisitsRow();
  const row = await get<{ total: number }>(
    `SELECT total FROM visits_total WHERE id = 1`,
    []
  );
  return row?.total ?? 0;
}

export async function incrementVisit(): Promise<number> {
  await ensureVisitsRow();
  await run(`UPDATE visits_total SET total = total + 1 WHERE id = 1`, []);
  return getVisitTotal();
}
