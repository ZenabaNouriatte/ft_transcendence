// backend/src/index.ts
import Fastify, { type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import underPressure from "@fastify/under-pressure";

import visitsHttp from "./modules/visits/http.js";
import { registerRawWs } from "./ws-raw.js";
import { initDb } from "./database/index.js";
import { UserService, GameService, StatsService, TournamentService, FriendshipService } from "./services/index.js";
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

/*sécuriser API gateway en limitant qui peut y accéder :
Helmet durcit les en-têtes HTTP (CSP, pas d’embed, contrôle des sources).
CORS n’autorise que ton frontend (whitelist) à appeler l’API avec cookies/tokens, au lieu d’ouvrir l’accès à tout le web (origin:true). */

const FRONT_ORIGINS = (process.env.FRONT_ORIGINS || "http://localhost:5173").split(",");

await app.register(helmet, {
  crossOriginResourcePolicy: false, // pas utile pour API JSON
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'none'"],                    // API only
      connectSrc: ["'self'", ...FRONT_ORIGINS, "https:", "wss:"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],   // OK si tu renvoies un peu d’HTML; sinon tu peux retirer
      scriptSrc: ["'self'"],                     // l’API ne sert pas de scripts tiers
      frameAncestors: ["'none'"],                // empêche l’embed
    },
  },
});

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);               // requêtes server-to-server
    cb(null, FRONT_ORIGINS.includes(origin));         // whitelist stricte
  },
  credentials: true,                                   // autorise cookies/Authorization
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["X-Request-ID"],
});

await app.register(underPressure);




