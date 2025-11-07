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
import { handleDirectMessage } from "./ws-dm-handler.js";

// Global GameRoomManager instance (set by index.ts)
let gameRoomManager: any = null;

// Store WebSocket connections by gameId for broadcasting
const gameConnections = new Map<string, Set<WebSocket>>();

// Store WebSocket connections for chat broadcasting
const chatConnections = new Set<WebSocket>();

// Store WebSocket connections for direct messages by userId
const dmConnections = new Map<number, WebSocket>();

// Broadcast a message to all connections in a specific game
function broadcastToGame(gameId: string, message: any) {
  console.log(`🚀 [DEBUG] broadcastToGame called for gameId: ${gameId}, message type: ${message.type}`);
  const connections = gameConnections.get(gameId);
  if (!connections) {
    console.log(`🚀 [DEBUG] No connections found for gameId: ${gameId}`);
    return;
  }
  
  console.log(`🚀 [DEBUG] Found ${connections.size} connections for gameId: ${gameId}`);
  const messageStr = JSON.stringify(message);
  connections.forEach((ws, index) => {
    if (ws.readyState === ws.OPEN) {
      console.log(`🚀 [DEBUG] Sending to connection ${index} for gameId: ${gameId}`);
      ws.send(messageStr, (err?: Error) => {
        if (err) console.error("Error broadcasting game message:", err);
      });
    } else {
      console.log(`🚀 [DEBUG] Connection ${index} not open for gameId: ${gameId}`);
    }
  });
}

// Broadcast a message to all chat connections
function broadcastToChat(message: any) {
  const messageStr = JSON.stringify(message);
  console.log('[chat] Broadcasting to', chatConnections.size, 'connections:', messageStr);
  chatConnections.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      console.log('[chat] Sending to one client...');
      ws.send(messageStr, (err?: Error) => {
        if (err) console.error("[chat] Error broadcasting chat message:", err);
        else console.log('[chat] ✅ Message sent successfully');
      });
    } else {
      console.log('[chat] ⚠️ WebSocket not open, state:', ws.readyState);
    }
  });
  console.log('[chat] Broadcast complete');
}

// Send a system message to the global chat (for tournament notifications, etc.)
export function sendSystemChatMessage(message: string) {
  console.log('[chat] Sending system message:', message);
  broadcastToChat({
    type: "chat.message",
    userId: 0, // 0 = system message
    username: "System",
    avatar: null,
    message: message,
    timestamp: new Date().toISOString(),
    isSystem: true
  });
}

// Send a direct message to a specific user
function sendDirectMessage(userId: number, message: any) {
  const ws = dmConnections.get(userId);
  if (ws && ws.readyState === ws.OPEN) {
    const messageStr = JSON.stringify(message);
    console.log('[dm] Sending DM to user', userId, ':', messageStr);
    ws.send(messageStr, (err?: Error) => {
      if (err) console.error("[dm] Error sending direct message:", err);
      else console.log('[dm] ✅ DM sent successfully to user', userId);
    });
    return true;
  } else {
    console.log('[dm] User', userId, 'not connected or WebSocket not open');
    return false;
  }
}

// Function to set the GameRoomManager instance
export function setGameRoomManager(manager: any) {
  gameRoomManager = manager;
  console.log("🎮 GameRoomManager connected to WebSocket system");
}

// Export sendDirectMessage for external use
export function sendDirectMessageToUser(userId: number, message: any): boolean {
  return sendDirectMessage(userId, message);
}

// Fonction de sanitization si le module n'existe pas
function sanitizeString(input: string, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '').substring(0, maxLength);
}

