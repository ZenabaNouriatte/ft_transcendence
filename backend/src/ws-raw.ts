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

// ─────────────────────────────────────────────────────────────────────────────
// Limits & timings
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MSG_BYTES = 64 * 1024;
const RATE_LIMIT_WINDOW_MS = 5_000;
const RATE_LIMIT_MAX = 50;
const PING_INTERVAL_MS = 20_000;

const now = () => Date.now();

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

  // ───────────────────────────────────────────────────────────────────────────
  // 1) Keepalive
  // ───────────────────────────────────────────────────────────────────────────
  const interval = setInterval(() => {
    wss.clients.forEach((ws: WebSocket & { ctx?: Ctx }) => {
      if (!ws.ctx) return;
      if (ws.ctx.isAlive === false) {
        try { ws.terminate(); } catch {}
        return;
      }
      ws.ctx.isAlive = false;
      try { ws.ping(); } catch {}
    });
    updateGauge(wss);
  }, PING_INTERVAL_MS);

  wss.on("close", () => { clearInterval(interval); });

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
      }

      (ws as any)._channel = channel;
      
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

    setTimeout(() => safeSend("hello: connected"), 100);

    // 2.e) Error/Close handlers
    ws.on("error", (err: Error) => {
      app.log.error({ err }, "WS error");
    });

    ws.on("close", (code: number, reason: Buffer) => {
      try { wsConnections.dec(); } catch {}
      try { wsDisconnectsTotal.inc({ code: String(code) }); } catch {}
      updateGauge(wss);
      app.log.info({ code, reason: reason.toString(), totalConnections: wss.clients.size }, "WS closed");
    });

    // ─────────────────────────────────────────────────────────────────────────
    // 2.f) Message handler
    // ─────────────────────────────────────────────────────────────────────────
    ws.on("message", (buf: Buffer) => {
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
          "game.input",
          "game.pause",
          "game.resume"
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
              
            } catch (err) {
              safeSend({ 
                type: "error", 
                data: { message: "invalid_message_content" }, 
                requestId 
              });
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
            
            app.log.info({ 
              requestId, 
              gameId, 
              player, 
              direction 
            }, "Game input processed");
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