import Fastify from "fastify";
import helmet from "@fastify/helmet";
import underPressure from "@fastify/under-pressure";

import { registerHttpTimingHooks, sendMetrics } from "./common/metrics.js";

const app = Fastify({ logger: true });

// Plugins de base
await app.register(helmet, { contentSecurityPolicy: false });
await app.register(underPressure);

// Hooks métriques (latences HTTP)
registerHttpTimingHooks(app);

// Health
app.get("/healthz", async () => "ok");

// Metrics (Registry unique = default + histogramme custom)
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

// (Routes API viendront plus tard en S1+)

// Boot
const PORT = Number(process.env.PORT || 8000); // ← garde 8000 si Prom scrape déjà ce port
const HOST = "0.0.0.0";

await app.listen({ host: HOST, port: PORT });
app.log.info(`Backend listening on ${PORT}`);