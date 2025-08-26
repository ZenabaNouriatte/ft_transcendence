const fastify = require('fastify')({ logger: true });

// ---------- Middlewares / plugins ----------
fastify.register(require('@fastify/helmet'), { 
  contentSecurityPolicy: false 
});
fastify.register(require('@fastify/formbody'));


// ---------- Prometheus metrics (CommonJS) ----------
const client = require('prom-client');

// registre séparé pour bien contrôler ce qu'on expose
const register = new client.Registry();
// métriques Node par défaut (heap, event loop lag, etc.)
client.collectDefaultMetrics({ register });

// histogramme pour calculer p95/p99 des latences HTTP
const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});
register.registerMetric(httpDuration);

// Hooks Fastify pour mesurer la durée par requête
fastify.addHook('onRequest', (req, _reply, done) => {
  req._t0 = process.hrtime.bigint();
  done();
});

fastify.addHook('onResponse', (req, reply, done) => {
  if (req._t0) {
    const s = Number(process.hrtime.bigint() - req._t0) / 1e9;
    const route = (req.routeOptions && req.routeOptions.url) || req.url;
    httpDuration.labels({
      method: req.method,
      route,
      status_code: String(reply.statusCode),
    }).observe(s);
  }
  done();
});

// endpoint métriques **au niveau racine** (pas de /api)
fastify.get('/metrics', async (_req, reply) => {
  reply.header('Content-Type', register.contentType);
  return register.metrics();
});

// ---------- DB ----------
const { addVisit, countVisits } = require('./db');

// ---------- Routes ----------
fastify.get("/healthz", async () => "ok");

fastify.get("/api/ping", async () => ({ ok: true }));

fastify.get("/api/hello", async () => ({ message: "hello from backend" }));

fastify.post("/api/visit", async (req, reply) => {
  try {
    await addVisit();
    const total = await countVisits();
    return { total };
  } catch (e) {
    req.log.error(e);
    reply.code(500);
    return { error: 'db_error' };
  }
});

fastify.get("/api/visits", async (req, reply) => {
  try {
    const total = await countVisits();
    return { total };
  } catch (e) {
    req.log.error(e);
    reply.code(500);
    return { error: "db_error" };
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 8000;
const HOST = '0.0.0.0';

const start = async () => {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`Backend running on port ${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();