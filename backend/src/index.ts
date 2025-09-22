// // backend/src/index.ts
// import Fastify, { type FastifyInstance } from "fastify";
// import helmet from "@fastify/helmet";
// import cors from "@fastify/cors";
// import underPressure from "@fastify/under-pressure";

// import visitsHttp from "./modules/visits/http.js";
// import { registerRawWs } from "./ws-raw.js";
// import { initDb } from "./database/index.js";
// import { registerHttpTimingHooks, sendMetrics } from "./common/metrics.js";

// const ROLE = process.env.SERVICE_ROLE || "gateway";
// const PORT = Number(
//   process.env.PORT ||
//     (ROLE === "gateway" ? 8000 :
//      ROLE === "svc-auth" ? 8101 :
//      ROLE === "svc-game" ? 8102 :
//      ROLE === "svc-chat" ? 8103 :
//      ROLE === "svc-tournament" ? 8104 :
//      ROLE === "svc-visits" ? 8105 : 8000)
// );
// const HOST = "0.0.0.0";

// const app = Fastify({ logger: true });

// // Unifie X-Request-ID (provenant de Nginx) → req.id
// app.addHook("onRequest", (req, _reply, done) => {
//   const hdr = req.headers["x-request-id"];
//   if (typeof hdr === "string" && hdr.length > 0) (req as any).id = hdr;
//   done();
// });

// // WS & DB uniquement au gateway
// if (ROLE === "gateway") {
//   initDb();            // ← ouvre /data/app.sqlite
//   registerRawWs(app);  // ← /ws
// }

// await app.register(helmet, {
//   contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], connectSrc: ["'self'","https:","wss:"] } },
// });
// await app.register(cors, { origin: true, credentials: true });
// await app.register(underPressure);

// // Routes selon rôle
// if (ROLE === "gateway") {
//   // Seul domaine “visits” est servi localement (dépend DB)
//   await app.register(visitsHttp, { prefix: "/api" });


// // Gateway appelle le microservice pour la logique, puis sauvegarde en DB
// // === AUTH/USERS ROUTES ===
// app.post("/api/users/register", async (request, reply) => {
//   try {
//     // 1. Appel microservice pour validation
//     const response = await fetch("http://auth:8101/validate-register", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(request.body)
//     });
    
//     if (!response.ok) {
//       const error = await response.json();
//       return reply.code(response.status).send(error);
//     }

//     // 2. Gateway sauvegarde en DB
//     const validatedData = await response.json();
//     const userId = await usersRepo.create(validatedData);
    
//     reply.send({ success: true, userId, user: validatedData });
//   } catch (error) {
//     app.log.error(error, "Register error");
//     reply.code(500).send({ error: "Registration failed" });
//   }
// });

// app.post("/api/users/login", async (request, reply) => {
//   try {
//     // 1. Gateway récupère user de la DB
//     const { username } = request.body as any;
//     const user = await usersRepo.findByUsername(username);
    
//     if (!user) {
//       return reply.code(401).send({ error: "User not found" });
//     }

//     // 2. Appel microservice pour validation password
//     const response = await fetch("http://auth:8101/validate-login", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ ...request.body, userFromDb: user })
//     });

//     const result = await response.json();
//     reply.code(response.status).send(result);
//   } catch (error) {
//     app.log.error(error, "Login error");
//     reply.code(500).send({ error: "Login failed" });
//   }
// });

// app.get("/api/users/profile/:id", async (request, reply) => {
//   const { id } = request.params as { id: string };
//   const user = await usersRepo.findById(parseInt(id));
  
//   if (!user) {
//     return reply.code(404).send({ error: "User not found" });
//   }
  
//   reply.send(user);
// });

// // === GAMES ROUTES ===
// app.post("/api/games/create", async (request, reply) => {
//   try {
//     // 1. Appel microservice pour logique de jeu
//     const response = await fetch("http://game:8102/process-game-creation", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(request.body)
//     });