// ===================== ROUTAGE PAR RÔLE (UNE SEULE CHAÎNE) ==================
if (ROLE === "gateway") {
  // init DB avant les routes
  await initDb();
  registerRawWs(app);

//  const { UserService, GameService, StatsService } = await import("./services/index.js");
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

  function safeUser(u: any) {
    if (!u) return null;
    const { password, ...rest } = u;
    return { ...rest, avatar: u.avatar ?? UserService.defaultAvatar(u.username) };
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

  app.get("/api/games", async (request, reply) => {
    try {
      const { status, limit, offset } = request.query as { status?: string; limit?: string; offset?: string };
      const lim = Math.min(Math.max(Number(limit ?? 50), 1), 200);   // 1..200
      const off = Math.max(Number(offset ?? 0), 0);

      const games = status === "active"
        ? await GameService.getActiveGames(lim, off)
        : await GameService.getAllGames(lim, off);

      return reply.send({ games, limit: lim, offset: off });
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
      const input: {
        name: string;
        description?: string;
        max_players?: number;
        created_by: number;
      } = {
        name: String(raw.name),
        description: raw.description ?? undefined,
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

  app.post("/api/tournaments/:id/join", async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) return reply.code(401).send({ error: "Authentification requise" });
      const id = Number((request.params as any).id);

      request.log.info({ userId, tournamentId: id }, "Tournament join attempt");
      const state = await TournamentService.findTournamentById(id);
      if (!state) return reply.code(404).send({ error: "not_found" });

      const v = await fetch("http://tournament:8104/validate-tournament-join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tournamentState: state, currentUserId: userId }),
      });
      if (!v.ok) return reply.code(v.status).send(await v.json().catch(() => ({})));

      await TournamentService.joinTournament(id, userId);
      return reply.send({ ok: true });
    } catch (e) {
      request.log.error(e, "Tournament join error");
      return reply.code(500).send({ error: "Tournament join failed" });
    }
  });

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

  // ===================== ROUTES USER (profile / friendships) ==================
  app.put("/api/users/profile", async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) return reply.code(401).send({ error: "Authentification requise" });

      // validation amont par svc-user (on garde la séparation)
      const v = await fetch("http://user:8106/validate-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body ?? {}),
      });
      if (!v.ok) return reply.code(v.status).send(await v.json().catch(() => ({})));
      const data = await v.json();

      // Unicité via services
      if (data.username) {
        const u = await UserService.findUserByUsername(data.username);
        if (u && u.id !== userId) return reply.code(409).send({ error: "username_taken" });
      }
      if (data.email) {
        const u = await UserService.findUserByEmail(data.email);
        if (u && u.id !== userId) return reply.code(409).send({ error: "email_taken" });
      }

      // MAJ via service (plus de SQL inline ici)
      await UserService.updateProfile(userId, {
        username: data.username ?? null,
        email:    data.email ?? null,
        avatar:   data.avatar ?? null,
      });

      const updated = await UserService.findUserById(userId);
      return reply.send({ ok: true, user: safeUser(updated) });
    } catch (e) {
      request.log.error(e, "Profile update error");
      return reply.code(500).send({ error: "Profile update failed" });
    }
  });


  app.post("/api/users/:id/friendship", async (request, reply) => {
    try {
      const selfId = await getUserFromToken(request);
      if (!selfId) return reply.code(401).send({ error: "Authentification requise" });
      const targetId = Number((request.params as any).id);

      // validation amont par svc-user
      const v = await fetch("http://user:8106/validate-friendship", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(request.body ?? {}), selfId, targetId }),
      });
      if (!v.ok) return reply.code(v.status).send(await v.json().catch(() => ({})));
      const { action } = await v.json();

      if (action === "request")      await FriendshipService.request(selfId, targetId);
      else if (action === "accept")  await FriendshipService.accept(selfId, targetId);
      else if (action === "block")   await FriendshipService.block(selfId, targetId);

      return reply.send({ ok: true });
    } catch (e) {
      request.log.error(e, "Friendship error");
      return reply.code(500).send({ error: "Friendship failed" });
    }
  });


  app.get("/api/users/me", async (req, reply) => {
    const userId = await getUserFromToken(req);
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const u = await UserService.findUserById(userId);
    if (!u) return reply.code(404).send({ error: "not_found" });

    const stats = await StatsService.getUserStats(userId);
    return reply.send({ user: safeUser(u), stats });
  });

  app.get("/api/users/:id/profile", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });

    const u = await UserService.findUserById(id);
    if (!u) return reply.code(404).send({ error: "not_found" });

    const stats = await StatsService.getUserStats(id);
    const history = await UserService.getUserHistory(id, 20);

    return reply.send({ user: safeUser(u), stats, history });
  });

  app.get("/api/users/:id/friends", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });

    const rows = await UserService.getFriends(id);
    const friends = rows.map((r: any) => ({
      id: r.id,
      username: r.username,
      status: r.status,
      relation: r.relation,
      avatar: r.avatar ?? UserService.defaultAvatar(r.username),
      since: r.created_at,
    }));
    return reply.send({ friends });
  });


  app.get("/api/users/search", async (req, reply) => {
    const q = String((req.query as any).q ?? "").trim();
    const limit = Math.min(Math.max(Number((req.query as any).limit ?? 20), 1), 100); // 1..100
    const offset = Math.max(Number((req.query as any).offset ?? 0), 0);

    if (q.length < 2) return reply.code(400).send({ error: "query_too_short" });

    const users = await UserService.searchUsers(q, limit, offset);
    const out = users.map((u: any) => ({
      ...u,
      avatar: u.avatar ?? UserService.defaultAvatar(u.username),
    }));

    return reply.send({ users: out, limit, offset });
  });

  app.get("/api/users/:id/tournaments", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });

    const tournaments = await UserService.getUserTournaments(id);
    return reply.send({ tournaments });
  });

  // Terminer une partie (score + vainqueur) + remettre les joueurs online + MAJ stats
  app.post("/api/games/:id/finish", async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) return reply.code(401).send({ error: "Authentification requise" });

      const id = Number((request.params as any).id);
      const body = (request.body ?? {}) as { winner_id?: number; player1_score?: number; player2_score?: number };

      const winner_id = Number(body.winner_id);
      const p1s = Number(body.player1_score ?? 0);
      const p2s = Number(body.player2_score ?? 0);
      if (!Number.isInteger(id) || !Number.isInteger(winner_id)) {
        return reply.code(400).send({ error: "bad_id_or_payload" });
      }

      // Récupérer la game pour connaître les joueurs
      const game = await GameService.findGameById(id);
      if (!game) return reply.code(404).send({ error: "not_found" });
      if (game.status === "finished") return reply.send({ ok: true, already: true });

      if (winner_id !== game.player1_id && winner_id !== game.player2_id) {
        return reply.code(400).send({ error: "winner_not_in_game" });
      }

      // Persister fin de partie
      await GameService.finishGame(id, winner_id, p1s, p2s);

      // Mettre les joueurs ONLINE (simple et clair pour le module)
      if (game.player1_id) await UserService.updateUserStatus(game.player1_id, "online");
      if (game.player2_id) await UserService.updateUserStatus(game.player2_id, "online");

      // MAJ des stats
      await StatsService.updateStatsAfterGame(id);

      return reply.send({ ok: true, winner_id });
    } catch (e) {
      request.log.error(e, "Game finish error");
      return reply.code(500).send({ error: "Game finish failed" });
    }
  });


  // Routes de ping pour le testeur
  app.get("/api/users/ping", async () => ({ ok: true, service: "users" }));
  app.get("/api/games/ping", async () => ({ ok: true, service: "games" }));
  app.get("/api/chat/ping", async () => ({ ok: true, service: "chat" }));
  app.get("/api/tournaments/ping", async () => ({ ok: true, service: "tournaments" }));

// ==== MICROSERVICES =========================================================
} else if (ROLE === "svc-auth") {
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

} else if (ROLE === "svc-user") {
  const { default: userPlugin } = await import("./modules/user/http.js");
  await app.register(userPlugin);

} else if (ROLE === "svc-visits") {
  // stateless (healthz/metrics only)
}

// ===================== HOOKS COMMUNS + LISTEN ==============================
registerHttpTimingHooks(app);

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Request-ID", request.id);
  return payload;
});

app.get("/healthz", async () => "ok");
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

await app.listen({ host: HOST, port: PORT });
app.log.info(`Service role=${ROLE} listening on ${PORT}`);
