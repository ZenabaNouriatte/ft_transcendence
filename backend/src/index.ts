// backend/src/index.ts (merged)

import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import underPressure from "@fastify/under-pressure";

import visitsHttp from "./modules/visits/http.js";
import { registerRawWs } from "./ws-raw.js";
import { initDb } from "./database/index.js";
import {
  UserService,
  GameService,
  StatsService,
  TournamentService,
  FriendshipService,
} from "./services/index.js";
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

// -------- X-Request-ID propagation
app.addHook("onRequest", (request, _reply, done) => {
  const hdr = request.headers["x-request-id"];
  if (typeof hdr === "string" && hdr.length > 0) {
    // @ts-ignore
    request.id = hdr;
  }
  done();
});

// -------- Security (helmet + strict CORS whitelist)
const FRONT_ORIGINS = (process.env.FRONT_ORIGINS || "http://localhost:5173").split(",");

await app.register(helmet, {
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'none'"],
      connectSrc: ["'self'", ...FRONT_ORIGINS, "https:", "wss:"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
});

await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server
    cb(null, FRONT_ORIGINS.includes(origin));
  },
  credentials: true,
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["X-Request-ID"],
});

await app.register(underPressure);

// ===================== ROUTAGE PAR RÔLE =====================
let roomManager: any | null = null;

