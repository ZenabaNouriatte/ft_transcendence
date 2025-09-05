// backend/src/common/metrics.ts
import type { FastifyInstance, FastifyReply } from "fastify";
import * as client from "prom-client";

// ---- Registry ----
const register = client.register;

// --- Helpers ---
function normalizeRoute(req: any, reply: any): string {
  const raw = reply?.context?.config?.url || req?.routerPath || req?.url || "";
  // /api/v1/users/123 -> /api/v1/users/:id
  return raw.replace(/\/\d+(\b|$)/g, "/:id");
}

//---- HTTP metrics -----
export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

export const httpInFlight = new client.Gauge({
  name: "http_requests_in_flight",
  help: "HTTP requests currently being served",
  labelNames: ["route"],
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

// --- WebSocket metrics ----
export const wsConnections = new client.Gauge({
  name: "websocket_connections_active",
  help: "Number of active WebSocket connections",
});

export const wsMessagesTotal = new client.Counter({
  name: "ws_messages_total",
  help: "Total WebSocket messages by type",
  labelNames: ["type"] as const, // ex: chat.message | game.input | invalid | unknown
});

// ------ Visits (exemple) ------
export const visitsDbTotal = new client.Gauge({
  name: "visits_db_total",
  help: "Total visits as stored in the DB (snapshot on reads)",
});

export const visitsApiIncrementsTotal = new client.Counter({
  name: "visits_api_increments_total",
  help: "Total increments done via POST /api/visit",
  labelNames: ["type"] as const, // ex: navigate | reload
});

// ---- Registration & Default metrics ----
register.registerMetric(httpDuration);
register.registerMetric(wsConnections);
register.registerMetric(wsMessagesTotal);
register.registerMetric(visitsDbTotal);
register.registerMetric(visitsApiIncrementsTotal);
register.registerMetric(httpInFlight);
register.registerMetric(wsDisconnectsTotal);
register.registerMetric(wsRateLimitedTotal);


client.collectDefaultMetrics({
  register,
  eventLoopMonitoringPrecision: 10, // active nodejs_eventloop_lag_seconds
});

// ----- Fastify hooks (HTTP timing) ------
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

    // in-flight-- (toujours, même si t0 manquant)
    try { httpInFlight.labels(route).dec(); } catch {}

    // durée
    if (m?.t0) {
      const seconds = Number(process.hrtime.bigint() - m.t0) / 1e9;
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

// ---- /metrics endpoint helper -----
export async function sendMetrics(reply: FastifyReply) {
  reply.header("Content-Type", register.contentType);
  return await register.metrics();
}
