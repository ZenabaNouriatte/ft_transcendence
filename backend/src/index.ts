// backend/src/index.ts
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import underPressure from "@fastify/under-pressure";

import visitsHttp from "./modules/visits/http.js";
import { registerRawWs } from "./ws-raw.js";
import { initDb } from "./database/index.js";
import { TournamentService } from "./services/index.js";
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

// Propager X-Request-ID reçu vers request.id (sinon on garde celui généré par Fastify)
app.addHook("onRequest", (request, _reply, done) => {
  const hdr = request.headers["x-request-id"];
  if (typeof hdr === "string" && hdr.length > 0) {
    // @ts-ignore – on force l'id
    request.id = hdr;
  }
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
  // ⏳ Assurer l'init DB avant les routes
  await initDb();
  registerRawWs(app);

  const { UserService, GameService, StatsService } = await import("./services/index.js");

  await app.register(visitsHttp, { prefix: "/api" });

  async function getUserFromToken(request: FastifyRequest): Promise<number | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return null;

    const token = authHeader.substring(7);
    try {
      const response = await fetch("http://auth:8101/validate-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.ok) {
        const { userId } = await response.json();
        return userId;
      }
    } catch {
      /* noop */
    }
    return null;
  }


  // ===================== ROUTES AUTH ==================
  app.post("/api/users/register", async (request, reply) => {
    try {
      const resp = await fetch("http://auth:8101/validate-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body ?? {}),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return reply.code(resp.status).send({ error: "auth_validate_failed", details: data });
      }
  
      try {
        const userId = await UserService.createUser(data as any);
        await StatsService.initUserStats(userId);
        const user = await UserService.findUserById(userId);
        if (user) delete (user as any).password;
        return reply.code(201).send({ ok: true, userId, user });
      } catch (e: any) {
        if (e?.code === "SQLITE_CONSTRAINT" || /unique/i.test(String(e?.message))) {
          return reply.code(409).send({ error: "user_exists" });
        }
        request.log.error(e, "register_failed_db");
        return reply.code(500).send({ error: "register_failed" });
      }
    } catch (e) {
      request.log.error(e, "register_failed");
      return reply.code(500).send({ error: "register_failed" });
    }
  });
  

  app.get("/api/users", async () => {
    const users = await UserService.getAllUsers();
    return { users: users.map(({ password, ...rest }: any) => rest) };
  });

  app.post("/api/users/login", async (request, reply) => {
    try {
      const b = (request.body ?? {}) as any;
      const username = String(b.username || "");
      const password = String(b.password || "");
      if (!username || !password) return reply.code(400).send({ error: "invalid_payload" });

      const user = await UserService.findUserByUsername(username);
      if (!user) return reply.code(401).send({ error: "invalid_credentials" });

      const v = await fetch("http://auth:8101/validate-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, hashedPassword: (user as any).password }),
      });
      if (!v.ok) return reply.code(401).send({ error: "invalid_credentials" });

      const t = await fetch("http://auth:8101/generate-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const { token } = await t.json();

      const { password: _pw, ...userWithoutPassword } = user as any;
      return { ok: true, user: userWithoutPassword, token };
    } catch (e) {
      request.log.error(e, "login_failed");
      return reply.code(500).send({ error: "login_failed" });
    }
  });

  // ===================== ROUTES GAMES ==================
app.post("/api/games", async (request, reply) => {
  try {
    const userId = await getUserFromToken(request);
    if (!userId) return reply.code(401).send({ error: "Authentification requise" });

    const response = await fetch("http://game:8102/validate-game-creation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(request.body ?? {}), currentUserId: userId }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return reply.code(response.status).send(error);
    }

    const validatedData = await response.json();

    if (validatedData.player2_id && validatedData.player2_id > 0) {
      const player2 = await UserService.findUserById(validatedData.player2_id);
      if (!player2) return reply.code(404).send({ error: "Joueur 2 non trouvé" });
    }

    const gameId = await GameService.createGame({
      player1_id: validatedData.player1_id,
      player2_id: validatedData.player2_id ? Number(validatedData.player2_id) : null,
      status: validatedData.status,
      tournament_id: validatedData.tournament_id ?? null,
    });

    if (validatedData.updatePlayerStatus) {
      await UserService.updateUserStatus(userId, "ingame");
      if (validatedData.player2_id > 0) {
        await UserService.updateUserStatus(validatedData.player2_id, "ingame");
      }
    }

    return reply.code(201).send({
      message: validatedData.message,
      gameId,
      status: validatedData.status,
    });
  } catch (error) {
    request.log.error(error, "Game creation error");
    return reply.code(500).send({ error: "Game creation failed" });
  }
});

// GET /api/games - Récupérer toutes les parties
app.get("/api/games", async (request, reply) => {
  try {
    const { status } = request.query as { status?: string };

    const games = status === "active"
      ? await GameService.getActiveGames()
      : await GameService.getAllGames();

    return reply.send({ games });
  } catch (error) {
    request.log.error(error, "Games retrieval error");
    return reply.code(500).send({ error: "Games retrieval failed" });
  }
});


  // ===================== ROUTES TOURNAMENTS ==================
app.post("/api/tournaments", async (request, reply) => {
  try {
    const userId = await getUserFromToken(request);
    if (!userId) return reply.code(401).send({ error: "Authentification requise" });

    const v = await fetch("http://tournament:8104/validate-tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...(request.body ?? {}), created_by: userId }),
    });
    if (!v.ok) return reply.code(v.status).send(await v.json().catch(() => ({})));

    const raw = await v.json();

    // on donne à TS un shape compatible avec le DAO (pas de null pour 'description')
    const input: {
      name: string;
      description?: string;      // <- string | undefined
      max_players?: number;
      created_by: number;
    } = {
      name: String(raw.name),
      description: raw.description ?? undefined,   // <- transforme null en undefined
      max_players: typeof raw.max_players === "number" ? raw.max_players : undefined,
      created_by: Number(raw.created_by),
    };

    const tid = await TournamentService.createTournament(input);
    await TournamentService.joinTournament(tid, userId);
    return reply.code(201).send({ ok: true, tournamentId: tid });

  } catch (e) {
    request.log.error(e, "Tournament creation error");
    return reply.code(500).send({ error: "Tournament creation failed" });
  }
});


