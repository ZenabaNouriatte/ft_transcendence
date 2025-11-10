// backend/src/index.ts

import Fastify, { type FastifyRequest, type FastifyReply } from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import underPressure from "@fastify/under-pressure";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import validator from "validator";
import xss from 'xss';
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import path from "path";


import { registerRawWs } from "./ws-raw.js";
import { initDb, get } from "./database/index.js";
import {
  UserService,
  GameService,
  StatsService,
  TournamentService,
  FriendshipService,
  DirectMessageService,
} from "./services/index.js";
import { registerHttpTimingHooks, sendMetrics } from "./common/metrics.js";
import { validateUsername, validateEmail as validatorValidateEmail } from "./common/validation.js";


const JWT_SECRET: Secret = process.env.JWT_SECRET || "dev-secret";
const SIGN_OPTS: SignOptions = { expiresIn: "24h", algorithm: "HS256" };

function issueTokenForUser(userId: number): string {
  return jwt.sign({ userId }, JWT_SECRET, SIGN_OPTS);
}


// --- Input sanitization helpers (basic XSS hygiene) ---
function sanitizeInput(input: string, maxLength = 200): string {
  if (typeof input !== 'string') return '';
  const cleaned = validator.trim(String(input));
  const sanitized = xss(cleaned, { whiteList: {} }); // Aucune balise HTML
  return sanitized.substring(0, maxLength);
}

function sanitizeUsername(username: string): string {
  if (typeof username !== 'string') {
    throw new Error("Username must be a string");
  }
  const cleaned = validator.trim(String(username));
  
  // Validation stricte : 3-20 caractères, alphanumérique + underscore + tiret
  if (!/^[a-zA-Z0-9_-]{3,20}$/.test(cleaned)) {
    throw new Error("Invalid username format");
  }
  
  return xss(cleaned, { whiteList: {} });
}

function validateEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  return validator.isEmail(String(email));
}

function validatePassword(password: string): void {
  if (typeof password !== 'string') {
    throw new Error("Password must be a string");
  }
  
  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }
  
  if (password.length > 128) {
    throw new Error("Password too long");
  }
  
  // Vérification complexité : au moins 1 lettre ET 1 chiffre
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error("Password must contain at least one letter and one number");
  }
}
// ------------------------------------------------------

const ROLE = process.env.SERVICE_ROLE || "gateway";
const PORT = Number(
  process.env.PORT ||
    (ROLE === "gateway" ? 8000 :
     ROLE === "svc-auth" ? 8101 :
     ROLE === "svc-game" ? 8102 :
     ROLE === "svc-chat" ? 8103 :
     ROLE === "svc-tournament" ? 8104 :
     ROLE === "svc-user" ? 8105 : 8000)
);
const HOST = "0.0.0.0";

const app = Fastify({ logger: true, trustProxy: true });

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


await app.register(rateLimit, {
  max: 2000,
  timeWindow: "1 minute",
  skipOnError: true,

  // identifie bien le client derrière le proxy
  keyGenerator: (req: FastifyRequest) =>
    String(req.headers["x-forwarded-for"] ?? req.ip),

  // ⬅️ v10 : utiliser allowList pour "bypasser" certaines routes
  // (return true = pas de rate-limit)
  allowList: (req: FastifyRequest, _key: string) => {
    const url = req.url ?? "";
    // on évite d’affamer health/metrics/ws pour les tests
    if (url === "/healthz") return true;
    if (url === "/metrics") return true;
    if (url.startsWith("/ws")) return true;
    return false;
  },

  // signature attendue: (req, context) => object
  errorResponseBuilder: (_req, _context) => ({
    error: "rate_limit_exceeded",
    message: "Too many requests, please try again later",
  }),
});

// Register multipart for file uploads
await app.register(multipart, {
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
    files: 1, // Maximum 1 file per request
  },
});

// Register static files pour servir les avatars uploadés
await app.register(fastifyStatic, {
  root: path.join(process.cwd(), 'uploads'),
  prefix: '/uploads/',
  constraints: {}, // Pas de contraintes
});

await app.register(underPressure);

// ===================== ROUTAGE PAR RÔLE =====================
let roomManager: any | null = null;

