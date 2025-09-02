// src/common/metrics.ts
import client from "prom-client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const register = new client.Registry();

// (optionnel) labels par défaut pour faciliter les dashboards
register.setDefaultLabels({
  service: process.env.SERVICE_NAME || "backend",
});

client.collectDefaultMetrics({ register });

// Histogramme de latence HTTP (mêmes noms/labels/buckets que ta version)
export const httpDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});
register.registerMetric(httpDuration);

// (optionnel) compteur total de requêtes
export const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status_code"] as const,
});
register.registerMetric(httpRequestsTotal);

// Timer manuel réutilisable (si besoin autour de blocs métier)
export function startTimer() {
  const t0 = process.hrtime.bigint();
  return (labels: { method: string; route: string; status_code: number | string }) => {
    const s = Number(process.hrtime.bigint() - t0) / 1e9;
    httpDuration.labels({
      method: String(labels.method),
      route: String(labels.route),
      status_code: String(labels.status_code),
    }).observe(s);
  };
}

export async function sendMetrics(reply: FastifyReply) {
  reply.header("Content-Type", register.contentType);
  reply.send(await register.metrics());
}

// Instrumentation globale Fastify
export function registerHttpTimingHooks(app: FastifyInstance) {
  app.addHook("onRequest", (req, _reply, done) => {
    (req as any)._t0 = process.hrtime.bigint();
    done();
  });

  app.addHook("onResponse", (req: FastifyRequest, reply: FastifyReply, done) => {
    const t0 = (req as any)._t0 as bigint | undefined;
    if (!t0) return done();

    // évite de polluer les métriques avec /healthz et /metrics
    if (req.url === "/healthz" || req.url === "/metrics") return done();

    const s = Number(process.hrtime.bigint() - t0) / 1e9;
    const route = ((req as any).routeOptions?.url) || req.url || "unknown";

    const labels = {
      method: req.method,
      route,
      status_code: String(reply.statusCode),
    };

    httpDuration.labels(labels).observe(s);
    httpRequestsTotal.labels(labels).inc();

    done();
  });
}