// Rejoindre un tournoi
app.post("/api/tournaments/:id/join", async (request, reply) => {
  try {
    const userId = await getUserFromToken(request);
    if (!userId) return reply.code(401).send({ error: "Authentification requise" });
    const id = Number((request.params as any).id);

    request.log.info({ userId, tournamentId: id }, "Tournament join attempt");

    const state = await TournamentService.findTournamentById(id);
    if (!state) {
      request.log.error(`Tournament not found: id=${id}`);
      return reply.code(404).send({ error: "not_found" });
    }

    request.log.info({ state }, "Tournament state");


    // validation métier
    const v = await fetch("http://tournament:8104/validate-tournament-join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tournamentState: state, currentUserId: userId }),
    });
    
    if (!v.ok) {
      const errorBody = await v.json().catch(() => ({}));
      request.log.error({ status: v.status, errorBody }, "Tournament join validation failed");
      return reply.code(v.status).send(errorBody);
    }

    const validationResult = await v.json();
    request.log.info({ validationResult }, "Tournament join validation success");

    // DB: vérifier non déjà inscrit puis inscrire
    const joinResult = await TournamentService.joinTournament(id, userId);
    request.log.info({ joinResult }, "Tournament join DB result");

    return reply.send({ ok: true });
  } catch (e) {
    request.log.error(e, "Tournament join error");
    return reply.code(500).send({ error: "Tournament join failed" });
  }
});

// Démarrer un tournoi
app.post("/api/tournaments/:id/start", async (request, reply) => {
  try {
    const userId = await getUserFromToken(request);
    if (!userId) return reply.code(401).send({ error: "Authentification requise" });
    const id = Number((request.params as any).id);

    const state = await TournamentService.findTournamentById(id);
    if (!state) return reply.code(404).send({ error: "not_found" });

    const v = await fetch("http://tournament:8104/validate-tournament-start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tournamentState: state, currentUserId: userId }),
    });
    if (!v.ok) return reply.code(v.status).send(await v.json().catch(() => ({})));

    await TournamentService.startTournament(id);
    return reply.send({ ok: true });
  } catch (e) {
    request.log.error(e, "Tournament start error");
    return reply.code(500).send({ error: "Tournament start failed" });
  }
});

// Listing & participants
app.get("/api/tournaments", async (_req, reply) => {
  const list = await TournamentService.getAllTournaments();
  return reply.send({ tournaments: list });
});
app.get("/api/tournaments/:id/participants", async (req, reply) => {
  const id = Number((req.params as any).id);
  const users = await TournamentService.getTournamentParticipants(id);
  const safe = users.map(({ password, ...u }: any) => u);
  return reply.send({ users: safe });
});

  // Routes de ping pour le testeur
  app.get("/api/users/ping", async () => ({ ok: true, service: "users" }));
  app.get("/api/games/ping", async () => ({ ok: true, service: "games" }));
  app.get("/api/chat/ping", async () => ({ ok: true, service: "chat" }));
  app.get("/api/tournaments/ping", async () => ({ ok: true, service: "tournaments" }));
}

// ==== MICROSERVICES (un seul rôle par process) ==============================
else if (ROLE === "svc-auth") {
  const { default: authPlugin } = await import("./modules/auth/http.js");
  await app.register(authPlugin);
} else if (ROLE === "svc-game") {
  const { default: gamePlugin } = await import("./modules/game/http.js");
  await app.register(gamePlugin);
} else if (ROLE === "svc-chat") {
  const { default: chatPlugin } = await import("./modules/chat/http.js");
  await app.register(chatPlugin);
} else if (ROLE === "svc-tournament") {
  const { default: tournamentPlugin } = await import("./modules/tournament/http.js");
  await app.register(tournamentPlugin);
} else if (ROLE === "svc-visits") {
  // stateless (healthz/metrics only)
}

// métriques HTTP
registerHttpTimingHooks(app);

// Propager l'ID au client (on renvoie celui de Fastify)
app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Request-ID", request.id);
  return payload;
});

app.get("/healthz", async () => "ok");
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

await app.listen({ host: HOST, port: PORT });
app.log.info(`Service role=${ROLE} listening on ${PORT}`);
