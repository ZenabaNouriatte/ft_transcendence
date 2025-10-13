// backend/src/ws-raw.ts
import { WebSocketServer, WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import { IncomingMessage } from "http";
import { 
  wsConnections, 
  wsMessagesTotal, 
  wsDisconnectsTotal, 
  wsRateLimitedTotal 
} from "./common/metrics.js";
import { UserService } from "./services/index.js";


// Fonction de sanitization si le module n'existe pas
function sanitizeString(input: string, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '').slice(0, maxLength);
}

// Validation d'enum runtime avec type safety
function validateEnum<T extends readonly string[]>(
  value: string,
  allowed: T
): T[number] {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  throw new Error(`Invalid value: ${value}`);
}


type Ctx = {
  isAlive: boolean;
  ip?: string;
  userId?: number;
  rate: { windowStart: number; count: number };
};

// ─────────────────────────────────────────────────────────────────────────────
// Limits & timings
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MSG_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 5_000;
const RATE_LIMIT_MAX = 50;
const PING_INTERVAL_MS = 10_000;
const PONG_TIMEOUT_MS = 5_000;

const now = () => Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// Presence: per-user connection refcount
// ─────────────────────────────────────────────────────────────────────────────
const userConnCount = new Map<number, number>();
let nextConnId = 1;

function incConn(uid: number): number {
  const n = (userConnCount.get(uid) ?? 0) + 1;
  userConnCount.set(uid, n);
  return n;
}
function decConn(uid: number): number {
  const n = (userConnCount.get(uid) ?? 1) - 1;
  if (n <= 0) { userConnCount.delete(uid); return 0; }
  userConnCount.set(uid, n);
  return n;
}


// ─────────────────────────────────────────────────────────────────────────────
// Prometheus gauge refresh helper
// ─────────────────────────────────────────────────────────────────────────────
const updateGauge = (wss: WebSocketServer) => {
  try {
    const activeConnections = wss.clients.size;
    wsConnections.set(activeConnections);
  } catch {
    // no-op
  }
};

