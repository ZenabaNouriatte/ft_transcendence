// backend/src/index.ts
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import underPressure from "@fastify/under-pressure";

import visitsHttp from "./modules/visits/http.js";
import { registerRawWs } from "./ws-raw.js";
import { initDb } from "./database/index.js";
import { registerHttpTimingHooks, sendMetrics } from "./common/metrics.js";

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

const app = Fastify({ logger: true });

// Unifie X-Request-ID (provenant de Nginx) → req.id
app.addHook("onRequest", (req, _reply, done) => {
  const hdr = req.headers["x-request-id"];
  if (typeof hdr === "string" && hdr.length > 0) (req as any).id = hdr;
  done();
});

// WS & DB uniquement au gateway
if (ROLE === "gateway") {
  initDb();            // ← ouvre /data/app.sqlite
  registerRawWs(app);  // ← /ws
}

await app.register(helmet, {
  contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'","https:","wss:"] } },
});
await app.register(cors, { origin: true, credentials: true });
await app.register(underPressure);

// Routes selon rôle
if (ROLE === "gateway") {
  // Seul domaine “visits” est servi localement (dépend DB)
  await app.register(visitsHttp, { prefix: "/api" });

  // Les autres domaines sont PROXY vers les micro-services
  registerHttpProxy(app, "/api/users",       "http://auth:8101");
  registerHttpProxy(app, "/api/games",       "http://game:8102");
  registerHttpProxy(app, "/api/chat",        "http://chat:8103");
  registerHttpProxy(app, "/api/tournaments", "http://tournament:8104");

} else if (ROLE === "svc-auth") {
  const mod = await import("./modules/auth/http.js");
  await app.register(mod.default, { prefix: "/api/users" });

} else if (ROLE === "svc-game") {
  const mod = await import("./modules/game/http.js");
  await app.register(mod.default, { prefix: "/api/games" });

} else if (ROLE === "svc-chat") {
  const mod = await import("./modules/chat/http.js");
  await app.register(mod.default, { prefix: "/api/chat" });

} else if (ROLE === "svc-tournament") {
  const mod = await import("./modules/tournament/http.js");
  await app.register(mod.default, { prefix: "/api/tournaments" });

} else if (ROLE === "svc-visits") {
  // stateless (healthz/metrics only)
}

registerHttpTimingHooks(app);

app.addHook("onSend", async (req, reply, payload) => {
  reply.header("X-Request-ID", req.id);
  return payload;
});

app.get("/healthz", async () => "ok");
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

await app.listen({ host: HOST, port: PORT });
app.log.info(`Service role=${ROLE} listening on ${PORT}`);

// --- proxy helper ---
function registerHttpProxy(app: FastifyInstance, prefix: string, target: string) {
  app.all(prefix,        (req, reply) => forward(req, reply, target));
  app.all(`${prefix}/*`, (req, reply) => forward(req, reply, target));
}
async function forward(req: any, reply: any, target: string) {
  const url = target + req.url;
  const method = req.method;
  const bodyNeeded = !["GET","HEAD"].includes(method);
  const body = bodyNeeded ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {})) : undefined;
  const headers: Record<string,string> = {
    ...(req.headers as Record<string,string>),
    "content-type": "application/json",
    "x-request-id": String((req as any).id || req.headers["x-request-id"] || ""),
  };
  const res = await fetch(url, { method, headers, body });
  const ct = res.headers.get("content-type"); if (ct) reply.header("content-type", ct);
  const text = await res.text();
  reply.code(res.status).send(text);
}
