const fastify = require('fastify')({ logger: true });

// ---------- Middlewares / plugins ----------
fastify.register(require('@fastify/helmet'), { 
  contentSecurityPolicy: false 
});
fastify.register(require('@fastify/formbody'));

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