export function registerRawWs(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  // ────────────────────────────────────────────────────────────────────────────
  // 1) Keepalive optimisé
  // ────────────────────────────────────────────────────────────────────────────
  const interval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket & { ctx?: Ctx }) => {
      if (!ws.ctx) return;

      // Si pas de pong reçu depuis le dernier ping, terminer immédiatement
      if (ws.ctx.isAlive === false) {
        app.log.warn({ 
          connId: (ws as any)._connId, 
          userId: ws.ctx.userId 
        }, '⚠️ WS timeout: no pong received, terminating connection');
        try { ws.terminate(); } catch {}
        return;
      }

      // Marquer comme "en attente de pong" et envoyer ping
      ws.ctx.isAlive = false;
      try { ws.ping(); } catch {}
    });
    updateGauge(wss);
  }, PING_INTERVAL_MS);


  // ───────────────────────────────────────────────────────────────────────────
  // 2) Connection handler
  // ───────────────────────────────────────────────────────────────────────────
  wss.on("connection", async (ws: WebSocket & { ctx?: Ctx }, request: IncomingMessage) => {
    // 2.a) Base context init
    ws.ctx = {
      isAlive: true,
      ip: request.socket?.remoteAddress,
      rate: { windowStart: now(), count: 0 },
    };
    (ws as any)._connId = nextConnId++;

    wsConnections.inc();
    updateGauge(wss);
    app.log.info({ ip: ws.ctx.ip, totalConnections: wss.clients.size }, "WS connection established");

    // 2.b) Pong handler
    ws.on("pong", () => { if (ws.ctx) ws.ctx.isAlive = true; });

    // 2.c) AUTH WS
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      
      const channelParam = url.searchParams.get("channel") || "local";
      let channel: "local" | "chat" | "game-remote";
      
      try {
        channel = validateEnum(channelParam, ["local", "chat", "game-remote"] as const);
      } catch {
        try { ws.close(1008, "invalid_channel"); } catch {}
        return;
      }

      (ws as any)._channel = channel;
      
      const isSensitiveChannel = channel === "chat" || channel === "game-remote";

      const bearer = request.headers["authorization"]?.toString();
      const tokenParam = url.searchParams.get("token");
      const token = tokenParam || bearer?.replace(/^Bearer\s+/i, "");

      if (isSensitiveChannel && !token) {
        try { ws.close(1008, "token_required"); } catch {}
        return;
      }

      if (token) {
        if (token.length > 1000) {
          try { ws.close(1008, "token_too_long"); } catch {}
          return;
        }
        
        const resp = await fetch("http://auth:8101/validate-token", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "X-Request-ID": request.headers["x-request-id"] as string || "ws-conn"
          },
          body: JSON.stringify({ token }),
        });
        
        if (!resp.ok) {
          try { ws.close(1008, "invalid_token"); } catch {}
          return;
        }
        
        const data = await resp.json().catch(() => ({}));
        
        if (!Number.isInteger(data.userId) || data.userId <= 0) {
          try { ws.close(1008, "invalid_user_id"); } catch {}
          return;
        }
        
       ws.ctx.userId = data.userId;
       if (ws.ctx.userId) {
          try {
            const after = incConn(ws.ctx.userId);
            if (after === 1) {
              await UserService.updateUserStatus(ws.ctx.userId, "online");
            }
             app.log.info(
              {
                connId: (ws as any)._connId,
                userId: ws.ctx.userId,
                channel: (ws as any)._channel,
                totalConnections: wss.clients.size,
                userOpenConns: after, // connexions ouvertes pour CE user
              },
              "WS connection established"
            );
          } catch (e) {
            app.log.error({ e }, "presence:set_online_failed");
          }
        }

      }
    } catch (err) {
      app.log.error({ err }, "WS handshake error");
      try { ws.close(1008, "handshake_failed"); } catch {}
      return;
    }

    // 2.d) Safe send utility
    const safeSend = (objOrString: any) => {
      const payload = typeof objOrString === "string" ? objOrString : JSON.stringify(objOrString);
      if (ws.readyState === ws.OPEN) {
        ws.send(payload, (err?: Error) => {
          if (err) app.log.error({ err }, "WS send error");
        });
      }
    };

    setTimeout(() => {
      if ((ws as any)._channel === "game-remote") {
        safeSend({ type: "ok", data: { hello: "connected" } });
      } else {
        safeSend("hello: connected");
      }
    }, 100);

    // 2.e) Error/Close handlers
    ws.on("close", (code: number, reason: Buffer) => {
      try { wsConnections.dec(); } catch {}
      updateGauge(wss);

      let left = -1;
      if (ws.ctx?.userId) {
        left = decConn(ws.ctx.userId);
      }

      // ✅ métrique Prometheus: on garde 'code' (faible cardinalité) et on ajoute 'final'
      try {
        wsDisconnectsTotal.inc({ code: String(code) });  // ✅ garder uniquement 'code'
      } catch {}

      app.log.info(
        {
          connId: (ws as any)._connId,
          userId: ws.ctx?.userId,
          left,
          code,
          reason: reason.toString(),
          totalConnections: wss.clients.size,
        },
        "WS closed"
      );

      (async () => {
        try {
          if (ws.ctx?.userId && left === 0) {
            await UserService.updateUserStatus(ws.ctx.userId, "offline");
          }
        } catch (e) {
          app.log.error({ e }, "presence:set_offline_failed");
        }
      })();
    });


    // ─────────────────────────────────────────────────────────────────────────
    // 2.f) Message handler
    // ─────────────────────────────────────────────────────────────────────────