function validateEnum<T extends readonly string[]>(
  value: string, 
  allowedValues: T
): T[number] {
  if (allowedValues.includes(value as T[number])) {
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

// ─────────────────────────────────────────────────
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
    console.log(`[WS] Active connections: ${activeConnections}`);
  } catch (e) {
    console.error("[WS] Error updating gauge:", e);
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
       (ws as any)._token = token; // Store token for later use
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

    // Add to chat connections if this is a chat channel
    if ((ws as any)._channel === "chat") {
      chatConnections.add(ws);
      console.log('[chat] Added WebSocket to chatConnections. Total:', chatConnections.size);
    }

    // Add to DM connections if user is authenticated
    if (ws.ctx?.userId) {
      dmConnections.set(ws.ctx.userId, ws);
      console.log('[dm] Registered user', ws.ctx.userId, 'for direct messages. Total DM connections:', dmConnections.size);
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

    setTimeout(() => safeSend("hello: connected"), 100);

    // 2.e) Error/Close handlers
    ws.on("close", (code: number, reason: Buffer) => {
      try { wsConnections.dec(); } catch {}
      updateGauge(wss);

      // Clean up chat connections
      if ((ws as any)._channel === "chat") {
        chatConnections.delete(ws);
        console.log('[chat] Removed WebSocket from chatConnections. Total:', chatConnections.size);
      }

      // Clean up DM connections
      if (ws.ctx?.userId) {
        dmConnections.delete(ws.ctx.userId);
        console.log('[dm] Unregistered user', ws.ctx.userId, 'from direct messages. Total DM connections:', dmConnections.size);
      }

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

          if (ws.ctx?.userId && gameRoomManager) {
            try {
              const userId = String(ws.ctx.userId);
              console.log(`[GameRoom] Player ${userId} disconnected, removing from all active games`);
              
              // Parcourir toutes les rooms pour trouver celles où ce joueur participe
              gameRoomManager.removePlayerFromAllRooms(userId);
            } catch (error) {
              console.error('[GameRoom] Error removing player from rooms:', error);
            }
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

      let type = "unknown";
      let requestId: string | undefined;

      try {
        const raw = buf.toString("utf8");
        const msg = JSON.parse(raw);
        
        if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
          throw new Error("Invalid message structure");
        }

        if (Object.prototype.hasOwnProperty.call(msg, "requestId")) {
          if (msg.requestId != null) {
            const rid = String(msg.requestId);
            if (rid.length > 100) {
              throw new Error("requestId too long");
            }
            requestId = rid;
          }
        }

        if (typeof msg.type !== "string") {
          throw new Error("Missing or invalid message type");
        }
        
        type = msg.type.trim();
        
        if (type.length > 50) {
          throw new Error("Message type too long");
        }

        const ALLOWED_TYPES = [
          "ws.ping",
          "chat.message",
          "dm.message",
          "game.invitation",
          "game.input",
          "game.pause",
          "game.resume",
          "game.create",
          "game.join",
          "game.ready",
          "game.start"
        ];
        
        if (!ALLOWED_TYPES.includes(type)) {
          type = "unknown";
          app.log.warn({ type: msg.type }, "Unknown WS message type");
          safeSend({ 
            type: "error", 
            data: { message: "unknown_message_type" }, 
            requestId 
          });
          return;
        }
        
        try { 
          wsMessagesTotal.inc({ type });
        } catch (e) {
          app.log.error({ err: e }, "Error incrementing ws metrics");
        }

        switch (type) {
          case "ws.ping": {
            safeSend({ 
              type: "ws.pong", 
              ts: Date.now(), 
              requestId 
            });
            break;
          }

          case "chat.message": {
            if ((ws as any)._channel !== "chat") {
              safeSend({ 
                type: "error", 
                data: { message: "chat_not_allowed_on_this_channel" }, 
                requestId 
              });
              break;
            }
            
            if (!ws.ctx?.userId) {
              safeSend({ 
                type: "error", 
                data: { message: "authentication_required" }, 
                requestId 
              });
              break;
            }
            
            if (!msg.data || typeof msg.data !== "object") {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_message_data" }, 
                requestId 
              });
              break;
            }
            
            try {
              const messageContent = sanitizeString(msg.data.message, 500);
              
              if (messageContent.length === 0) {
                safeSend({ 
                  type: "error", 
                  data: { message: "empty_message" }, 
                  requestId 
                });
                break;
              }
              
              app.log.info({ 
                requestId, 
                userId: ws.ctx.userId,
                messageLength: messageContent.length 
              }, "Chat message processed");
              
              // Get username and broadcast message to all chat connections
              const userId = ws.ctx?.userId;
              if (!userId) {
                app.log.error("No userId found in context for chat message");
                break;
              }
              
              // Use the token to get the user's information
              const token = (ws as any)._token || 'unknown';
              
              fetch(`http://gateway:8000/api/users/me`, {
                headers: {
                  'Authorization': `Bearer ${token}`,
                  'Content-Type': 'application/json'
                }
              })
                .then(userResponse => {
                  let username = `User${userId}`;
                  let avatar: string | null = null;
                  
                  if (userResponse.ok) {
                    return userResponse.json().then(userData => {
                      if (userData.user && userData.user.username) {
                        username = userData.user.username;
                        avatar = userData.user.avatar || null;
                      }
                      return { username, avatar };
                    });
                  } else {
                    return { username, avatar };
                  }
                })
                .then(({ username, avatar }) => {
                  // Broadcast the message to all chat connections
                  console.log('[chat] About to broadcast message with username:', username, 'avatar:', avatar);
                  broadcastToChat({
                    type: "chat.message",
                    userId: userId,
                    username: username,
                    avatar: avatar,
                    message: messageContent,
                    timestamp: new Date().toISOString()
                  });
                  console.log('[chat] broadcastToChat call completed');
                })
                .catch(fetchErr => {
                  console.log('[chat] ⚠️ Fetch error, broadcasting with fallback username');
                  app.log.error({ fetchErr }, "Error fetching user data for chat");
                  // Still broadcast with fallback username
                  broadcastToChat({
                    type: "chat.message",
                    userId: userId,
                    username: `User${userId}`,
                    avatar: null,
                    message: messageContent,
                    timestamp: new Date().toISOString()
                  });
                });
              
            } catch (err) {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_message_content" }, 
                requestId 
              });
            }
            break;
          }

          case "dm.message": {
            // Direct message handler
            if (!ws.ctx?.userId) {
              safeSend({ 
                type: "error", 
                data: { message: "authentication_required" }, 
                requestId 
              });
              break;
            }
            
            // Handle DM using dedicated handler
            handleDirectMessage(msg.data, requestId, {
              senderId: ws.ctx.userId,
              token: (ws as any)._token || '',
              safeSend,
              sendDirectMessage,
              app
            });
            break;
          }

          case "game.invitation": {
            console.log('[DEBUG-BACKEND] 🎮🎮🎮 game.invitation case triggered!');
            console.log('[DEBUG-BACKEND] 🎮 msg.data:', msg.data);
            
            // Invitation à une partie online
            if (!ws.ctx?.userId) {
              console.log('[DEBUG-BACKEND] 🎮 ❌ No userId in ws.ctx');
              safeSend({ 
                type: "error", 
                data: { message: "authentication_required" }, 
                requestId 
              });
              break;
            }
            
            console.log('[DEBUG-BACKEND] 🎮 Sender userId:', ws.ctx.userId);
            
            const { receiverId, gameId, senderUsername } = msg.data || {};
            
            console.log('[DEBUG-BACKEND] 🎮 Extracted - receiverId:', receiverId, 'gameId:', gameId, 'senderUsername:', senderUsername);
            
            if (!receiverId || typeof receiverId !== "number") {
              console.log('[DEBUG-BACKEND] 🎮 ❌ Invalid receiverId:', receiverId);
              safeSend({ 
                type: "error", 
                data: { message: "invalid_receiver_id" }, 
                requestId 
              });
              break;
            }
            
            if (!gameId || typeof gameId !== "string") {
              console.log('[DEBUG-BACKEND] 🎮 ❌ Invalid gameId:', gameId);
              safeSend({ 
                type: "error", 
                data: { message: "invalid_game_id" }, 
                requestId 
              });
              break;
            }
            
            console.log('[DEBUG-BACKEND] 🎮 Validation passed, sending invitation...');
            
            // Envoyer l'invitation au destinataire
            const sent = sendDirectMessage(receiverId, {
              type: "game.invitation",
              data: {
                senderId: ws.ctx.userId,
                senderUsername: senderUsername || `User${ws.ctx.userId}`,
                gameId: gameId,
                timestamp: new Date().toISOString()
              }
            });
            
            console.log('[DEBUG-BACKEND] 🎮 sendDirectMessage returned:', sent);
            
            if (sent) {
              safeSend({ 
                type: "game.invitation.sent", 
                data: { receiverId, gameId },
                requestId 
              });
              console.log(`[DEBUG-BACKEND] 🎮 ✅ Invitation sent from ${ws.ctx.userId} to ${receiverId} for game ${gameId}`);
            } else {
              safeSend({ 
                type: "error", 
                data: { message: "user_not_connected" }, 
                requestId 
              });
              console.log(`[DEBUG-BACKEND] 🎮 ❌ User ${receiverId} not connected`);
            }
            break;
          }

          case "game.input": {
            if (!msg.data || typeof msg.data !== "object") {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_input_data" }, 
                requestId 
              });
              break;
            }
            
            const { gameId, player, direction } = msg.data;
            
            if (typeof gameId !== "string" || gameId.length === 0 || gameId.length > 50) {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_game_id" }, 
                requestId 
              });
              break;
            }
            
            if (player !== 1 && player !== 2) {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_player_number" }, 
                requestId 
              });
              break;
            }
            
            const VALID_DIRECTIONS = ["up", "down", "stop"];
            if (typeof direction !== "string" || !VALID_DIRECTIONS.includes(direction)) {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_direction" }, 
                requestId 
              });
              break;
            }
            
            // Actually process the input with GameRoomManager
            if (gameRoomManager) {
              const room = gameRoomManager.getRoom(gameId);
              if (room) {
                // Convertir le numéro de joueur en position de paddle
                const paddleSide: 'left' | 'right' = player === 1 ? 'left' : 'right';
                room.movePaddle(paddleSide, direction as any);
              }
            }
            
            app.log.info({ 
              requestId, 
              gameId, 
              player, 
              direction 
            }, "Game input processed");
            break;
          }

          case "game.create": {
            console.log("🎮 [Debug] game.create received, channel:", (ws as any)._channel);
            
            if ((ws as any)._channel !== "game-remote") {
              safeSend({ 
                type: "error", 
                data: { message: "game_not_allowed_on_this_channel" }, 
                requestId 
              });
              break;
            }
            
            if (!gameRoomManager) {
              safeSend({ 
                type: "error", 
                data: { message: "game_system_not_ready" }, 
                requestId 
              });
              break;
            }

            try {
              // Utiliser un gameId personnalisé s'il est fourni, sinon générer un court
              let gameId = msg.data?.gameId;
              
              if (!gameId || gameId.trim().length === 0) {
                // Générer un ID court automatique (6 caractères alphanumériques)
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                gameId = '';
                for (let i = 0; i < 6; i++) {
                  gameId += chars.charAt(Math.floor(Math.random() * chars.length));
                }
              } else {
                // Nettoyer et valider le gameId personnalisé
                gameId = gameId.trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 50); // Increased to 50 for game invitations
                if (gameId.length === 0) {
                  safeSend({ 
                    type: "error", 
                    data: { message: "invalid_game_id" }, 
                    requestId 
                  });
                  break;
                }
              }
              
              // Vérifier si la room existe déjà
              if (gameRoomManager.getRoom(gameId)) {
                safeSend({ 
                  type: "error", 
                  data: { message: "room_already_exists", gameId }, 
                  requestId 
                });
                break;
              }
              
              const room = gameRoomManager.createRoom(gameId);
              
              // Auto-join: Ajouter automatiquement le créateur à la room
              const creatorId = String(ws.ctx?.userId || '');
              let creatorUsername = `User${creatorId}`;

              if (creatorId) {
                try {
                  const user = await UserService.findUserById(parseInt(creatorId));
                  if (user?.username) {
                    creatorUsername = user.username;
                    console.log(`✅ [Auto-join] Retrieved creator username "${creatorUsername}" for userId ${creatorId}`);
                  }
                } catch (error) {
                  console.error(`❌ [Auto-join] Failed to get creator username for user ${creatorId}:`, error);
                }
                
                // IMPORTANT: Configurer le WebSocket AVANT addPlayer pour recevoir le broadcast
                // Store gameId in WebSocket context for cleanup
                (ws as any)._gameId = gameId;
                (ws as any)._userId = creatorId;
                
                // Add WebSocket to game connections
                if (!gameConnections.has(gameId)) {
                  gameConnections.set(gameId, new Set());
                }
                gameConnections.get(gameId)!.add(ws);
                
                // Set up message handler for this room
                const messageHandler = (message: any) => {
                  broadcastToGame(gameId, message);
                };
                room.addMessageHandler(messageHandler);
                (ws as any)._gameMessageHandler = messageHandler;
                
                // Maintenant ajouter le joueur (le broadcast sera reçu)
                const joined = room.addPlayer(creatorId, creatorUsername);
                
                if (joined) {
                  console.log(`✅ [Auto-join] Creator ${creatorUsername} (${creatorId}) auto-joined room ${gameId}`);
                  
                  // Envoyer la confirmation de création ET de join
                  safeSend({ 
                    type: "game.created", 
                    data: { gameId, autoJoined: true }, 
                    requestId 
                  });
                } else {
                  // Si le join a échoué, envoyer juste la création
                  safeSend({ 
                    type: "game.created", 
                    data: { gameId, autoJoined: false }, 
                    requestId 
                  });
                }
              } else {
                // Pas d'userId, envoyer juste la création
                safeSend({ 
                  type: "game.created", 
                  data: { gameId, autoJoined: false }, 
                  requestId 
                });
              }
              
              app.log.info({ gameId }, "Game room created");
            } catch (error) {
              app.log.error({ error }, "Error creating game room");
              safeSend({ 
                type: "error", 
                data: { message: "failed_to_create_game" }, 
                requestId 
              });
            }
            break;
          }

          case "game.join": {
            console.log("🎮 [Debug] game.join received, channel:", (ws as any)._channel);
            
            if ((ws as any)._channel !== "game-remote") {
              safeSend({ 
                type: "error", 
                data: { message: "game_not_allowed_on_this_channel" }, 
                requestId 
              });
              break;
            }
            
            if (!msg.data || typeof msg.data !== "object" || typeof msg.data.gameId !== "string") {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_game_data" }, 
                requestId 
              });
              break;
            }

            const { gameId } = msg.data;
            
            if (!gameRoomManager) {
              safeSend({ 
                type: "error", 
                data: { message: "game_system_not_ready" }, 
                requestId 
              });
              break;
            }

            try {
              const room = gameRoomManager.getRoom(gameId);
              if (!room) {
                safeSend({ 
                  type: "error", 
                  data: { message: "game_room_not_found" }, 
                  requestId 
                });
                break;
              }

              // Try to add player to room
              if (!ws.ctx?.userId) {
                safeSend({ 
                  type: "error", 
                  data: { message: "authentication_required" }, 
                  requestId 
                });
                break;
              }

              const userId = String(ws.ctx.userId);
              
              // Récupérer le vrai nom de l'utilisateur depuis la BDD
              let username = `User${userId}`;
              try {
                const user = await UserService.findUserById(parseInt(userId));
                if (user?.username) {
                  username = user.username;
                  console.log(`✅ [Debug] Retrieved username "${username}" for userId ${userId}`);
                }
              } catch (error) {
                console.error(`❌ [Debug] Failed to get username for user ${userId}:`, error);
              }
              
              const joined = room.addPlayer(userId, username);
              
              if (joined) {
                // Store gameId in WebSocket context for cleanup
                (ws as any)._gameId = gameId;
                (ws as any)._userId = userId;
                console.log(`✅ [Debug] game.join - Stored _userId=${userId} on WebSocket for gameId=${gameId}`);
                
                // Add WebSocket to game connections for broadcasting
                if (!gameConnections.has(gameId)) {
                  gameConnections.set(gameId, new Set());
                }
                gameConnections.get(gameId)!.add(ws);
                
                // Set up message handler for this room to broadcast to WebSockets
                const messageHandler = (message: any) => {
                  broadcastToGame(gameId, message);
                };
                room.addMessageHandler(messageHandler);
                
                // Store handler for cleanup
                (ws as any)._gameMessageHandler = messageHandler;
                
                safeSend({ 
                  type: "game.joined", 
                  data: { gameId, userId }, 
                  requestId 
                });
                app.log.info({ gameId, userId }, "Player joined game");
              } else {
                safeSend({ 
                  type: "error", 
                  data: { message: "game_room_full" }, 
                  requestId 
                });
              }
            } catch (error) {
              app.log.error({ error, gameId }, "Error joining game room");
              safeSend({ 
                type: "error", 
                data: { message: "failed_to_join_game" }, 
                requestId 
              });
            }
            break;
          }

          case "game.ready": {
            console.log("🎮 [Debug] game.ready received, channel:", (ws as any)._channel);
            
            if ((ws as any)._channel !== "game-remote") {
              safeSend({ 
                type: "error", 
                data: { message: "game_not_allowed_on_this_channel" }, 
                requestId 
              });
              break;
            }

            if (!gameRoomManager) {
              safeSend({ 
                type: "error", 
                data: { message: "game_system_not_ready" }, 
                requestId 
              });
              break;
            }

            try {
              const gameId = msg.data?.gameId;
              
              // 🔍 DEBUG: Vérifier toutes les sources possibles de userId
              console.log("🔍 [Debug] game.ready - Checking userId sources:");
              console.log("  - (ws as any)._userId:", (ws as any)._userId);
              console.log("  - ws.ctx?.userId:", ws.ctx?.userId);
              console.log("  - msg.data?.userId:", msg.data?.userId);
              console.log("  - gameId:", gameId);
              
              // Utiliser _userId s'il existe, sinon fallback sur ctx.userId
              let userId = (ws as any)._userId;
              if (!userId && ws.ctx?.userId) {
                userId = String(ws.ctx.userId);
                console.log("  ℹ️ Using fallback userId from ws.ctx");
              }
              
              const ready = msg.data?.ready || false;
              
              if (!gameId || !userId) {
                console.log("❌ [Debug] Missing gameId or userId:", { gameId, userId });
                safeSend({ 
                  type: "error", 
                  data: { message: "missing_game_or_user_id", debug: { gameId, userId } }, 
                  requestId 
                });
                break;
              }

              const room = gameRoomManager.getRoom(gameId);
              if (!room) {
                safeSend({ 
                  type: "error", 
                  data: { message: "room_not_found" }, 
                  requestId 
                });
                break;
              }

              // Mettre à jour le statut ready du joueur dans la room
              console.log(`🔧 [Debug] Calling setPlayerReady(userId="${userId}", ready=${ready})`);
              const result = room.setPlayerReady(userId, ready);
              console.log(`🔧 [Debug] setPlayerReady returned:`, result);
              
              // Diffuser le nouveau statut à tous les joueurs de la room
              broadcastToGame(gameId, {
                type: "game.ready",
                data: {
                  userId: userId,
                  ready: ready,
                  playerName: `Player${userId}`
                }
              });
              
              app.log.info({ gameId, userId, ready }, "Player ready status updated");
              
            } catch (error) {
              console.log(`❌ [Debug] Exception in game.ready:`, error);
              app.log.error({ error }, "Error updating player ready status");
              safeSend({ 
                type: "error", 
                data: { message: "ready_status_update_failed" }, 
                requestId 
              });
            }
            break;
          }

          case "game.start": {
            console.log("🎮 [Debug] game.start received, channel:", (ws as any)._channel);
            
            if ((ws as any)._channel !== "game-remote") {
              safeSend({ 
                type: "error", 
                data: { message: "game_not_allowed_on_this_channel" }, 
                requestId 
              });
              break;
            }
            
            if (!msg.data || typeof msg.data !== "object" || typeof msg.data.gameId !== "string") {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_game_data" }, 
                requestId 
              });
              break;
            }

            const { gameId } = msg.data;
            
            if (!gameRoomManager) {
              safeSend({ 
                type: "error", 
                data: { message: "game_system_not_ready" }, 
                requestId 
              });
              break;
            }

            try {
              const room = gameRoomManager.getRoom(gameId);
              if (!room) {
                safeSend({ 
                  type: "error", 
                  data: { message: "game_room_not_found" }, 
                  requestId 
                });
                break;
              }

              room.startGame();
              app.log.info({ gameId }, "Game started");
              
              safeSend({ 
                type: "game.started", 
                data: { gameId }, 
                requestId 
              });
            } catch (error) {
              app.log.error({ error, gameId }, "Error starting game");
              safeSend({ 
                type: "error", 
                data: { message: "failed_to_start_game" }, 
                requestId 
              });
            }
            break;
          }

          default: {
            safeSend({ 
              type: "error", 
              data: { message: "unhandled_message_type" }, 
              requestId 
            });
          }
        }

        if (requestId) {
          safeSend({ 
            type: "ack", 
            requestId,
            timestamp: Date.now()
          });
        }

      } catch (parseError) {
        try { wsMessagesTotal.inc({ type: "invalid" }); } catch {}
        
        const errorMsg = parseError instanceof Error ? parseError.message : "parse_error";
        
        safeSend({ 
          type: "error", 
          data: { message: errorMsg }, 
          requestId 
        });
        
        app.log.warn({ parseError, requestId }, "WS message parsing failed");
      }
    }); // Fin du handler 'message'
  }); // Fin du handler 'connection'

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