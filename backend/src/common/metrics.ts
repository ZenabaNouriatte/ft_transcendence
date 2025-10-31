import type { FastifyInstance, FastifyReply } from "fastify";
import * as client from "prom-client";
import sqlite3 from "sqlite3";

/* ───────── Registry & default ───────── */
let lastDbOk = false;
const register = client.register;
client.collectDefaultMetrics({ register, eventLoopMonitoringPrecision: 10 });

function normalizeRoute(req: any, reply: any): string {
  const raw = reply?.context?.config?.url || req?.routerPath || req?.url || "";
  return raw.replace(/\/\d+(\b|$)/g, "/:id");
}

/* ───────── HTTP ───────── */
export const httpRequests = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["service", "route", "method", "code"],
});
export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});
export const httpInFlight = new client.Gauge({
  name: "http_requests_in_flight",
  help: "HTTP requests currently being served",
  labelNames: ["route"],
});

/* ───────── WS ───────── */
export const wsConnections = new client.Gauge({
  name: "ws_connections",
  help: "Current active WebSocket connections",
  labelNames: ["service", "room"],
});
export const wsMessagesTotal = new client.Counter({
  name: "ws_messages_total",
  help: "Total WebSocket messages by type",
  labelNames: ["type"],
});
export const wsDisconnectsTotal = new client.Counter({
  name: "ws_disconnects_total",
  help: "Total WebSocket disconnects",
  labelNames: ["code"],
});
export const wsRateLimitedTotal = new client.Counter({
  name: "ws_rate_limited_total",
  help: "Total WS messages dropped due to rate-limit",
});

/* ───────── DB-based metrics ───────── */
export const usersOnline = new client.Gauge({
  name: "users_online",
  help: "Users online based on DB status='online'",
});

export const chatTotalLast5m = new client.Gauge({
  name: "chat_total_last_5m",
  help: "Total chat messages (chat_messages + direct_messages) in the last 5 minutes",
});

export const dbConnectionStatus = new client.Gauge({
  name: "db_connection_status",
  help: "1 if DB polling works, 0 otherwise",
});

/* ───────── SQLite polling (avec sqlite3 standard) ───────── */
let db: sqlite3.Database | null = null;
const wantDb = process.env.ENABLE_SQLITE_METRICS === "true";
const dbPath = process.env.DB_PATH || "/data/app.sqlite";

let initAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;
let isPolling = false;

interface UsersOnlineResult {
  n: number;
}

interface ChatMessagesResult {
  n: number;
}

/**
 * Promisify sqlite3 get method
 */
function dbGet<T>(db: sqlite3.Database, sql: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, (err: Error | null, row: T) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

/**
 * Tente d'ouvrir la connexion SQLite
 * Retourne true si réussi, false sinon
 */
function tryOpenDb(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!wantDb) {
      console.log("[metrics] ENABLE_SQLITE_METRICS != true — DB polling disabled");
      resolve(false);
      return;
    }

    if (db) {
      resolve(true); // Déjà ouverte
      return;
    }

    try {
      initAttempts++;
      console.log(`[metrics] 🔄 Attempting to open DB at ${dbPath} (attempt ${initAttempts}/${MAX_INIT_ATTEMPTS})`);
      
      // Mode OPEN_READONLY pour éviter les locks
      db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          console.error(`[metrics] ❌ SQLite open failed (attempt ${initAttempts}):`, err.message);
          db = null;
          dbConnectionStatus.set(0);
          resolve(false);
          return;
        }

        console.log("[metrics] ✅ SQLite connection opened successfully");

        // Configuration pragma pour optimiser la lecture
        db!.serialize(() => {
          db!.run("PRAGMA query_only = ON");
          db!.run("PRAGMA journal_mode = WAL");
        });

        // Test immédiat de connexion
        db!.get("SELECT 1 as test", (testErr, row: any) => {
          if (testErr) {
            console.error("[metrics] ❌ Connection test failed:", testErr.message);
            db = null;
            dbConnectionStatus.set(0);
            resolve(false);
            return;
          }

          console.log("[metrics] ✅ Connection test successful");
          
          // Test des métriques initiales
          testInitialMetrics()
            .then(() => {
              dbConnectionStatus.set(1);
              resolve(true);
            })
            .catch((testMetricsErr) => {
              console.warn("[metrics] ⚠️  Initial metrics test failed:", testMetricsErr.message);
              // On continue quand même, les tables peuvent ne pas être prêtes
              dbConnectionStatus.set(1);
              resolve(true);
            });
        });
      });

    } catch (e: any) {
      console.error(`[metrics] ❌ Exception during DB open:`, e?.message || e);
      db = null;
      dbConnectionStatus.set(0);
      resolve(false);
    }
  });
}

/**
 * Test les métriques initiales pour vérifier que les tables existent
 */
async function testInitialMetrics(): Promise<void> {
  if (!db) throw new Error("DB not initialized");

  try {
    const usersResult = await dbGet<UsersOnlineResult>(
      db,
      `SELECT COUNT(*) AS n FROM users WHERE status='online'`
    );
    
    const chatResult = await dbGet<ChatMessagesResult>(
      db,
      `SELECT
        (SELECT COUNT(*) FROM chat_messages WHERE created_at >= datetime('now','-5 minutes')) +
        (SELECT COUNT(*) FROM direct_messages WHERE created_at >= datetime('now','-5 minutes'))
      AS n`
    );

    console.log(`[metrics] ✅ Initial metrics: users_online=${usersResult?.n ?? 0}, chat_last_5m=${chatResult?.n ?? 0}`);
  } catch (err: any) {
    console.warn(`[metrics] ⚠️  Initial metrics query failed: ${err.message}`);
    throw err;
  }
}

