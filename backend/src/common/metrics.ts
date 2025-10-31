import type { FastifyInstance, FastifyReply } from "fastify";
import * as client from "prom-client";

/* ───────── Registry & default ───────── */
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

/* ───────── SQLite open (lazy + robust) ───────── */
let db: any = null;
const wantDb = process.env.ENABLE_SQLITE_METRICS === "true";
const dbPath = process.env.DB_PATH || "/data/app.sqlite";

let qUsersOnline: any = null;
let qChat5m: any = null;

function tryOpenDb() {
  if (!wantDb || db) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require("better-sqlite3");
    // Pas de fileMustExist: le gateway crée la DB via initDb() juste après le boot
    db = new BetterSqlite3(dbPath, { readonly: true });
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 2000");
    console.log(`[metrics] DB_PATH=${dbPath} — polling enabled`);
    dbConnectionStatus.set(1);

    qUsersOnline = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status='online'`);
    qChat5m = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM chat_messages   WHERE created_at >= datetime('now','-5 minutes')) +
        (SELECT COUNT(*) FROM direct_messages WHERE created_at >= datetime('now','-5 minutes'))
      AS n
    `);
  } catch (e: any) {
    console.warn("[metrics] SQLite open failed:", e?.message || e);
    db = null;
    dbConnectionStatus.set(0);
  }
}

function pollOnce() {
  if (!db) {
    tryOpenDb();
    if (!db) return; // on réessaiera au tick suivant
  }
  try {
    const u = qUsersOnline.get();
    usersOnline.set(u?.n ?? 0);
  } catch (err: any) {
    console.warn("[metrics] users_online failed:", err?.message || err);
    dbConnectionStatus.set(0);
    // force re-open au prochain tick (utile si schéma pas prêt au premier tour)
    db = null;
  }

  try {
    const c = qChat5m.get();
    chatTotalLast5m.set(c?.n ?? 0);
  } catch (err: any) {
    console.warn("[metrics] chat_total_last_5m failed:", err?.message || err);
    dbConnectionStatus.set(0);
    db = null;
  }
}

// Première exécution différée (laisse le temps à initDb() d’appliquer le schéma)
if (wantDb) {
  setTimeout(() => {
    tryOpenDb();
    pollOnce();
    setInterval(pollOnce, 10_000);
  }, 5_000);
} else {
  console.log("[metrics] ENABLE_SQLITE_METRICS != true — DB polling disabled");
  dbConnectionStatus.set(0);
}

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