//     if (!response.ok) {
//       const error = await response.json();
//       return reply.code(response.status).send(error);
//     }

//     // 2. Gateway sauvegarde en DB
//     const gameData = await response.json();
//     const gameId = await gamesRepo.create(gameData);
    
//     reply.send({ gameId, ...gameData });
//   } catch (error) {
//     app.log.error(error, "Game creation error");
//     reply.code(500).send({ error: "Game creation failed" });
//   }
// });

// app.get("/api/games", async (request, reply) => {
//   // Direct DB (pas de logique métier)
//   const games = await gamesRepo.list();
//   reply.send(games);
// });

// app.post("/api/games/:id/move", async (request, reply) => {
//   const { id } = request.params as { id: string };
//   try {
//     // 1. Gateway récupère game de la DB
//     const game = await gamesRepo.findById(parseInt(id));
//     if (!game) {
//       return reply.code(404).send({ error: "Game not found" });
//     }

//     // 2. Appel microservice pour traiter le mouvement
//     const response = await fetch("http://game:8102/process-move", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ 
//         ...request.body, 
//         gameState: game 
//       })
//     });

//     if (!response.ok) {
//       const error = await response.json();
//       return reply.code(response.status).send(error);
//     }

//     // 3. Gateway met à jour en DB
//     const result = await response.json();
//     if (result.updateGame) {
//       await gamesRepo.updateScore(parseInt(id), result.player1_score, result.player2_score);
//       if (result.finished) {
//         await gamesRepo.finish(parseInt(id), result.winner_id);
//       }
//     }
    
//     reply.send(result);
//   } catch (error) {
//     app.log.error(error, "Move processing error");
//     reply.code(500).send({ error: "Move processing failed" });
//   }
// });

// // === CHAT ROUTES ===
// app.post("/api/chat/send", async (request, reply) => {
//   try {
//     // 1. Appel microservice pour validation/filtrage
//     const response = await fetch("http://chat:8103/validate-message", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(request.body)
//     });

//     if (!response.ok) {
//       const error = await response.json();
//       return reply.code(response.status).send(error);
//     }

//     // 2. Gateway sauvegarde en DB
//     const validatedMessage = await response.json();
//     const messageId = await chatRepo.sendMessage(validatedMessage);
    
//     reply.send({ messageId, ...validatedMessage });
//   } catch (error) {
//     app.log.error(error, "Chat send error");
//     reply.code(500).send({ error: "Message send failed" });
//   }
// });

// app.get("/api/chat/messages/:userId", async (request, reply) => {
//   const { userId } = request.params as { userId: string };
//   // Direct DB
//   const messages = await chatRepo.getMessages(parseInt(userId));
//   reply.send(messages);
// });

// // === TOURNAMENT ROUTES ===
// app.post("/api/tournaments/create", async (request, reply) => {
//   try {
//     // 1. Appel microservice pour logique tournoi
//     const response = await fetch("http://tournament:8104/validate-tournament", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(request.body)
//     });

//     if (!response.ok) {
//       const error = await response.json();
//       return reply.code(response.status).send(error);
//     }

//     // 2. Gateway sauvegarde en DB
//     const tournamentData = await response.json();
//     const tournamentId = await tournamentsRepo.create(tournamentData);
    
//     reply.send({ tournamentId, ...tournamentData });
//   } catch (error) {
//     app.log.error(error, "Tournament creation error");
//     reply.code(500).send({ error: "Tournament creation failed" });
//   }
// });

// app.get("/api/tournaments", async (request, reply) => {
//   // Direct DB
//   const tournaments = await tournamentsRepo.list();
//   reply.send(tournaments);
// });

// // Routes de ping pour le testeur
// app.get("/api/users/ping", async () => ({ ok: true, service: "users" }));
// app.get("/api/games/ping", async () => ({ ok: true, service: "games" }));
// app.get("/api/chat/ping", async () => ({ ok: true, service: "chat" }));
// app.get("/api/tournaments/ping", async () => ({ ok: true, service: "tournaments" }));

