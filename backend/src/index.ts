// backend/src/index.ts
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import underPressure from "@fastify/under-pressure";

import authHttp from "./modules/auth/http.js";
import gameHttp from "./modules/game/http.js";
import chatHttp from "./modules/chat/http.js";
import tournamentHttp from "./modules/tournament/http.js";
import visitsHttp from "./modules/visits/http.js";
import { registerRawWs } from "./ws-raw.js";

import { registerHttpTimingHooks, sendMetrics } from "./common/metrics.js";

// ----- Role & Port ------------------
const ROLE = process.env.SERVICE_ROLE || "gateway";
const PORT = Number(
  process.env.PORT ||
    (ROLE === "gateway" ? 8000 :
     ROLE === "svc-auth" ? 8101 :
     ROLE === "svc-game" ? 8102 :
     ROLE === "svc-chat" ? 8103 :
     ROLE === "svc-tournament" ? 8104 :
     ROLE === "svc-visits" ? 8105 : 8000)
);
const HOST = "0.0.0.0";

// -------- App ------------------
const app = Fastify({ logger: true });

// Unifie X-Request-ID (provenant de Nginx) → req.id
app.addHook("onRequest", (req, _reply, done) => {
  const hdr = req.headers["x-request-id"];
  if (typeof hdr === "string" && hdr.length > 0) (req as any).id = hdr;
  done();
});

// WS seulement cote gateway, et AVANT les autres plugins
if (ROLE === "gateway") {
  registerRawWs(app);
}

// Plugins de base
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "https:", "wss:"],
    },
  },
});
await app.register(cors, { origin: true, credentials: true });
await app.register(underPressure);

// ----------- Routes selon role ----------------
if (ROLE === "gateway") {
  // Le gateway NE monte PAS les modules : il PROXY vers les services internes
  registerHttpProxy(app, "/api/users",       "http://auth:8101");
  registerHttpProxy(app, "/api/games",       "http://game:8102");
  registerHttpProxy(app, "/api/chat",        "http://chat:8103");
  registerHttpProxy(app, "/api/tournaments", "http://tournament:8104");
  // Visits : routes exactes (pour eviter d’aspirer tout /api/*)
  registerHttpProxy(app, "/api/visits",      "http://visits:8105");
  registerHttpProxy(app, "/api/visit",       "http://visits:8105");
} else if (ROLE === "svc-auth") {
  await app.register(authHttp,       { prefix: "/api/users" });
} else if (ROLE === "svc-game") {
  await app.register(gameHttp,       { prefix: "/api/games" });
} else if (ROLE === "svc-chat") {
  await app.register(chatHttp,       { prefix: "/api/chat" });
} else if (ROLE === "svc-tournament") {
  await app.register(tournamentHttp, { prefix: "/api/tournaments" });
} else if (ROLE === "svc-visits") {
  await app.register(visitsHttp,     { prefix: "/api" }); // contient /api/visits et /api/visit
} else {
  app.log.warn(`Unknown SERVICE_ROLE=${ROLE}; starting in gateway mode fallback`);
  registerHttpProxy(app, "/api", "http://auth:8101"); // fallback basique
}

// Hooks metriques
registerHttpTimingHooks(app);

// Renvoyer l'ID au client (debug)
app.addHook("onSend", async (req, reply, payload) => {
  reply.header("X-Request-ID", req.id);
  return payload;
});

// Health & Metrics 
app.get("/healthz", async () => "ok");
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

// Boot
await app.listen({ host: HOST, port: PORT });
app.log.info(`Service role=${ROLE} listening on ${PORT}`);


// Proxy HTTP basique (JSON) pour le gateway
function registerHttpProxy(app: FastifyInstance, prefix: string, target: string) {
  // match exact (ex: /api/visits) ET avec sous chemins (ex: /api/games/123)
  app.all(prefix, async (req, reply) => forward(req, reply, prefix, target));
  app.all(`${prefix}/*`, async (req, reply) => forward(req, reply, prefix, target));
}

async function forward(req: any, reply: any, _prefix: string, target: string) {
  const url = target + req.url;
  const method = req.method;

  const bodyNeeded = !["GET", "HEAD"].includes(method);
  const body = bodyNeeded
    ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}))
    : undefined;

  const headers: Record<string, string> = {
    ...(req.headers as Record<string, string>),
    "content-type": "application/json",
    "x-request-id": String((req as any).id || req.headers["x-request-id"] || ""),
  };

  const res = await fetch(url, { method, headers, body });

  // propage le content-type
  const ct = res.headers.get("content-type");
  if (ct) reply.header("content-type", ct);

  const text = await res.text();
  reply.code(res.status).send(text);
}


