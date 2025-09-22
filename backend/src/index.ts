// // backend/src/index.ts

// Microservices: uniquement /healthz + /metrics + routes locales propres au service
if (ROLE === "svc-auth") {
  const mod = await import("./modules/auth/http.js");
  await app.register(mod.default);
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

// métriques HTTP
registerHttpTimingHooks(app);

// Propager l'ID au client
app.addHook("onSend", async (req, reply, payload) => {
  reply.header("X-Request-ID", req.id);
  return payload;
});

app.get("/healthz", async () => "ok");
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

await app.listen({ host: HOST, port: PORT });
app.log.info(`Service role=${ROLE} listening on ${PORT}`);

// --- proxy helper (optionnel) ---
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