// } else if (ROLE === "svc-auth") {
//   const mod = await import("./modules/auth/http.js");
//   await app.register(mod.default, { prefix: "/api/users" });

// } else if (ROLE === "svc-game") {
//   const mod = await import("./modules/game/http.js");
//   await app.register(mod.default, { prefix: "/api/games" });

// } else if (ROLE === "svc-chat") {
//   const mod = await import("./modules/chat/http.js");
//   await app.register(mod.default, { prefix: "/api/chat" });

// } else if (ROLE === "svc-tournament") {
//   const mod = await import("./modules/tournament/http.js");
//   await app.register(mod.default, { prefix: "/api/tournaments" });

// } else if (ROLE === "svc-visits") {
//   // stateless (healthz/metrics only)
// }

// registerHttpTimingHooks(app);

// app.addHook("onSend", async (req, reply, payload) => {
//   reply.header("X-Request-ID", req.id);
//   return payload;
// });

// app.get("/healthz", async () => "ok");
// app.get("/metrics", async (_req, reply) => sendMetrics(reply));

// await app.listen({ host: HOST, port: PORT });
// app.log.info(`Service role=${ROLE} listening on ${PORT}`);

// // --- proxy helper ---
// function registerHttpProxy(app: FastifyInstance, prefix: string, target: string) {
//   app.all(prefix,        (req, reply) => forward(req, reply, target));
//   app.all(`${prefix}/*`, (req, reply) => forward(req, reply, target));
// }
// async function forward(req: any, reply: any, target: string) {
//   const url = target + req.url;
//   const method = req.method;
//   const bodyNeeded = !["GET","HEAD"].includes(method);
//   const body = bodyNeeded ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {})) : undefined;
//   const headers: Record<string,string> = {
//     ...(req.headers as Record<string,string>),
//     "content-type": "application/json",
//     "x-request-id": String((req as any).id || req.headers["x-request-id"] || ""),
//   };
//   const res = await fetch(url, { method, headers, body });
//   const ct = res.headers.get("content-type"); if (ct) reply.header("content-type", ct);
//   const text = await res.text();
//   reply.code(res.status).send(text);
// }

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

// Propager X-Request-ID
app.addHook("onRequest", (req, _reply, done) => {
  const hdr = req.headers["x-request-id"];
  if (typeof hdr === "string" && hdr.length > 0) (req as any).id = hdr;
  done();
});

// Plugins communs
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

