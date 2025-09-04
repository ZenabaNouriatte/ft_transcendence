// backend/src/common/metrics.ts
import type { FastifyInstance, FastifyReply } from "fastify";
import * as client from "prom-client";

// ─── Registry ───────────────────────────────────────────────────────────────────
const register = client.register;

// ─── Helpers ────────────────────────────────────────────────────────────────────
function normalizeRoute(req: any, reply: any): string {
  const raw = reply?.context?.config?.url || req?.routerPath || req?.url || "";
  // /api/v1/users/123 -> /api/v1/users/:id
  return raw.replace(/\/\d+(\b|$)/g, "/:id");
}

// ─── HTTP metrics ───────────────────────────────────────────────────────────────
export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  // Buckets: 5ms → 5s
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

// ─── WebSocket metrics ─────────────────────────────────────────────────────────
export const wsConnections = new client.Gauge({
  name: "websocket_connections_active",
  help: "Number of active WebSocket connections",
});

export const wsMessagesTotal = new client.Counter({
  name: "ws_messages_total",
  help: "Total WebSocket messages by type",
  labelNames: ["type"] as const, // ex: chat.message | game.input | invalid | unknown
});

// ─── Visits (use-case) ─────────────────────────────────────────────────────────
export const visitsDbTotal = new client.Gauge({
  name: "visits_db_total",
  help: "Total visits as stored in the DB (snapshot on reads)",
});

export const visitsApiIncrementsTotal = new client.Counter({
  name: "visits_api_increments_total",
  help: "Total increments done via POST /api/visit",
  labelNames: ["type"] as const, // ex: navigate | reload
});

// ─── Registration & Default metrics ────────────────────────────────────────────
register.registerMetric(httpDuration);
register.registerMetric(wsConnections);
register.registerMetric(wsMessagesTotal);
register.registerMetric(visitsDbTotal);
register.registerMetric(visitsApiIncrementsTotal);

client.collectDefaultMetrics({ register }); // process, heap, event loop, etc.

// ─── Fastify hooks (HTTP timing) ───────────────────────────────────────────────
export function registerHttpTimingHooks(app: FastifyInstance) {
  app.addHook("onRequest", (req, _reply, done) => {
    (req as any)._t0 = process.hrtime.bigint();
    done();
  });

  app.addHook("onResponse", (req, reply, done) => {
    const t0 = (req as any)._t0 as bigint | undefined;
    if (t0) {
      const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
      const route = normalizeRoute(req, reply);
      httpDuration
        .labels({
          method: req.method,
          route,
          status_code: String(reply.statusCode),
        })
        .observe(seconds);
    }
    done();
  });
}

// ─── /metrics endpoint helper ──────────────────────────────────────────────────
export async function sendMetrics(reply: FastifyReply) {
  reply.header("Content-Type", register.contentType);
  return await register.metrics();
}

// ─── Optional helpers for WS modules ───────────────────────────────────────────
// À utiliser dans ws-raw.ts si tu veux des helpers dédiés.
/*
export const incWs = () => wsConnections.inc();
export const decWs = () => wsConnections.dec();
export const incWsMsg = (type = "unknown") => wsMessagesTotal.inc({ type });
*/
