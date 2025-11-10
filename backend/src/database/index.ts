// backend/src/database/index.ts
// DB singleton + migrations + helpers + repos minimal
import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import { fileURLToPath } from "node:url";

// Types (optionnel, juste pour l'auto-complétion)
import type { User } from "../services/index.js";

// ────────────────────────── Résolution des chemins ──────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

// ──────────────────────────── Singleton SQLite ──────────────────────────────
let _db: sqlite3.Database | null = null;

export function initDb(): sqlite3.Database {
  if (_db) return _db;

  const DB_PATH = process.env.DB_PATH || "/data/app.sqlite";
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  // Optionnel : logs sqlite
  sqlite3.verbose();

  _db = new sqlite3.Database(DB_PATH);

  // Applique le schema
  const schemaSql = safeReadFile(SCHEMA_PATH);
   _db.serialize(() => {
    // Securise le journal (évite les corrupt/locks au restart)
    _db!.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
    `);

    const schemaSql = safeReadFile(SCHEMA_PATH);
    if (schemaSql) _db!.exec(schemaSql);

    // Migration : ajouter les colonnes manquantes dans games (idempotent)
    _db!.exec(`ALTER TABLE games ADD COLUMN player1_type TEXT DEFAULT 'user';`, () => {});
    _db!.exec(`ALTER TABLE games ADD COLUMN player2_type TEXT DEFAULT 'user';`, () => {});
    _db!.exec(`ALTER TABLE games ADD COLUMN winner_type TEXT;`, () => {});
    _db!.exec(`ALTER TABLE games ADD COLUMN duration INTEGER DEFAULT 0;`, () => {});

  });

  // --- Logs de démarrage utiles pour le test persistance
  _db.get(`SELECT COUNT(*) AS c FROM users`, (err: any, row: any) => {
    const count = err ? `ERR:${err.code || err.message}` : row?.c ?? 0;
    // eslint-disable-next-line no-console
    console.log(`[DB] Using ${DB_PATH} — users count=${count}`);
  });

  return _db;
}


export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function db(): sqlite3.Database {
  if (!_db) throw new Error("DB not initialized (call initDb() in gateway)");
  return _db;
}

function safeReadFile(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// ─────────────────────────── Helpers ────────────────────────────
export function run(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db().run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

export function get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db().get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T)));
  });
}

export function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db().all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])));
  });
}


// ───────────────────────────── Repos (exemples) ────────────────────────────


export const usersRepo = {
  async create(input: { username: string; email: string; password: string; avatar?: string | null }): Promise<number> {
    await run(
      `INSERT INTO users (username, email, password, avatar)
       VALUES (?, ?, ?, ?)`,
      [input.username, input.email, input.password, input.avatar ?? null]
    );
    const row = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row?.id ?? 0;
  },

  async findByUsername(username: string): Promise<User | undefined> {
    return get<User>(`SELECT id, username, email, created_at FROM users WHERE username = ?`, [username]);
  },

  async findById(id: number): Promise<User | undefined> {
    return get<User>(`SELECT id, username, email, created_at FROM users WHERE id = ?`, [id]);
  },

  async all(): Promise<User[]> {
    return all<User>(`SELECT id, username, email, created_at FROM users ORDER BY id DESC`);
  },
};

export const gamesRepo = {
  async create(gameData: {
    player1_id: number;
    player2_id?: number;
    player1_score?: number;
    player2_score?: number;
    status?: string;
  }): Promise<number> {
    await run(
      `INSERT INTO games (player1_id, player2_id, player1_score, player2_score, status, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [
        gameData.player1_id,
        gameData.player2_id ?? null,
        gameData.player1_score ?? 0,
        gameData.player2_score ?? 0,
        gameData.status ?? 'waiting'
      ]
    );
    const row = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row?.id ?? 0;
  },

  async findById(id: number) {
    return get(`SELECT * FROM games WHERE id = ?`, [id]);
  },

  async list() {
    return all(`SELECT * FROM games ORDER BY id DESC`);
  },

  async updateScore(gameId: number, p1Score: number, p2Score: number) {
    return run(
      `UPDATE games SET player1_score = ?, player2_score = ? WHERE id = ?`,
      [p1Score, p2Score, gameId]
    );
  },

  async finish(gameId: number, winnerId?: number) {
    return run(
      `UPDATE games SET status = 'finished', winner_id = ?, finished_at = datetime('now') WHERE id = ?`,
      [winnerId ?? null, gameId]
    );
  }
};

export const chatRepo = {
  async sendMessage(messageData: {
    sender_id: number;
    receiver_id?: number;
    message: string;
    type?: string;
  }): Promise<number> {
    await run(
      `INSERT INTO chat_messages (sender_id, receiver_id, message, type, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
      [
        messageData.sender_id,
        messageData.receiver_id ?? null,
        messageData.message,
        messageData.type ?? 'private'
      ]
    );
    const row = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row?.id ?? 0;
  },

  async getMessages(userId: number, limit: number = 50) {
    return all(
      `SELECT cm.*, u.username as sender_name 
       FROM chat_messages cm 
       JOIN users u ON cm.sender_id = u.id 
       WHERE cm.receiver_id = ? OR cm.type = 'global'
       ORDER BY cm.created_at DESC 
       LIMIT ?`,
      [userId, limit]
    );
  }
};

export const tournamentsRepo = {
  async create(tournamentData: {
    name: string;
    max_players: number;
    created_by: number;
    description?: string;
  }): Promise<number> {
    await run(
      `INSERT INTO tournaments (name, max_players, created_by, description, status, created_at)
       VALUES (?, ?, ?, ?, 'waiting', datetime('now'))`,
      [
        tournamentData.name,
        tournamentData.max_players,
        tournamentData.created_by,
        tournamentData.description ?? null
      ]
    );
    const row = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row?.id ?? 0;
  },

  async findById(id: number) {
    return get(`SELECT * FROM tournaments WHERE id = ?`, [id]);
  },

  async list() {
    return all(`SELECT * FROM tournaments ORDER BY id DESC`);
  },

  async join(tournamentId: number, userId: number) {
    // Vérifier si déjà inscrit
    const existing = await get(
      `SELECT 1 FROM tournament_participants WHERE tournament_id = ? AND user_id = ?`,
      [tournamentId, userId]
    );
    
    if (!existing) {
      await run(
        `INSERT INTO tournament_participants (tournament_id, user_id, joined_at)
         VALUES (?, ?, datetime('now'))`,
        [tournamentId, userId]
      );
    }
  }
};