if (ROLE === "gateway") {
  // Init DB + WS + Game system
  await initDb();
  registerRawWs(app);

  let roomManager: any;
  
  try {
    const { GameRoomManager } = await import("./modules/game/engine/gameRoomManager.js");
    roomManager = new GameRoomManager();
    console.log("GameRoomManager initialized successfully");
  } catch (error) {
    console.error("Failed to initialize GameRoomManager:", error);
    // Créer un roomManager mock pour éviter les erreurs
    roomManager = {
      createRoom: () => ({ 
        addPlayer: () => true,
        getGameState: () => ({}),
        getStatus: () => 'waiting',
        getPlayers: () => new Map()
      }),
      getRoom: () => null,
      startGame: () => false,
      movePaddle: () => false,
      getStats: () => ({ totalRooms: 0, activeGames: 0, totalPlayers: 0 })
    };
  }

  process.on("SIGINT", () => {
    app.log.info("🛑 Shutting down game system...");
    if (roomManager && roomManager.shutdown) {
      roomManager.shutdown();
    }
    process.exit(0);
  });

  // Modules communs
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
    } catch {/* noop */}
    return null;
  }

  const safeUser = (u: any) => {
    if (!u) return null;
    const { password, ...rest } = u;
    return { ...rest, avatar: u.avatar ?? UserService.defaultAvatar(u.username) };
  };

  // ===================== AUTH =====================
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

  // ===================== GAMES =====================

  // Flux "officiel" (auth + validation par svc-game)
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

  // Flux "local/démo" temps réel (pas d’auth) — ex version anais
  app.post("/api/games/local", async (request, reply) => {
    try {
      const { player1, player2, type } = (request.body ?? {}) as any;

      if (!player1 || !player2) {
        return reply.code(400).send({ error: "Les noms des joueurs sont requis" });
      }
      if (!type || type !== "pong") {
        return reply.code(400).send({ error: "Type de jeu invalide" });
      }

      // créer/obtenir utilisateurs "temp"
      let player1Id: number;
      let player2Id: number | null = null;

      let existingPlayer1 = await UserService.findUserByUsername(player1);
      if (!existingPlayer1) {
        player1Id = await UserService.createUser({
          username: player1,
          email: `${player1}@temp.local`,
          password: "temp123",
        });
      } else player1Id = existingPlayer1.id!;

      if (player2) {
        let existingPlayer2 = await UserService.findUserByUsername(player2);
        if (!existingPlayer2) {
          player2Id = await UserService.createUser({
            username: player2,
            email: `${player2}@temp.local`,
            password: "temp123",
          });
        } else player2Id = existingPlayer2.id!;
      }

      // DB: trace de la partie
      const gameId = await GameService.createGame({
        player1_id: player1Id,
        player2_id: player2Id,
        status: "waiting",
        tournament_id: null,
      });

      // Room temps réel
      const roomId = Date.now().toString();
      const gameRoom = roomManager.createRoom(roomId);
      gameRoom.addPlayer("player1", player1);
      gameRoom.addPlayer("player2", player2);

      request.log.info({ gameId, roomId, player1, player2 }, "Local game created");

      return reply.code(201).send({
        gameId: roomId, // l’ID retourné au client est celui de la room RT
        player1,
        player2,
        status: "waiting",
      });
    } catch (error) {
      request.log.error(error, "Local game creation error");
      return reply.code(500).send({ error: "Échec de la création de partie" });
    }
  });

  // Liste des games (avec pagination)
  app.get("/api/games", async (request, reply) => {
    try {
      const { status, limit, offset } = request.query as { status?: string; limit?: string; offset?: string };
      const lim = Math.min(Math.max(Number(limit ?? 50), 1), 200);
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

  // Dans votre route /api/games/local existante, ajoutez ces logs :


  // --- Temps réel: état / start / paddle / stats (anais)
  app.get("/api/games/:id/state", async (request, reply) => {
    try {
      const gameId = (request.params as any).id;
      if (!gameId) return reply.code(400).send({ error: "ID de partie invalide" });

      const room = roomManager.getRoom(gameId);
      if (room) {
        const gameState = room.getGameState();
        const players = room.getPlayers();
        const status = room.getStatus();

        return reply.send({
          gameState,
          players: Array.from(players.values()),
          status,
          gameId,
        });
      }

      // fallback DB si room absente
      const gameIdNum = Number(gameId);
      if (!isNaN(gameIdNum)) {
        const game = await GameService.findGameById(gameIdNum);
        if (game) {
          return reply.send({
            gameId,
            status: game.status,
            player1: game.player1_id,
            player2: game.player2_id,
            created_at: game.created_at,
          });
        }
      }

      return reply.code(404).send({ error: "Partie non trouvée" });
    } catch (error) {
      request.log.error(error, "Game state error");
      return reply.code(500).send({ error: "Erreur lors de la récupération de l'état" });
    }
  });

  app.post("/api/games/:id/start", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const success = roomManager.startGame(id);
      if (success) return reply.send({ success: true, message: "Game started" });
      return reply.code(404).send({ error: "Game not found" });
    } catch (error) {
      request.log.error(error, "Start game error");
      return reply.code(500).send({ error: "Failed to start game" });
    }
  });

  app.post("/api/games/:id/paddle", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      const { player, direction } = request.body as { player: 1 | 2; direction: "up" | "down" | "stop" };
      if (!player || !direction) return reply.code(400).send({ error: "Player and direction are required" });

      const success = roomManager.movePaddle(id, player, direction);
      if (success) return reply.send({ success: true });
      return reply.code(404).send({ error: "Game not found" });
    } catch (error) {
      request.log.error(error, "Paddle control error");
      return reply.code(500).send({ error: "Failed to control paddle" });
    }
  });

  // Routes PAUSE/RESUME pour le contrôle de jeu
  app.post("/api/games/:id/pause", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      
      console.log(`[Backend API] Pause request for game ${id}`);
      
      const room = roomManager.getRoom(id);
      if (!room) {
        console.log(`[Backend API] Game ${id} not found`);
        return reply.code(404).send({ error: "Game not found" });
      }

      const success = room.pauseGame();
      if (success) {
        console.log(`[Backend API] Game ${id} paused successfully`);
        return reply.send({ success: true, message: "Game paused" });
      } else {
        console.log(`[Backend API] Failed to pause game ${id}`);
        return reply.code(400).send({ error: "Cannot pause game" });
      }
    } catch (error) {
      request.log.error(error, "Pause game error");
      return reply.code(500).send({ error: "Failed to pause game" });
    }
  });

  app.post("/api/games/:id/resume", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { id } = request.params as { id: string };
      
      console.log(`[Backend API] Resume request for game ${id}`);
      
      const room = roomManager.getRoom(id);
      if (!room) {
        console.log(`[Backend API] Game ${id} not found`);
        return reply.code(404).send({ error: "Game not found" });
      }

      const success = room.resumeGame();
      if (success) {
        console.log(`[Backend API] Game ${id} resumed successfully`);
        return reply.send({ success: true, message: "Game resumed" });
      } else {
        console.log(`[Backend API] Failed to resume game ${id}`);
        return reply.code(400).send({ error: "Cannot resume game" });
      }
    } catch (error) {
      request.log.error(error, "Resume game error");
      return reply.code(500).send({ error: "Failed to resume game" });
    }
  });

  app.get("/api/games/stats", async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) return reply.code(401).send({ error: "Authentification requise" });

      const roomStats = roomManager.getStats();
      return reply.send({ rooms: roomStats, timestamp: Date.now() });
    } catch (error) {
      request.log.error(error, "Game stats error");
      return reply.code(500).send({ error: "Erreur lors de la récupération des statistiques" });
    }
  });

  // Fin de partie + MAJ stats / status users
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

      const game = await GameService.findGameById(id);
      if (!game) return reply.code(404).send({ error: "not_found" });
      if (game.status === "finished") return reply.send({ ok: true, already: true });

      if (winner_id !== game.player1_id && winner_id !== game.player2_id) {
        return reply.code(400).send({ error: "winner_not_in_game" });
      }

      await GameService.finishGame(id, winner_id, p1s, p2s);
      if (game.player1_id) await UserService.updateUserStatus(game.player1_id, "online");
      if (game.player2_id) await UserService.updateUserStatus(game.player2_id, "online");
      await StatsService.updateStatsAfterGame(id);

      return reply.send({ ok: true, winner_id });
    } catch (e) {
      request.log.error(e, "Game finish error");
      return reply.code(500).send({ error: "Game finish failed" });
    }
  });

  // ===================== TOURNOIS (REMOTE) =====================
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
      const input: { name: string; description?: string; max_players?: number; created_by: number } = {
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

  // ===================== TOURNOIS LOCAUX (in-memory) =====================
  const localTournaments = new Map<string, any>();

  app.post("/api/tournaments/local", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { players } = request.body as { players: string[] };

      if (!players || !Array.isArray(players) || players.length !== 4) {
        return reply.code(400).send({ error: "Exactly 4 players required" });
      }

      const uniqueNames = new Set(players.map((n) => n.toLowerCase()));
      if (uniqueNames.size !== players.length) {
        return reply.code(400).send({ error: "All players must have different names" });
      }

      const tournamentId = `local_${Date.now()}`;
      const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);

      const semifinal1 = { player1: shuffledPlayers[0], player2: shuffledPlayers[1] };
      const semifinal2 = { player1: shuffledPlayers[2], player2: shuffledPlayers[3] };

      const tournament = {
        id: tournamentId,
        players: shuffledPlayers,
        bracket: { semifinals: [semifinal1, semifinal2], final: null, winner: null },
        currentMatch: "semifinal1",
        createdAt: new Date().toISOString(),
      };

      localTournaments.set(tournamentId, tournament);

      request.log.info({ tournamentId, players: shuffledPlayers }, "Local tournament created");

      return reply.code(201).send({
        tournamentId,
        tournament,
        nextMatch: { type: "semifinal", number: 1, players: [semifinal1.player1, semifinal1.player2] },
      });
    } catch (error) {
      request.log.error(error, "Local tournament creation error");
      return reply.code(500).send({ error: "Failed to create local tournament" });
    }
  });

  app.get("/api/tournaments/local/:id", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tournamentId = (request.params as any).id;
      const tournament = localTournaments.get(tournamentId);
      if (!tournament) return reply.code(404).send({ error: "Tournament not found" });
      return reply.send({ tournament });
    } catch (error) {
      request.log.error(error, "Tournament retrieval error");
      return reply.code(500).send({ error: "Failed to retrieve tournament" });
    }
  });

  app.post("/api/tournaments/local/:id/match-result", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tournamentId = (request.params as any).id;
      const { winner, loser, scores } = request.body as {
        winner: string;
        loser: string;
        scores: { winner: number; loser: number };
      };

      const tournament = localTournaments.get(tournamentId);
      if (!tournament) return reply.code(404).send({ error: "Tournament not found" });

      let nextMatch = null;

      if (tournament.currentMatch === "semifinal1") {
        tournament.bracket.semifinals[0].winner = winner;
        tournament.bracket.semifinals[0].loser = loser;
        tournament.bracket.semifinals[0].scores = scores;
        tournament.currentMatch = "semifinal2";
        nextMatch = {
          type: "semifinal",
          number: 2,
          players: [tournament.bracket.semifinals[1].player1, tournament.bracket.semifinals[1].player2],
        };
      } else if (tournament.currentMatch === "semifinal2") {
        tournament.bracket.semifinals[1].winner = winner;
        tournament.bracket.semifinals[1].loser = loser;
        tournament.bracket.semifinals[1].scores = scores;

        const finalist1 = tournament.bracket.semifinals[0].winner;
        const finalist2 = tournament.bracket.semifinals[1].winner;

        tournament.bracket.final = { player1: finalist1, player2: finalist2 };
        tournament.currentMatch = "final";
        nextMatch = { type: "final", number: 1, players: [finalist1, finalist2] };
      } else if (tournament.currentMatch === "final") {
        tournament.bracket.final.winner = winner;
        tournament.bracket.final.loser = loser;
        tournament.bracket.final.scores = scores;
        tournament.bracket.winner = winner;
        tournament.currentMatch = "finished";
        tournament.finishedAt = new Date().toISOString();
        nextMatch = { type: "finished", winner };
      }

      localTournaments.set(tournamentId, tournament);
      request.log.info({ tournamentId, winner, currentMatch: tournament.currentMatch }, "Match result processed");

      return reply.send({ tournament, nextMatch });
    } catch (error) {
      request.log.error(error, "Match result processing error");
      return reply.code(500).send({ error: "Failed to process match result" });
    }
  });

  // ===================== USER (profiles / friendships / search …) =====================
  app.put("/api/users/profile", async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) return reply.code(401).send({ error: "Authentification requise" });

      const v = await fetch("http://user:8106/validate-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request.body ?? {}),
      });
      if (!v.ok) return reply.code(v.status).send(await v.json().catch(() => ({})));
      const data = await v.json();

      if (data.username) {
        const u = await UserService.findUserByUsername(data.username);
        if (u && u.id !== userId) return reply.code(409).send({ error: "username_taken" });
      }
      if (data.email) {
        const u = await UserService.findUserByEmail(data.email);
        if (u && u.id !== userId) return reply.code(409).send({ error: "email_taken" });
      }

      await UserService.updateProfile(userId, {
        username: data.username ?? null,
        email: data.email ?? null,
        avatar: data.avatar ?? null,
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
    const limit = Math.min(Math.max(Number((req.query as any).limit ?? 20), 1), 100);
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

  // -------- pings
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

// ===================== HOOKS COMMUNS + LISTEN =====================
registerHttpTimingHooks(app);

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Request-ID", request.id);
  return payload;
});

app.get("/healthz", async () => "ok");
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

await app.listen({ host: HOST, port: PORT });
app.log.info(`Service role=${ROLE} listening on ${PORT}`);
