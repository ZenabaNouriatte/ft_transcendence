// backend/src/database/index.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sqlite3 from "sqlite3";

sqlite3.verbose();

let db: sqlite3.Database | null = null;

function schemaPathInDist() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  // En runtime: dist/database/index.js → schema.sql est copié à côté (Dockerfile)
  return path.join(__dirname, "schema.sql");
}

// Petits wrappers promisifiés
function execAsync(database: sqlite3.Database, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, (err) => (err ? reject(err) : resolve()));
  });
}
function getAsync<T = any>(database: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T)));
  });
}
function runAsync(database: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    database.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

export async function initDb() {
  if (db) return db;
  const DB_PATH = process.env.DB_PATH || "/data/app.sqlite";
  db = new sqlite3.Database(DB_PATH);

  try {
    const sql = fs.readFileSync(schemaPathInDist(), "utf8");
    await execAsync(db, sql);
    // sécurité : s’assure que la ligne visits existe
    await runAsync(db, `INSERT OR IGNORE INTO visits (id, total) VALUES (1, 0)`);
    console.log("[db] schema applied");
  } catch (err) {
    console.error("[db] schema apply error:", err);
    throw err;
  }
  return db;
}

// ---- Helpers utilisés par /api/visits ----
export async function getVisitTotal(): Promise<number> {
  if (!db) throw new Error("DB not initialized");
  const row = await getAsync<{ total: number }>(db, "SELECT total FROM visits WHERE id=1");
  return row?.total ?? 0;
}

export async function incrementVisit(): Promise<number> {
  if (!db) throw new Error("DB not initialized");
  await runAsync(db, "UPDATE visits SET total = total + 1 WHERE id=1");
  const row = await getAsync<{ total: number }>(db, "SELECT total FROM visits WHERE id=1");
  return row?.total ?? 0;
}
