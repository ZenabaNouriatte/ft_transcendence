// backend/src/common/metrics.ts
import type { FastifyInstance, FastifyReply } from 'fastify';
import * as client from 'prom-client';

// Registry par défaut
const register = client.register;

// Métriques custom
export const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005,0.01,0.025,0.05,0.1,0.25,0.5,1,2,5],
});

export const wsConnections = new client.Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
});

register.registerMetric(httpDuration);
register.registerMetric(wsConnections);

// Collecte des métriques par défaut
client.collectDefaultMetrics({ register });

export function registerHttpTimingHooks(app: FastifyInstance) {
  app.addHook('onRequest', (req, _r, done) => { 
    (req as any)._t0 = process.hrtime.bigint(); 
    done(); 
  });
  
  app.addHook('onResponse', (req, reply, done) => {
    const t0 = (req as any)._t0 as bigint | undefined;
    if (t0) {
      const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
      const route = (req.routeOptions && req.routeOptions.url) || req.url;
      httpDuration
        .labels({ 
          method: req.method, 
          route, 
          status_code: String(reply.statusCode) 
        })
        .observe(seconds);
    }
    done();
  });
}

export const visitTotal = new client.Counter({
  name: "visits_total",
  help: "Total des visites comptées par le backend",
  // si tu n'utilises pas setDefaultLabels, dé-commente la ligne suivante et incrémente avec labels():
  // labelNames: ["service"],
});

register.registerMetric(visitTotal);

export async function sendMetrics(reply: FastifyReply) {
  reply.header('Content-Type', register.contentType);
  return register.metrics();
}