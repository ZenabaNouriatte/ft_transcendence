// backend/src/metrics.ts
import type { FastifyInstance } from 'fastify';
import * as client from 'prom-client';

export async function registerMetrics(app: FastifyInstance) {
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2,5],
  });
  register.registerMetric(httpDuration);

  app.addHook('onRequest', (req, _r, done) => { (req as any)._t0 = process.hrtime.bigint(); done(); });
  app.addHook('onResponse', (req, reply, done) => {
    const t0 = (req as any)._t0 as bigint | undefined;
    if (t0) {
      const s = Number(process.hrtime.bigint() - t0) / 1e9;
      const route = (req.routeOptions && req.routeOptions.url) || req.url;
      httpDuration.labels({ method: req.method, route, status_code: String(reply.statusCode) }).observe(s);
    }
    done();
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', register.contentType);
    return register.metrics();
  });
}
