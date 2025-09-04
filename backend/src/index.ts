// src/index.ts
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import underPressure from "@fastify/under-pressure";
import authHttp from "./modules/auth/http.js";
import gameHttp from "./modules/game/http.js";
import chatHttp from "./modules/chat/http.js";
import tournamentHttp from "./modules/tournament/http.js";
import visitsHttp from "./modules/visits/http.js";
import { registerRawWs } from "./ws-raw.js"; // Correction du nom d'export

import { registerHttpTimingHooks, sendMetrics } from "./common/metrics.js";

const app = Fastify({ logger: true });

app.addHook("onRequest", (req, _reply, done) => {
  const hdr = req.headers["x-request-id"];
  if (typeof hdr === "string" && hdr.length > 0) (req as any).id = hdr;
  done();
});


// WebSocket en PREMIER - avant tout autre middleware
registerRawWs(app);

// Puis les autres plugins
await app.register(helmet, { 
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https:", "wss:"],
    }
  }
});

await app.register(cors, {
  origin: true,
  credentials: true
});
await app.register(underPressure);

// Routes API
await app.register(authHttp,       { prefix: "/api/users" });
await app.register(gameHttp,       { prefix: "/api/games" });
await app.register(chatHttp,       { prefix: "/api/chat" });
await app.register(tournamentHttp, { prefix: "/api/tournaments" });
await app.register(visitsHttp,     { prefix: "/api" });

// Hooks métriques (latences HTTP)
registerHttpTimingHooks(app);

// Renvoyer l'ID au client pour faciliter le support/debug
app.addHook("onSend", async (req, reply, payload) => {
  reply.header("X-Request-ID", req.id);
  return payload;
});


// Health
app.get("/healthz", async () => "ok");

// Metrics (Registry unique = default + histogramme custom)
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

// Boot
const PORT = Number(process.env.PORT || 8000);
const HOST = "0.0.0.0";

await app.listen({ host: HOST, port: PORT });
app.log.info(`Backend listening on ${PORT}`);