/**
 * Exécute un cycle de polling des métriques DB
 */
async function pollOnce(): Promise<void> {
  if (isPolling) {
    console.log("[metrics] ⚠️  Previous poll still running, skipping...");
    return;
  }

  isPolling = true;

  try {
    if (!db) {
      const opened = await tryOpenDb();
      if (!opened) {
        if (initAttempts >= MAX_INIT_ATTEMPTS) {
          console.log(`[metrics] ⏸️  Max init attempts reached (${MAX_INIT_ATTEMPTS}), will retry silently`);
        }
        isPolling = false;
        return;
      }
    }

    // Poll users_online
    try {
      const usersResult = await dbGet<UsersOnlineResult>(
        db!,
        `SELECT COUNT(*) AS n FROM users WHERE status='online'`
      );
      const count = usersResult?.n ?? 0;
      usersOnline.set(count);
      console.log(`[metrics] 👥 users_online: ${count}`);
    } catch (err: any) {
      console.error(`[metrics] ❌ users_online query failed:`, err.message);
    }

    // Poll chat_total_last_5m
    try {
      const chatResult = await dbGet<ChatMessagesResult>(
        db!,
        `SELECT
          (SELECT COUNT(*) FROM chat_messages WHERE created_at >= datetime('now','-5 minutes')) +
          (SELECT COUNT(*) FROM direct_messages WHERE created_at >= datetime('now','-5 minutes'))
        AS n`
      );
      const count = chatResult?.n ?? 0;
      chatTotalLast5m.set(count);
      console.log(`[metrics] 💬 chat_total_last_5m: ${count}`);
    } catch (err: any) {
      console.error(`[metrics] ❌ chat_total_last_5m query failed:`, err.message);
    }

    // Marquer comme opérationnel
    dbConnectionStatus.set(1);
    lastDbOk = true;

  } catch (err: any) {
    console.error(`[metrics] ❌ Polling error:`, err?.message || err);
    dbConnectionStatus.set(0);
    lastDbOk = false;

    // Fermer et réinitialiser pour tenter une reconnexion
    if (db) {
      db.close((closeErr) => {
        if (closeErr) {
          console.error("[metrics] Error closing DB:", closeErr.message);
        }
      });
      db = null;
    }
  } finally {
    isPolling = false;
  }
}

/**
 * Initialise le système de polling avec retry progressif
 */
function initPolling(): void {
  if (!wantDb) {
    console.log("[metrics] 🔕 DB metrics disabled (ENABLE_SQLITE_METRICS != true)");
    dbConnectionStatus.set(0);
    return;
  }

  console.log("[metrics] 🚀 Starting DB metrics polling system");
  console.log(`[metrics] 📍 DB_PATH: ${dbPath}`);
  console.log(`[metrics] ⏱️  Poll interval: 10s`);
  console.log(`[metrics] ⏳ Initial delay: 5s (waiting for DB initialization)`);

  // Premier essai après 5s (laisse le temps à initDb() de créer le schéma)
  setTimeout(() => {
    console.log("[metrics] 🔄 First polling attempt...");
    pollOnce().catch((err) => {
      console.error("[metrics] First poll failed:", err);
    });

    // Polling régulier toutes les 10s
    const interval = setInterval(() => {
      pollOnce().catch((err) => {
        console.error("[metrics] Poll cycle failed:", err);
      });
    }, 10_000);

    // Cleanup au shutdown
    const cleanup = () => {
      console.log("[metrics] 🛑 Shutting down, stopping polling");
      clearInterval(interval);
      if (db) {
        db.close((err) => {
          if (err) {
            console.error("[metrics] Error closing DB:", err.message);
          } else {
            console.log("[metrics] ✅ DB closed gracefully");
          }
        });
      }
    };

    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);

  }, 5_000);
}

// Démarrage automatique du polling
initPolling();

/* ───────── Fastify hooks ───────── */
export function registerHttpTimingHooks(app: FastifyInstance) {
  app.addHook("onRequest", (req, reply, done) => {
    const route = normalizeRoute(req, reply);
    (req as any)._metrics = { t0: process.hrtime.bigint(), route };
    try { httpInFlight.labels(route).inc(); } catch {}
    done();
  });

  app.addHook("onResponse", (req, reply, done) => {
    const m = (req as any)._metrics as { t0?: bigint; route?: string } | undefined;
    const route = m?.route || normalizeRoute(req, reply);
    try { httpInFlight.labels(route).dec(); } catch {}
    try {
      httpRequests.labels({
        service: process.env.SERVICE_NAME || "backend",
        route,
        method: req.method,
        code: String(reply.statusCode),
      } as any).inc();
    } catch {}
    if (m?.t0) {
      const seconds = Number(process.hrtime.bigint() - m.t0) / 1e9;
      try { httpDuration.labels(req.method, route, String(reply.statusCode)).observe(seconds); } catch {}
    }
    done();
  });
}

/* ───────── /metrics endpoint ───────── */
export async function sendMetrics(reply: FastifyReply) {
  reply.header("Content-Type", register.contentType);
  return await register.metrics();
}

/* ───────── Health check helper ───────── */
export function getDbHealthStatus(): {
  connected: boolean;
  attempts: number;
  path: string;
  enabled: boolean;
} {
  return {
    connected: lastDbOk && db !== null,
    attempts: initAttempts,
    path: dbPath,
    enabled: wantDb,
  };
}
