import type { FastifyInstance, FastifyReply } from "fastify";
import * as client from "prom-client";

/* ----------------------------------------------------------
   REGISTRY & DEFAULT METRICS
----------------------------------------------------------- */
const register = client.register;
client.collectDefaultMetrics({
  register,
  eventLoopMonitoringPrecision: 10, // pour nodejs_eventloop_lag_seconds
});

/* ----------------------------------------------------------
   HELPERS
----------------------------------------------------------- */
function normalizeRoute(req: any, reply: any): string {
  const raw = reply?.context?.config?.url || req?.routerPath || req?.url || "";
  // Ex: /api/v1/users/123 -> /api/v1/users/:id
  return raw.replace(/\/\d+(\b|$)/g, "/:id");
}

/* ----------------------------------------------------------
   HTTP METRICS
----------------------------------------------------------- */
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

/* ----------------------------------------------------------
   WEBSOCKET METRICS
----------------------------------------------------------- */
export const wsConnections = new client.Gauge({
  name: "ws_connections",
  help: "Current active WebSocket connections",
  labelNames: ["service", "room"],
});

export const wsMessagesTotal = new client.Counter({
  name: "ws_messages_total",
  help: "Total WebSocket messages by type",
  labelNames: ["type"], // ex: chat.message | game.input | invalid | unknown
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

/* ----------------------------------------------------------
   GAME & CHAT METRICS
----------------------------------------------------------- */
export const gamesActive = new client.Gauge({
  name: "games_active",
  help: "Active game sessions",
  labelNames: ["mode"],
});

export const playersInGame = new client.Gauge({
  name: "players_in_game",
  help: "Players currently in game",
});

export const chatActiveRooms = new client.Gauge({
  name: "chat_active_rooms",
  help: "Active chat rooms",
});

export const chatMessagesTotal = new client.Counter({
  name: "chat_messages_total",
  help: "Messages sent in chat",
  labelNames: ["room"],
});

/* ----------------------------------------------------------
   SQLITE METRICS
----------------------------------------------------------- */
export const sqliteQueriesTotal = new client.Counter({
  name: "sqlite_queries_total",
  help: "Executed SQLite queries",
  labelNames: ["service", "op", "table", "status"], // status: ok|error
});

export const sqliteErrorsTotal = new client.Counter({
  name: "sqlite_errors_total",
  help: "SQLite query errors",
  labelNames: ["service", "op", "table", "err"],
});

/* ----------------------------------------------------------
   USERS ONLINE METRIC
----------------------------------------------------------- */
export const usersOnline = new client.Gauge({
  name: "users_online",
  help: "Users considered online (last_seen within X minutes)",
});

// --- Lazy load de better-sqlite3 pour éviter l'erreur de build ---
let db: any = null;
if (process.env.ENABLE_SQLITE_METRICS === "true") {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const BetterSqlite3 = require("better-sqlite3");
    const dbPath = process.env.DB_PATH;
    if (dbPath) db = new BetterSqlite3(dbPath);
  } catch (e: any) {
    console.warn("[metrics] SQLite metrics disabled:", e?.message || e);
  }
}

// Mettre à jour users_online seulement si db est OK
if (db) {
  const minutes = Number(process.env.USERS_ONLINE_WINDOW_MIN || 5);
  setInterval(() => {
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS n
           FROM users
           WHERE last_seen >= datetime('now', ?)`,
        )
        .get(`-${minutes} minutes`);
      usersOnline.set(row?.n || 0);
    } catch (err: any) {
      console.error("[metrics] users_online failed:", err?.message || err);
    }
  }, 10_000);
}

/* ----------------------------------------------------------
   FASTIFY HOOKS (HTTP TIMING)
----------------------------------------------------------- */
export function registerHttpTimingHooks(app: FastifyInstance) {
  app.addHook("onRequest", (req, reply, done) => {
    const route = normalizeRoute(req, reply);
    (req as any)._metrics = { t0: process.hrtime.bigint(), route };
    try {
      httpInFlight.labels(route).inc();
    } catch {}
    done();
  });

  app.addHook("onResponse", (req, reply, done) => {
    const m = (req as any)._metrics as
      | { t0?: bigint; route?: string }
      | undefined;
    const route = m?.route || normalizeRoute(req, reply);

    // in-flight--
    try {
      httpInFlight.labels(route).dec();
    } catch {}

    // incrémente compteur global
    try {
      httpRequests
        .labels({
          service: process.env.SERVICE_NAME || "backend",
          route,
          method: req.method,
          code: String(reply.statusCode),
        })
        .inc();
    } catch {}

    // durée
    if (m?.t0) {
      const seconds = Number(process.hrtime.bigint() - m.t0) / 1e9;
      try {
        httpDuration
          .labels(req.method, route, String(reply.statusCode))
          .observe(seconds);
      } catch {}
    }
    done();
  });
}

/* ----------------------------------------------------------
   /METRICS ENDPOINT HELPER
----------------------------------------------------------- */
export async function sendMetrics(reply: FastifyReply) {
  reply.header("Content-Type", register.contentType);
  return await register.metrics();
}