ws.on("message", async (buf: Buffer) => {
  const size = Buffer.isBuffer(buf) ? buf.length : Buffer.byteLength(String(buf));
  if (size > MAX_MSG_BYTES) {
    try { ws.close(1009, "Message too large"); } catch {}
    return;
  }

  // Rate limiting
  if (ws.ctx) {
    const t = now();
    const r = ws.ctx.rate;
    if (t - r.windowStart > RATE_LIMIT_WINDOW_MS) {
      r.windowStart = t; r.count = 0;
    }
    r.count++;
    if (r.count > RATE_LIMIT_MAX) {
      try { wsRateLimitedTotal.inc(); } catch {}
      try { wsMessagesTotal.inc({ type: "rate_limited" }); } catch {}
      safeSend({ type: "error", data: { message: "rate_limited" } });
      return;
    }
  }

  let requestId: string | undefined;
  let type = "unknown";

  try {
    const raw = buf.toString("utf8");
    const msg = JSON.parse(raw);

    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      throw new Error("Invalid message structure");
    }

    if (msg.requestId != null) {
      const rid = String(msg.requestId);
      if (rid.length > 100) throw new Error("requestId too long");
      requestId = rid;
    }

    if (typeof msg.type !== "string") throw new Error("Missing or invalid message type");
    type = msg.type.trim();
    if (type.length > 50) throw new Error("Message type too long");

    const ALLOWED_TYPES = [
      "ws.ping",
      "chat.message",
      "game.input",
      "game.create_remote",
      "game.join_remote",
      "game.list_waiting",
      "game.paddle_move",
      "game.attach",
    ] as const;

    if (!ALLOWED_TYPES.includes(type as any)) {
      try { wsMessagesTotal.inc({ type: "unknown" }); } catch {}
      safeSend({ type: "error", data: { message: "unknown_message_type" }, requestId });
      return;
    }

    try { wsMessagesTotal.inc({ type }); } catch {}

    switch (type) {
      case "ws.ping": {
        safeSend({ type: "ws.pong", ts: Date.now(), requestId });
        break;
      }

      case "chat.message": {
        if ((ws as any)._channel !== "chat") {
          safeSend({ type: "error", data: { message: "chat_not_allowed_on_this_channel" }, requestId });
          break;
        }
        if (!ws.ctx?.userId) {
          safeSend({ type: "error", data: { message: "authentication_required" }, requestId });
          break;
        }
        // ... votre logique chat existante
        break;
      }

      case "game.input": {
        // Logique locale si besoin
        break;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 🎮 REMOTE GAME - CRÉER UNE ROOM
      // ═══════════════════════════════════════════════════════════════════════
      case "game.create_remote": {
        if (!ws.ctx?.userId) {
          safeSend({ type: "error", data: { message: "authentication_required" }, requestId });
          break;
        }
        
        const { username } = msg.data || {};
        if (!username || typeof username !== "string") {
          safeSend({ type: "error", data: { message: "username_required" }, requestId });
          break;
        }

        const { roomManager } = await import('./index.js');
        const gameId = roomManager.createRemoteRoom(ws.ctx.userId, username);
        const room = roomManager.getRoom(gameId);
        
        if (!room) {
          safeSend({ type: "error", data: { message: "failed_to_create_room" }, requestId });
          break;
        }

        // ✅ Attacher la WS du host IMMÉDIATEMENT
        room.addPlayer(String(ws.ctx.userId), username, ws);

        safeSend({
          type: "game.created",
          data: { gameId, status: "waiting", message: "Game created. Waiting for opponent..." },
          requestId,
        });
        
        console.log(`[WS] Host ${username} created room ${gameId}`);
        break;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 🎮 REMOTE GAME - REJOINDRE UNE ROOM
      // ═══════════════════════════════════════════════════════════════════════
      case "game.join_remote": {
        if (!ws.ctx?.userId) {
          safeSend({ type: "error", data: { message: "authentication_required" }, requestId });
          break;
        }
        
        const { gameId, username } = msg.data || {};
        if (!gameId || typeof gameId !== "string" || !username || typeof username !== "string") {
          safeSend({ type: "error", data: { message: "gameId_and_username_required" }, requestId });
          break;
        }

        const { roomManager } = await import('./index.js');
        const room = roomManager.getRoom(gameId);
        
        if (!room) {
          safeSend({ type: "error", data: { message: "game_not_found" }, requestId });
          break;
        }
        if (!room.isRemote()) {
          safeSend({ type: "error", data: { message: "not_a_remote_game" }, requestId });
          break;
        }

        // ✅ Ajouter le joueur 2 avec sa WS
        const joined = room.addPlayer(String(ws.ctx.userId), username, ws);
        
        if (!joined) {
          safeSend({ type: "error", data: { message: "game_full" }, requestId });
          break;
        }

        // ✅ Le jeu démarre automatiquement dans addPlayer() si 2 joueurs
        // → game_started est envoyé via broadcastToClients()
        
        safeSend({ 
          type: "game.joined", 
          data: { 
            gameId, 
            status: room.getStatus(), 
            players: room.getPlayers() 
          }, 
          requestId 
        });
        
        console.log(`[WS] Player ${username} joined room ${gameId}`);
        break;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 🎮 REMOTE GAME - ATTACHER LA WEBSOCKET (après redirection)
      // ═══════════════════════════════════════════════════════════════════════
      case "game.attach": {
        if (!ws.ctx?.userId) {
          safeSend({ type: "error", data: { message: "authentication_required" }, requestId });
          break;
        }
        
        const { gameId } = msg.data || {};
        if (!gameId || typeof gameId !== "string") {
          safeSend({ type: "error", data: { message: "gameId_required" }, requestId });
          break;
        }

        const { roomManager } = await import('./index.js');
        const room = roomManager.getRoom(gameId);

        if (!room) {
          safeSend({ type: "error", data: { message: "game_not_found" }, requestId });
          break;
        }
        if (!room.isRemote()) {
          safeSend({ type: "error", data: { message: "not_a_remote_game" }, requestId });
          break;
        }
        if (!room.hasPlayer(String(ws.ctx.userId))) {
          safeSend({ type: "error", data: { message: "not_in_this_game" }, requestId });
          break;
        }

        // ✅ Attacher la socket (envoie l'état initial automatiquement)
        const ok = room.attachSocket(String(ws.ctx.userId), ws);
        
        if (!ok) {
          safeSend({ type: "error", data: { message: "attach_failed" }, requestId });
          break;
        }

        safeSend({ 
          type: "ok", 
          data: { attached: true, gameId }, 
          requestId 
        });
        
        console.log(`[WS] User ${ws.ctx.userId} attached to game ${gameId}`);
        break;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 🎮 REMOTE GAME - LISTER LES ROOMS EN ATTENTE
      // ═══════════════════════════════════════════════════════════════════════
      case "game.list_waiting": {
        if (!ws.ctx?.userId) {
          safeSend({ type: "error", data: { message: "authentication_required" }, requestId });
          break;
        }
        
        const { roomManager } = await import('./index.js');
        const rooms = roomManager.listWaitingRooms();
        
        safeSend({ 
          type: "game.waiting_list", 
          data: { rooms }, 
          requestId 
        });
        break;
      }

      // ═══════════════════════════════════════════════════════════════════════
      // 🎮 REMOTE GAME - MOUVEMENT DE PADDLE
      // ═══════════════════════════════════════════════════════════════════════
      case "game.paddle_move": {
        if (!ws.ctx?.userId) {
          safeSend({ type: "error", data: { message: "authentication_required" }, requestId });
          break;
        }
        
        const { gameId, direction } = msg.data || {};
        if (!gameId || typeof gameId !== "string" || typeof direction !== "string") {
          safeSend({ type: "error", data: { message: "invalid_paddle_data" }, requestId });
          break;
        }

        const VALID_DIRECTIONS = ["up", "down", "stop"];
        if (!VALID_DIRECTIONS.includes(direction)) {
          safeSend({ type: "error", data: { message: "invalid_direction" }, requestId });
          break;
        }

        const { roomManager } = await import('./index.js');
        const room = roomManager.getRoom(gameId);
        
        if (!room) {
          safeSend({ type: "error", data: { message: "game_not_found" }, requestId });
          break;
        }

        const player = room.getPlayer(String(ws.ctx.userId));
        if (!player) {
          safeSend({ type: "error", data: { message: "not_in_this_game" }, requestId });
          break;
        }

        room.movePaddle(player.paddle, direction as any);
        // Pas de réponse : l'état est broadcasté à 60 FPS
        break;
      }

      default: {
        safeSend({ type: "error", data: { message: "unhandled_message_type" }, requestId });
      }
    }

    // Acknowledge optionnel
    if (requestId) {
      safeSend({ type: "ack", requestId, timestamp: Date.now() });
    }

  } catch (parseError) {
    try { wsMessagesTotal.inc({ type: "invalid" }); } catch {}
    const msg = parseError instanceof Error ? parseError.message : "parse_error";
    safeSend({ type: "error", data: { message: msg }, requestId });
    app.log.warn({ parseError, requestId }, "WS message parsing failed");
  }
});
}); 



  // ───────────────────────────────────────────────────────────────────────────
  // 3) HTTP → WS Upgrade gate
  // ───────────────────────────────────────────────────────────────────────────
  app.server.on("upgrade", (request: IncomingMessage, socket: any, head: Buffer) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      const pathname = url.pathname;
      
      if (pathname !== "/ws") {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
        return;
      }
      
      const isProduction = process.env.NODE_ENV === "production";
      if (isProduction) {
        const origin = request.headers.origin;
        const allowedOrigins = (process.env.FRONT_ORIGINS || "").split(",");
        
        if (origin && !allowedOrigins.includes(origin)) {
          app.log.warn({ origin }, "WS upgrade rejected: invalid origin");
          socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
          socket.destroy();
          return;
        }
      }
      
      const wsKey = request.headers["sec-websocket-key"];
      if (!wsKey) {
        socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
        socket.destroy();
        return;
      }
      
      const MAX_CONNECTIONS = Number(process.env.MAX_WS_CONNECTIONS || 1000);
      if (wss.clients.size >= MAX_CONNECTIONS) {
        app.log.warn("WS upgrade rejected: max connections reached");
        socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        socket.destroy();
        return;
      }
      
      wss.handleUpgrade(request, socket, head, (socketWs: WebSocket) => {
        wss.emit("connection", socketWs, request);
      });
      
    } catch (err) {
      app.log.error({ err }, "WS upgrade error");
      socket.destroy();
    }
  });
}