// ==== GATEWAY ===============================================================
if (ROLE === "gateway") {
  // DB + WS uniquement côté gateway
  initDb();
  registerRawWs(app);

  // Import dynamique des repos UNIQUEMENT dans la branche gateway
  const { usersRepo, gamesRepo, chatRepo, tournamentsRepo } = await import("./database/index.js");

  // Visits (sert aussi de smoke-test DB)
  await app.register(visitsHttp, { prefix: "/api" });

  // --- Helper HTTP pour parler aux microservices (choreography) ---
  async function forwardJson(
    target: string,
    method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE",
    body?: any,
    headers?: Record<string,string>
  ) {
    const res = await fetch(target, {
      method,
      headers: {
        "content-type": "application/json",
        ...(headers || {}),
        "x-request-id": String((headers?.["x-request-id"]) || ""),
      },
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    });
    let data: unknown = null;
    try { data = await res.json(); } catch { /* backend a peut-être renvoyé du texte */ }
    return { ok: res.ok, status: res.status, data };
  }

  // ===================== EXEMPLES (tu peux adapter ensuite) ==================
  // REGISTER: validate côté svc-auth puis write DB côté gateway
  app.post("/api/users/register", async (req, reply) => {
    const { ok, status, data } = await forwardJson(
      "http://auth:8101/validate-register",
      "POST",
      req.body,
      { "x-request-id": String((req as any).id || "") }
    );
  
    if (!ok || typeof data !== "object" || data === null) {
      return reply.code(status || 502).send({ error: "auth_validate_failed" });
    }
  
    const b = data as any;
    const username = String(b.username || "").trim();
    const email = String(b.email || "").trim();
    const password = String(b.password || "");     // ← requis par usersRepo
    const avatar = b.avatar ? String(b.avatar) : null;
  
    if (!username || !password) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
  
    try {
      // usersRepo.create(...) retourne un ID (number), pas un objet
      const userId: number = await usersRepo.create({ username, email, password, avatar });
      return reply.send({ ok: true, userId, user: { id: userId, username, email, avatar } });
    } catch (e) {
      req.log.error(e, "register DB error");
      return reply.code(500).send({ error: "db_error" });
    }
  });

  // LOGIN: validate côté svc-auth (le gateway ne touche pas la DB ici)
  app.post("/api/users/login", async (req, reply) => {
    const { ok, status, data } = await forwardJson("http://auth:8101/validate-login", "POST", req.body, {
      "x-request-id": String((req as any).id || ""),
    });
    if (!ok) return reply.code(status || 502).send({ error: "auth_validate_failed" });
    return reply.send({ ok: true, data }); // ne pas spread un inconnu
  });

  // GAMES: création validée côté svc-game puis persistée côté gateway
  app.post("/api/games", async (req, reply) => {
    const { ok, status, data } = await forwardJson("http://game:8102/validate-game", "POST", req.body, {
      "x-request-id": String((req as any).id || ""),
    });
    if (!ok || typeof data !== "object" || data === null) {
      return reply.code(status || 502).send({ error: "game_validate_failed" });
    }
    try {
      const game = await gamesRepo.create(
        // @ts-ignore structure minimale
        { status: (data as any).status ?? "waiting" }
      );
      return reply.send({ ok: true, game });
    } catch (e) {
      req.log.error(e, "game create DB error");
      return reply.code(500).send({ error: "db_error" });
    }
  });

  // CHAT: ex. validation message (stateless) côté svc-chat
  app.post("/api/chat/message", async (req, reply) => {
    const { ok, status, data } = await forwardJson("http://chat:8103/validate-message", "POST", req.body, {
      "x-request-id": String((req as any).id || ""),
    });
    if (!ok) return reply.code(status || 502).send({ error: "chat_validate_failed" });
    // Optionnel: persist dans une table messages si tu en crées une
    // await chatRepo.saveMessage(...)
    return reply.send({ ok: true, data });
  });

  // TOURNAMENTS: validation côté svc-tournament puis persist côté gateway
  app.post("/api/tournaments", async (req, reply) => {
    const { ok, status, data } = await forwardJson("http://tournament:8104/validate-tournament", "POST", req.body, {
      "x-request-id": String((req as any).id || ""),
    });
    if (!ok || typeof data !== "object" || data === null) {
      return reply.code(status || 502).send({ error: "tournament_validate_failed" });
    }
    try {
      const t = await tournamentsRepo.create(
        // @ts-ignore structure minimale
        { name: (data as any).name ?? "Unnamed", rules: (data as any).rules ?? "{}" }
      );
      return reply.send({ ok: true, tournament: t });
    } catch (e) {
      req.log.error(e, "tournament create DB error");
      return reply.code(500).send({ error: "db_error" });
    }
  });

  // Fallback: tout le reste continue à être proxifié vers les services si tu veux
  // registerHttpProxy(app, "/api/users", "http://auth:8101");
  // registerHttpProxy(app, "/api/games", "http://game:8102");
  // registerHttpProxy(app, "/api/chat", "http://chat:8103");
  // registerHttpProxy(app, "/api/tournaments", "http://tournament:8104");
}
// ==== FIN GATEWAY ===========================================================

// Microservices: uniquement /healthz + /metrics + routes locales propres au service
if (ROLE === "svc-auth") {
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