if (ROLE === "gateway") {
  // Init DB + WS + Game system
  await initDb();
  registerRawWs(app);

  try {
    const { GameRoomManager } = await import("./modules/game/engine/gameRoomManager.js");
    const { setGameRoomManager } = await import("./ws-raw.js");
    roomManager = new GameRoomManager(); // ← assigne la variable extérieure
    setGameRoomManager(roomManager); // ← connecter au système WebSocket
    console.log("GameRoomManager initialized and connected to WebSocket");
  } catch (error) {
    console.error("Failed to initialize GameRoomManager:", error);
    // Fallback simple pour éviter les crashs
    roomManager = {
      createRoom: () => ({ 
        addPlayer: () => true,
        getGameState: () => ({}),
        getStatus: () => "waiting",
        getPlayers: () => new Map(),
        pauseGame: () => true,
        resumeGame: () => true,
      }),
      getRoom: () => null,
      startGame: () => false,
      movePaddle: () => false,
      getStats: () => ({ totalRooms: 0, activeGames: 0, totalPlayers: 0 }),
      shutdown: () => {},
    };
  }

  process.on("SIGINT", () => {
    app.log.info("🛑 Shutting down game system...");
    if (roomManager && roomManager.shutdown) roomManager.shutdown();
    process.exit(0);
  });

  // Modules communs

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

  // ===================== AUTH =====================

app.post("/api/users/register", async (request, reply) => {
  try {
    const b = (request.body ?? {}) as any;

    // --- sanitize avec gestion d'erreur explicite pour le username ---
    let username: string;
    try {
      username = sanitizeUsername(b.username);
    } catch {
      return reply.code(400).send({ error: "Invalid username" });
    }

    // Validation email robuste
    const email = sanitizeInput(b.email, 100);
    if (!validateEmail(email)) {
      return reply.code(400).send({ error: "invalid_email_format" });
    }

    const password = String(b.password ?? "");
    if (password.length < 8) {
      return reply.code(400).send({ error: "password_too_short" });
    }
    // Optionnel: validation complexité
    if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
      return reply.code(400).send({ error: "password_needs_letter_and_number" });
    }

    const payload = {
      username,
      email: email.toLowerCase(), // Normalisation
      password: String(b.password ?? ""),
    };

    // Petits garde-fous locaux (svc-auth revalide derrière)
    if (payload.username.length < 3) {
      return reply.code(400).send({ error: "username_too_short" });
    }
    if (payload.password.length < 8) {
      return reply.code(400).send({ error: "password_too_short" });
    }
    // ---------------------------------------------------

      const resp = await fetch("http://auth:8101/validate-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        return reply.code(resp.status).send({ error: "auth_validate_failed", details: data });
      }
      // créer l’utilisateur dans la DB
      const userId = await UserService.createUser(data as any);
      await StatsService.initUserStats(userId);

      const user = await UserService.findUserById(userId);
      if (user) delete (user as any).password;

      // émettre le JWT dès l’inscription
      const token = issueTokenForUser(userId);
      await UserService.updateUserStatus(userId, "online");

      // ⚠️ renvoyer le token dans la réponse
      return reply.code(201).send({ ok: true, userId, user, token });

      } catch (e) {
        request.log.error(e, "register_failed");
        
        // Meilleure gestion des erreurs
        const error = e as any;
        if (error?.code === "SQLITE_CONSTRAINT") {
          if (error.message?.includes("users.email")) {
            return reply.code(409).send({ error: "email_already_exists" });
          }
          if (error.message?.includes("users.username")) {
            return reply.code(409).send({ error: "username_already_taken" });
          }
        }
        
        return reply.code(500).send({ error: "register_failed" });
      }
  });
      
  app.post("/api/auth/validate-token", async (request, reply) => {
    try {
      const { token } = (request.body ?? {}) as { token?: string };
      if (!token) return reply.code(400).send({ error: "invalid_payload" });
      const r = await fetch("http://auth:8101/validate-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await r.json().catch(() => ({}));
      return reply.code(r.status).send(data);
    } catch (e) {
      request.log.error(e, "validate_token_proxy_failed");
      return reply.code(500).send({ error: "proxy_failed" });
    }
  });

  app.get("/api/users", async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) return reply.code(401).send({ error: "Authentification requise" });

      const users = await UserService.getAllUsers();
      return { users: users.map(({ password, ...rest }: any) => rest) };
    } catch (error) {
      request.log.error(error, "Users list error");
      return reply.code(500).send({ error: "Erreur serveur" });
    }
  });

  app.post("/api/users/login", async (request, reply) => {
    try {
      const b = (request.body ?? {}) as any;
      const username = sanitizeUsername(b.username);
      const password = String(b.password ?? "");
      if (!username || !password) return reply.code(400).send({ error: "invalid_payload" });

      const user = await UserService.findUserByUsername(username);
      if (!user) return reply.code(401).send({ error: "invalid_credentials" });

      const userId = Number((user as any).id);
      if (!Number.isInteger(userId)) {
        return reply.code(500).send({ error: "invalid_user_id" });
      }

      const v = await fetch("http://auth:8101/validate-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, hashedPassword: (user as any).password }),
      });
      if (!v.ok) return reply.code(401).send({ error: "invalid_credentials" });

      const t = await fetch("http://auth:8101/generate-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({  userId }),
      });
      const { token } = await t.json();

      const { password: _pw, ...userWithoutPassword } = user as any;
      await UserService.updateUserStatus( userId, "online");
      return { ok: true, user: userWithoutPassword, token };
    } catch (e) {
      request.log.error(e, "login_failed");
      return reply.code(500).send({ error: "login_failed" });
    }
  });

  // Route de logout explicite
  app.post("/api/users/logout", async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) {
        // Pas d'erreur si pas authentifié, juste un succès silencieux
        return reply.send({ ok: true });
      }

      // Marquer l'utilisateur offline immédiatement
      await UserService.updateUserStatus(userId, "offline");
      
      request.log.info({ userId }, "User logged out");
      return reply.send({ ok: true });
    } catch (e) {
      request.log.error(e, "logout_failed");
      return reply.code(500).send({ error: "logout_failed" });
    }
  });

  // ===================== GAMES =====================

  // Flux "officiel" (auth + validation par svc-game)
  app.post("/api/games", async (request, reply) => {
    try {
      const userId = await getUserFromToken(request);
      if (!userId) return reply.code(401).send({ error: "Authentification requise" });

      const { player2_username, tournament_id } = (request.body as any) || {};

      console.log('🎮 Game creation request:', { player2_username, tournament_id });

      // Vérifier que le nom du joueur actuel n'est pas utilisé comme local player
      const currentUser = await UserService.findUserById(userId);
      const currentUserUsername = currentUser?.username || null;

      // Si player2_username est fourni, vérifier s'il s'agit d'un utilisateur authentifié
      let player2_id = null;
      if (player2_username && player2_username !== 'CPU') {
        console.log(`🔍 Looking for user: ${player2_username}`);
        
        // Valider le format du username avant de continuer
        try {
          validateUsername(player2_username);
        } catch (validationError) {
          const errorMsg = validationError instanceof Error ? validationError.message : 'Invalid username format';
          console.log(`❌ Username validation failed: ${errorMsg}`);
          return reply.code(400).send({ 
            error: "invalid_username", 
            message: errorMsg
          });
        }
        
        const player2 = await UserService.findUserByUsername(player2_username);
        
        if (player2) {
          // C'est un utilisateur authentifié
          // Vérifier que ce n'est pas un autre utilisateur (sauf si c'est l'utilisateur connecté lui-même)
          if (player2.id !== userId) {
            console.log(`❌ Cannot use authenticated user '${player2_username}' as local player`);
            return reply.code(400).send({ 
              error: "username_reserved", 
              message: `The username "${player2_username}" is reserved by an authenticated user. Please choose another one.`
            });
          }
          player2_id = player2.id;
          console.log(`✅ Found user '${player2_username}' with ID: ${player2_id}`);
        } else {
          // Ce n'est pas un utilisateur authentifié, c'est OK pour un joueur local
          console.log(`✅ '${player2_username}' is available for local player`);
        }
      } else if (player2_username === 'CPU') {
        console.log('🤖 CPU player detected');
        // Gérer le cas spécial du CPU
        const cpuUser = await UserService.findUserByUsername('CPU');
        if (cpuUser) {
          player2_id = cpuUser.id;
          console.log(`✅ CPU user found with ID: ${player2_id}`);
        } else {
          console.log('❌ CPU user not found');
        }
      } else {
        console.log('👻 No player2_username provided or empty');
      }

      const response = await fetch("http://game:8102/validate-game-creation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ player2_id, tournament_id, currentUserId: userId }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        return reply.code(response.status).send(error);
      }

      const validatedData = await response.json();

      const gameId = await GameService.createGame({
        player1_id: validatedData.player1_id,
        player2_id: validatedData.player2_id ? Number(validatedData.player2_id) : null,
        status: validatedData.status,
        tournament_id: validatedData.tournament_id ?? null,
      });

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
// --- LOCAL DEMO: no auth, no DB users, names kept in memory only ---
  app.post("/api/games/local", async (request, reply) => {
    try {
      const { player1, player2, type } = (request.body ?? {}) as any;

      // Sanitize inputs (length + escape + trim)
      const p1 = sanitizeInput(player1, 20);
      const p2 = sanitizeInput(player2, 20);
      const gameType = sanitizeInput(type, 16);

      // Basic guards
      const NAME_RX = /^[a-zA-Z0-9 _-]{1,20}$/;
      if (!p1 || !p2 || !NAME_RX.test(p1) || !NAME_RX.test(p2)) {
        return reply.code(400).send({ error: "invalid_player_names" });
      }
      if (gameType !== "pong") {
        return reply.code(400).send({ error: "invalid_game_type" });
      }

      // ✅ Vérifier que les pseudos ne sont pas déjà utilisés par des utilisateurs authentifiés
      // Sauf si c'est l'utilisateur actuellement connecté qui utilise son propre pseudo
      const userId = await getUserFromToken(request);
      let currentUserUsername: string | null = null;
      if (userId) {
        const currentUser = await UserService.findUserById(userId);
        currentUserUsername = currentUser?.username || null;
      }

      const existingUser1 = await UserService.findUserByUsername(p1);
      const existingUser2 = await UserService.findUserByUsername(p2);
      
      // Vérifier player1 (sauf si c'est l'utilisateur connecté)
      if (existingUser1 && existingUser1.username !== currentUserUsername) {
        return reply.code(400).send({ 
          error: "username_reserved", 
          message: `The username "${p1}" is reserved by an authenticated user. Please choose another one.`,
          field: "player1"
        });
      }
      
      // Vérifier player2 (sauf si c'est l'utilisateur connecté)
      if (existingUser2 && existingUser2.username !== currentUserUsername) {
        return reply.code(400).send({ 
          error: "username_reserved", 
          message: `The username "${p2}" is reserved by an authenticated user. Please choose another one.`,
          field: "player2"
        });
      }

      // ❌ plus de création d'utilisateurs "temp" en DB
      // ✅ on garde tout en mémoire via le roomManager
      const roomId = Date.now().toString();
      const gameRoom = roomManager.createRoom(roomId);
      gameRoom.addPlayer("player1", p1);
      gameRoom.addPlayer("player2", p2);

      request.log.info({ roomId, player1: p1, player2: p2 }, "Local game created (in-memory)");

      return reply.code(201).send({
        gameId: roomId,          // ID de la room temps réel
        player1: p1,
        player2: p2,
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

  // route stats de jeu
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

  // Annuler une partie (quand le joueur quitte la page de jeu)
  app.post("/api/games/:id/cancel", async (request, reply) => {
    try {
      const idParam = (request.params as any).id;
      const id = Number(idParam);
      
      // Vérifier si c'est une room locale (en mémoire uniquement, pas en DB)
      // Les rooms locales ont un ID timestamp (string numérique long)
      const isLocalRoom = roomManager && roomManager.rooms && roomManager.rooms.has(idParam);
      
      if (isLocalRoom) {
        // C'est une partie locale en mémoire uniquement
        const room = roomManager.rooms.get(idParam);
        if (room) {
          room.running = false;
          console.log(`[CANCEL] Stopping local room ${idParam}`);
        }
        roomManager.rooms.delete(idParam);
        console.log(`[CANCEL] Deleted local room ${idParam} from memory`);
        return reply.send({ ok: true, cancelled: true, type: 'local' });
      }
      
      // Sinon, c'est une partie en DB (authentifiée)
      if (!Number.isInteger(id)) {
        return reply.code(400).send({ error: "bad_id" });
      }

      const game = await GameService.findGameById(id);
      if (!game) return reply.code(404).send({ error: "not_found" });
      
      // Si la partie est déjà terminée ou annulée, ne rien faire
      if (game.status === "finished" || game.status === "cancelled") {
        return reply.send({ ok: true, already: true });
      }

      // Mettre le statut à "cancelled"
      await GameService.updateGame(id, { status: "cancelled" });
      console.log(`[CANCEL] Marked game ${id} as cancelled in DB`);
      
      // Arrêter la room côté serveur si elle existe (avec l'ID numérique)
      if (roomManager && roomManager.rooms && roomManager.rooms.has(id.toString())) {
        const room = roomManager.rooms.get(id.toString());
        if (room) {
          room.running = false;
        }
        roomManager.rooms.delete(id.toString());
        console.log(`[CANCEL] Deleted room ${id} from memory`);
      }

      return reply.send({ ok: true, cancelled: true, type: 'database' });
    } catch (e) {
      request.log.error(e, "Game cancel error");
      return reply.code(500).send({ error: "Game cancel failed" });
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

  const localTournaments = new Map<string, any>();

// --- LOCAL TOURNAMENT: 4 players, all in memory ---
  app.post("/api/tournaments/local", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { players } = request.body as { players: string[] };

      // Sanitize les noms
      const safePlayers = Array.isArray(players)
        ? players
            .map((p) => sanitizeInput(p, 20))
            .filter((p) => p.length > 0)
        : [];

      // Récupérer les pseudos réservés (utilisateurs authentifiés sauf l'utilisateur actuel)
      const userId = await getUserFromToken(request);
      let currentUserUsername: string | null = null;
      const reservedUsernames: string[] = [];

      if (userId) {
        const currentUser = await UserService.findUserById(userId);
        currentUserUsername = currentUser?.username || null;
      }

      // Construire la liste des pseudos réservés (tous sauf celui de l'utilisateur connecté)
      for (const playerName of safePlayers) {
        const existingUser = await UserService.findUserByUsername(playerName);
        if (existingUser && existingUser.username !== currentUserUsername) {
          reservedUsernames.push(existingUser.username);
        }
      }

      // ========== APPEL AU MICROSERVICE TOURNAMENT ==========
      // 1. Valider les joueurs
      const validationResponse = await fetch("http://tournament:8104/validate-tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players: safePlayers, reservedUsernames }),
      });

      if (!validationResponse.ok) {
        const error = await validationResponse.json();
        return reply.code(validationResponse.status).send(error);
      }

      const validationData = await validationResponse.json();

      // 2. Générer les brackets
      const bracketsResponse = await fetch("http://tournament:8104/generate-brackets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ players: validationData.players }),
      });

      if (!bracketsResponse.ok) {
        const error = await bracketsResponse.json();
        return reply.code(bracketsResponse.status).send(error);
      }

      const bracketsData = await bracketsResponse.json();

      // ========== PERSISTENCE EN MÉMOIRE (GATEWAY) ==========
      const tournamentId = `local_${Date.now()}`;
      const tournament = {
        id: tournamentId,
        players: bracketsData.shuffledPlayers,
        bracket: bracketsData.bracket,
        currentMatch: "semifinal1",
        createdAt: new Date().toISOString(),
      };

      localTournaments.set(tournamentId, tournament);

      request.log.info({ tournamentId, players: bracketsData.shuffledPlayers }, "Local tournament created (in-memory)");

      // 🏆 ANNONCE DANS LE CHAT GLOBAL - Début du tournoi
      try {
        const { sendSystemChatMessage } = await import("./ws-raw.js");
        const playersList = bracketsData.shuffledPlayers.join(", ");
        sendSystemChatMessage(`🏆 Tournament started ! Players: ${playersList}`);
      } catch (err) {
        request.log.warn(err, "Failed to send tournament announcement to chat");
      }

      return reply.code(201).send({
        tournamentId,
        tournament,
        nextMatch: bracketsData.firstMatch,
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

  // Traiter le résultat d'un match de tournoi
  app.post("/api/tournaments/local/:id/match-result", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tournamentId = (request.params as any).id;
      const tournament = localTournaments.get(tournamentId);
      if (!tournament) return reply.code(404).send({ error: "Tournament not found" });

      const body = request.body as {
        winner: string;
        loser: string;
        scores: { winner: number; loser: number };
      };

      // Sanitize les noms
      const winner = sanitizeInput(body?.winner, 20);
      const loser = sanitizeInput(body?.loser, 20);

      // ========== APPEL AU MICROSERVICE TOURNAMENT ==========
      const processResponse = await fetch("http://tournament:8104/process-match-result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tournament,
          winner,
          loser,
          scores: body.scores,
        }),
      });

      if (!processResponse.ok) {
        const error = await processResponse.json();
        return reply.code(processResponse.status).send(error);
      }

      const processedData = await processResponse.json();

      // ========== MISE À JOUR EN MÉMOIRE (GATEWAY) ==========
      tournament.bracket = processedData.bracket;
      tournament.currentMatch = processedData.currentMatch;
      
      if (processedData.finished) {
        tournament.finishedAt = new Date().toISOString();
        
        // Mettre à jour les statistiques si c'est un utilisateur authentifié
        try {
          const winnerUser = await UserService.findUserByUsername(processedData.winner);
          if (winnerUser) {
            await StatsService.updateTournamentWin(winnerUser.id!);
            console.log(`[Tournament] Updated tournament win stats for ${processedData.winner} (ID: ${winnerUser.id})`);
          }
        } catch (error) {
          console.error(`[Tournament] Failed to update tournament win stats:`, error);
        }
      }

      localTournaments.set(tournamentId, tournament);

      // 🎮 ANNONCE DANS LE CHAT GLOBAL - Prochain match ou fin du tournoi
      try {
        const { sendSystemChatMessage } = await import("./ws-raw.js");
        if (processedData.finished) {
          sendSystemChatMessage(`🏆 Tournament finished! Winner: ${processedData.winner}! 🎉`);
        } else if (processedData.nextMatch) {
          const matchType = processedData.nextMatch.type === 'semifinal' 
            ? `Semifinal ${processedData.nextMatch.number}` 
            : 'Final';
          const players = processedData.nextMatch.players.join(" vs ");
          sendSystemChatMessage(`⚔️ Next match - ${matchType}: ${players}`);
        }
      } catch (err) {
        request.log.warn(err, "Failed to send match announcement to chat");
      }

      request.log.info({ tournamentId, winner, currentMatch: tournament.currentMatch }, "Match result processed");
      return reply.send({ tournament, nextMatch: processedData.nextMatch });

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

      console.log('[BACKEND] Profile update request from user:', userId);
      
      // Vérifier si c'est multipart (upload de fichier) ou JSON
      const contentType = request.headers['content-type'] || '';
      console.log('[BACKEND] Content-Type:', contentType);
      
      let body: any = {};
      let avatarFilename: string | null = null;
      let avatarBuffer: Buffer | null = null;
      let removeAvatar = false;
      
      if (contentType.includes('multipart/form-data')) {
        console.log('[BACKEND] Processing multipart/form-data');
        // Traiter FormData avec fichier
        const parts = request.parts();
        
        for await (const part of parts) {
          console.log('[BACKEND] Part received:', part.type, part.fieldname);
          if (part.type === 'file' && part.fieldname === 'avatar') {
            console.log('[BACKEND] Avatar file:', part.filename);
            avatarFilename = part.filename;
            // Lire le stream immédiatement pour obtenir le buffer
            avatarBuffer = await part.toBuffer();
            console.log('[BACKEND] Avatar buffer size:', avatarBuffer.length);
          } else if (part.type === 'field') {
            // @ts-ignore
            body[part.fieldname] = part.value;
            console.log('[BACKEND] Field:', part.fieldname, '=', part.value);
          }
        }
        
        removeAvatar = body.removeAvatar === 'true';
        console.log('[BACKEND] Remove avatar:', removeAvatar);
      } else {
        console.log('[BACKEND] Processing JSON');
        // JSON classique
        body = (request.body ?? {}) as any;
      }
      
      // Validation et nettoyage des champs
      let newUsername: string | null = null;
      let newEmail: string | null = null;
      let newAvatar: string | null = null;
      
      if (body.username) {
        try {
          // Validation stricte avec les mêmes règles que la création de compte
          newUsername = validateUsername(body.username);
        } catch (error: any) {
          return reply.code(400).send({ 
            error: "invalid_username",
            message: error.message || "Username must be 3-20 characters and contain only letters, numbers, underscore and dash"
          });
        }

        // Vérifier si le username est déjà pris
        const existingUser = await UserService.findUserByUsername(newUsername);
        if (existingUser && existingUser.id !== userId) {
          return reply.code(409).send({ error: "username_taken" });
        }
      }
      
      if (body.email) {
        newEmail = sanitizeInput(body.email, 100);
        if (!validateEmail(newEmail)) {
          return reply.code(400).send({ error: "invalid_email" });
        }
        // Vérifier si l'email est déjà pris
        const existingUser = await UserService.findUserByEmail(newEmail);
        if (existingUser && existingUser.id !== userId) {
          return reply.code(409).send({ error: "email_taken" });
        }
      }

      // Gestion de l'avatar
      if (avatarBuffer && avatarFilename) {
        console.log('[BACKEND] Processing avatar file upload');
        // Sauvegarder le fichier uploadé
        const fsPromises = await import('fs/promises');
        const path = await import('path');
        const crypto = await import('crypto');
        
        // Créer le dossier uploads si il n'existe pas
        const uploadsDir = path.join(process.cwd(), 'uploads', 'avatars');
        try {
          await fsPromises.mkdir(uploadsDir, { recursive: true });
        } catch (err) {
          // Le dossier existe déjà
        }
        
        // Générer un nom de fichier unique
        const ext = path.extname(avatarFilename);
        const filename = `avatar_${userId}_${crypto.randomBytes(8).toString('hex')}${ext}`;
        const filepath = path.join(uploadsDir, filename);
        
        console.log('[BACKEND] Saving avatar to:', filepath);
        
        // Écrire le fichier avec le buffer
        await fsPromises.writeFile(filepath, avatarBuffer);
        
        console.log('[BACKEND] Avatar file written successfully');
        
        // URL relative pour la base de données
        newAvatar = `/uploads/avatars/${filename}`;
        console.log('[BACKEND] Avatar saved, URL:', newAvatar);
      } else if (removeAvatar) {
        // Remettre l'avatar par défaut (dicebear)
        const user = await UserService.findUserById(userId);
        if (user) {
          newAvatar = `https://api.dicebear.com/8.x/identicon/svg?seed=${encodeURIComponent(user.username)}`;
        }
      }

      // Mettre à jour le profil (username, email, avatar)
      if (newUsername || newEmail || newAvatar) {
        await UserService.updateProfile(userId, {
          username: newUsername,
          email: newEmail,
          avatar: newAvatar,
        });
      }

      // Gestion du changement de mot de passe
      if (body.password && typeof body.password === 'string') {
        const password = body.password.trim();
        if (password.length < 8) {
          return reply.code(400).send({ error: "password_too_short" });
        }
        if (password.length > 128) {
          return reply.code(400).send({ error: "password_too_long" });
        }
        if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
          return reply.code(400).send({ error: "password_needs_letter_and_number" });
        }
        
        // Hasher le mot de passe avec bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);
        await UserService.updatePassword(userId, hashedPassword);
      }

      const updated = await UserService.findUserById(userId);
      return reply.send({ ok: true, user: UserService.safeUser(updated) });
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
    return reply.send({ user: UserService.safeUser(u), stats });
  });

  app.get("/api/users/:id/profile", async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: "bad_id" });

    const u = await UserService.findUserById(id);
    if (!u) return reply.code(404).send({ error: "not_found" });

    const stats = await StatsService.getUserStats(id);
    const history = await UserService.getUserHistory(id, 20);

    return reply.send({ user: UserService.safeUser(u), stats, history });
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
    const rawQ = String((req.query as any).q ?? "");
    const q = sanitizeInput(rawQ, 50); // ← au lieu de .trim() seul
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

  app.get("/api/users/all", async (req, reply) => {
    // Récupérer l'utilisateur actuel depuis le token JWT s'il y en a un
    let currentUserId: number | null = null;
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      if (token) {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        currentUserId = decoded.userId;
      }
    } catch (error) {
      // Ignorer les erreurs de token pour permettre l'accès public
    }

    // Récupérer tous les utilisateurs
    const users = await UserService.getAllUsers();
    
    // Formatter la réponse sans générer de fallback côté backend
    // Le frontend gérera les avatars par défaut /images/X.JPG
    const out = users.map((u: any) => ({
      id: u.id,
      username: u.username,
      avatar: u.avatar, // null si pas d'avatar uploadé
      status: u.status,
      created_at: u.created_at
    }));

    return reply.send(out);
  });

  // ======== FRIENDSHIP ROUTES ========
  // POST /api/friends/request - Envoyer une demande d'ami
  app.post("/api/friends/request", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;
      const { targetId } = req.body as { targetId: number };

      if (!targetId || targetId === userId) {
        return reply.code(400).send({ error: 'invalid_target' });
      }

      // Vérifier si l'utilisateur est bloqué par la cible
      const isBlocked = await FriendshipService.isBlocked(userId, targetId);
      if (isBlocked) {
        return reply.code(403).send({ error: 'blocked', message: 'You have been blocked by this user' });
      }

      // Vérifier si l'utilisateur a bloqué la cible
      const hasBlocked = await FriendshipService.isBlocked(targetId, userId);
      if (hasBlocked) {
        return reply.code(403).send({ error: 'you_blocked', message: "You've blocked this account. Unblock it and try again." });
      }

      // Vérifier si une relation existe déjà
      const existingStatus = await FriendshipService.getFriendshipStatus(userId, targetId);
      if (existingStatus) {
        return reply.code(400).send({ error: 'friendship_exists', status: existingStatus });
      }

      await FriendshipService.request(userId, targetId);
      return reply.send({ success: true, status: 'pending' });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // POST /api/friends/accept - Accepter une demande d'ami
  app.post("/api/friends/accept", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;
      const { requestId } = req.body as { requestId: number };

      if (!requestId) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      // Vérifier que la demande existe et nous concerne
      const request = await get(
        'SELECT user_id, friend_id FROM friendships WHERE id = ? AND friend_id = ? AND status = "pending"',
        [requestId, userId]
      );

      if (!request) {
        return reply.code(404).send({ error: 'request_not_found' });
      }

      await FriendshipService.accept(userId, request.user_id);
      return reply.send({ success: true, status: 'accepted' });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // POST /api/friends/decline - Refuser une demande d'ami
  app.post("/api/friends/decline", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;
      const { requestId } = req.body as { requestId: number };

      if (!requestId) {
        return reply.code(400).send({ error: 'invalid_request' });
      }

      // Vérifier que la demande existe et nous concerne
      const request = await get(
        'SELECT user_id, friend_id FROM friendships WHERE id = ? AND friend_id = ? AND status = "pending"',
        [requestId, userId]
      );

      if (!request) {
        return reply.code(404).send({ error: 'request_not_found' });
      }

      await FriendshipService.decline(userId, request.user_id);
      return reply.send({ success: true, status: 'declined' });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // GET /api/friends/requests - Obtenir les demandes d'amis en attente
  app.get("/api/friends/requests", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;

      const requests = await FriendshipService.getPendingRequests(userId);
      const formatted = requests.map((r: any) => ({
        id: r.id,
        user_id: r.user_id,
        username: r.username,
        avatar: r.avatar ?? null,
        created_at: r.created_at
      }));

      return reply.send({ requests: formatted });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // GET /api/friends/status/:targetId - Obtenir le statut d'amitié avec un utilisateur
  app.get("/api/friends/status/:targetId", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;
      const targetId = parseInt((req.params as any).targetId);

      if (!targetId || targetId === userId) {
        return reply.code(400).send({ error: 'invalid_target' });
      }

      const status = await FriendshipService.getFriendshipStatusFromPerspective(userId, targetId);
      return reply.send({ status });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // POST /api/friends/block - Bloquer un utilisateur
  app.post("/api/friends/block", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;
      const { targetId } = req.body as any;

      if (!targetId || targetId === userId) {
        return reply.code(400).send({ error: 'invalid_target' });
      }

      await FriendshipService.block(userId, targetId);
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // POST /api/friends/unblock - Débloquer un utilisateur
  app.post("/api/friends/unblock", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;
      const { targetId } = req.body as any;

      if (!targetId || targetId === userId) {
        return reply.code(400).send({ error: 'invalid_target' });
      }

      await FriendshipService.unblock(userId, targetId);
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // GET /api/friends/blocked - Obtenir la liste des utilisateurs bloqués
  app.get("/api/friends/blocked", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;

      const blockedIds = await FriendshipService.getBlockedUsers(userId);
      return reply.send({ blockedUsers: blockedIds });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // ============================================================================
  // DIRECT MESSAGES ROUTES
  // ============================================================================

  // POST /api/messages/send - Envoyer un message direct
  app.post("/api/messages/send", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const senderId = decoded.userId;
      const { receiverId, message } = req.body as { receiverId: number; message: string };

      // ========== APPEL AU MICROSERVICE CHAT ==========
      // 1. Valider le message
      const validationResponse = await fetch("http://chat:8103/validate-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, senderId, receiverId }),
      });

      if (!validationResponse.ok) {
        const error = await validationResponse.json();
        return reply.code(validationResponse.status).send(error);
      }

      const validatedData = await validationResponse.json();

      // 2. Vérifier les blocages
      const sender = await UserService.findUserById(senderId);
      const receiver = await UserService.findUserById(receiverId);

      if (!sender || !receiver) {
        return reply.code(404).send({ error: 'user_not_found' });
      }

      const blockedByReceiver = await FriendshipService.isBlocked(receiverId, senderId);
      const blockedBySender = await FriendshipService.isBlocked(senderId, receiverId);

      const canSendResponse = await fetch("http://chat:8103/check-can-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senderId, receiverId, blockedByReceiver, blockedBySender }),
      });

      if (!canSendResponse.ok) {
        const error = await canSendResponse.json();
        return reply.code(canSendResponse.status).send(error);
      }

      const canSendData = await canSendResponse.json();
      
      if (!canSendData.canSend) {
        return reply.code(403).send({ 
          error: canSendData.reason,
          message: canSendData.message
        });
      }

      // ========== PERSISTENCE EN DB (GATEWAY) ==========
      const newMessage = await DirectMessageService.sendMessage(senderId, receiverId, validatedData.sanitizedMessage);
      return reply.send({ success: true, message: newMessage });

    } catch (error: any) {
      if (error.message === 'Cannot send message to blocked user') {
        return reply.code(403).send({ error: 'user_blocked' });
      }
      if (error.message === 'Sender or receiver not found') {
        return reply.code(404).send({ error: 'user_not_found' });
      }
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // GET /api/messages/conversation/:userId - Récupérer la conversation avec un utilisateur
  app.get("/api/messages/conversation/:userId", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const currentUserId = decoded.userId;
      const { userId } = req.params as { userId: string };
      const otherUserId = parseInt(userId, 10);

      // ========== APPEL AU MICROSERVICE CHAT ==========
      const validationResponse = await fetch("http://chat:8103/validate-conversation-params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: currentUserId, otherUserId }),
      });

      if (!validationResponse.ok) {
        const error = await validationResponse.json();
        return reply.code(validationResponse.status).send(error);
      }

      // ========== RÉCUPÉRATION EN DB (GATEWAY) ==========
      const messages = await DirectMessageService.getConversation(currentUserId, otherUserId);
      return reply.send({ messages: messages.reverse() }); // Inverser pour avoir du plus ancien au plus récent
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // GET /api/messages/conversations - Récupérer toutes les conversations
  app.get("/api/messages/conversations", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;

      const conversations = await DirectMessageService.getConversations(userId);
      return reply.send({ conversations });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // POST /api/messages/read - Marquer les messages comme lus
  app.post("/api/messages/read", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;
      const { otherUserId } = req.body as { otherUserId: number };

      // ========== APPEL AU MICROSERVICE CHAT ==========
      const validationResponse = await fetch("http://chat:8103/validate-conversation-params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, otherUserId }),
      });

      if (!validationResponse.ok) {
        const error = await validationResponse.json();
        return reply.code(validationResponse.status).send(error);
      }

      // ========== MISE À JOUR EN DB (GATEWAY) ==========
      await DirectMessageService.markAsRead(userId, otherUserId);
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // GET /api/messages/unread-count - Obtenir le nombre de messages non lus
  app.get("/api/messages/unread-count", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;

      const count = await DirectMessageService.getUnreadCount(userId);
      return reply.send({ unreadCount: count });
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // DELETE /api/messages/:messageId - Supprimer un message
  app.delete("/api/messages/:messageId", async (req, reply) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return reply.code(401).send({ error: 'no_token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      const userId = decoded.userId;
      const { messageId } = req.params as { messageId: string };
      const msgId = parseInt(messageId, 10);

      if (isNaN(msgId)) {
        return reply.code(400).send({ error: 'invalid_message_id' });
      }

      const deleted = await DirectMessageService.deleteMessage(msgId, userId);
      if (deleted) {
        return reply.send({ success: true });
      } else {
        return reply.code(404).send({ error: 'message_not_found' });
      }
    } catch (error) {
      return reply.code(500).send({ error: 'server_error' });
    }
  });

  // -------- pings
  app.get("/api/users/ping", async () => ({ ok: true, service: "users" }));
  app.get("/api/games/ping", async () => ({ ok: true, service: "games" }));
  app.get("/api/chat/ping", async () => ({ ok: true, service: "chat" }));
  app.get("/api/tournaments/ping", async () => ({ ok: true, service: "tournaments" }));

// ==== MICROSERVICES =========================================================
} else if (ROLE === "svc-auth") { //1040
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

} 

// ===================== HOOKS COMMUNS + LISTEN =====================
registerHttpTimingHooks(app);

app.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Request-ID", request.id);
  return payload;
});

app.get("/healthz", async () => "ok");
app.get("/metrics", async (_req, reply) => sendMetrics(reply));

app.setErrorHandler((err, _req, reply) => {
  // tout ce qui ressemble à un dépassement de rate-limit => 429 JSON propre
  const isRateLimit =
    (err as any)?.statusCode === 429 ||
    (err as any)?.code === 429 ||
    (err as any)?.error === "rate_limit_exceeded" ||
    String(err?.message || "").toLowerCase().includes("too many requests");

  if (isRateLimit) {
    return reply
      .code(429)
      .send({ error: "rate_limit_exceeded", message: "Too many requests, please try again later" });
  }

  // fallback par défaut
  reply.send(err);
});


await app.listen({ host: HOST, port: PORT });
app.log.info(`Service role=${ROLE} listening on ${PORT}`);
