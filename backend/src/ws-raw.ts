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

type Ctx = {
  isAlive: boolean;
  ip?: string;
  userId?: number; //  si  JWT plus tard
  rate: { windowStart: number; count: number };
};

const MAX_MSG_BYTES = 64 * 1024;        
const RATE_LIMIT_WINDOW_MS = 5_000;     
const RATE_LIMIT_MAX = 50;             
const PING_INTERVAL_MS = 20_000;        

const now = () => Date.now();

// Recalage du gauge (pour Prometheus)
const updateGauge = (wss: WebSocketServer) => {
  try { 
    const activeConnections = wss.clients.size;
    wsConnections.set(activeConnections);
    console.log(`[WS] Active connections: ${activeConnections}`); // Debug log
  } catch (e) {
    console.error('[WS] Error updating gauge:', e);
  }
};

export function registerRawWs(app: FastifyInstance) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  // Keepalive + recalage du gauge
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

  wss.on("connection", (ws: WebSocket & { ctx?: Ctx }, request: IncomingMessage) => {
    ws.ctx = {
      isAlive: true,
      ip: request.socket?.remoteAddress,
      rate: { windowStart: now(), count: 0 },
    };

    // Incret maj le gauge
    wsConnections.inc();
    updateGauge(wss);
    app.log.info({ ip: ws.ctx.ip, totalConnections: wss.clients.size }, "WS connection established");

    ws.on("pong", () => { if (ws.ctx) ws.ctx.isAlive = true; });

    const safeSend = (objOrString: any) => {
      const payload = typeof objOrString === "string" ? objOrString : JSON.stringify(objOrString);
      if (ws.readyState === ws.OPEN) {
        ws.send(payload, (err?: Error) => {
          if (err) app.log.error({ err }, "WS send error");
        });
      }
    };

    // Message de bienvenue (UX + test smoke)
    setTimeout(() => safeSend("hello: connected"), 100);

    ws.on("error", (err: Error) => {
      app.log.error({ err }, "WS error");
    });

    ws.on("close", (code: number, reason: Buffer) => {
      // on decremente le gauge + on comptabilise le code de fermeture
      try { wsConnections.dec(); } catch {}
      try { wsDisconnectsTotal.inc({ code: String(code) }); } catch {}
      updateGauge(wss);
      app.log.info({ code, reason: reason.toString(), totalConnections: wss.clients.size }, "WS closed");
    });

    // Reception de message
    ws.on("message", (buf: Buffer) => {
      // ...
      if (ws.ctx) {
        const t = now();
        const r = ws.ctx.rate;
        if (t - r.windowStart > RATE_LIMIT_WINDOW_MS) {
          r.windowStart = t; r.count = 0;
        }
        r.count++;
        if (r.count > RATE_LIMIT_MAX) {
          // on compte le rate-limit
          try { wsRateLimitedTotal.inc(); } catch {}
          try { wsMessagesTotal.inc({ type: "rate_limited" }); } catch {}
          safeSend({ type: "error", data: { message: "rate_limited" } });
          return;
        }
      }

      // Rate-limit
      if (ws.ctx) {
        const t = now();
        const r = ws.ctx.rate;
        if (t - r.windowStart > RATE_LIMIT_WINDOW_MS) {
          r.windowStart = t; r.count = 0;
        }
        r.count++;
        if (r.count > RATE_LIMIT_MAX) {
          wsMessagesTotal.inc({ type: "rate_limited" });
          safeSend({ type: "error", data: { message: "rate_limited" } });
          return;
        }
      }

      let type = "unknown";
      let requestId: string | undefined;

      try {
        const raw = buf.toString();
        const msg = JSON.parse(raw);

        // requestId cast robuste en string si present
        if (Object.prototype.hasOwnProperty.call(msg, "requestId") && msg.requestId != null) {
          requestId = String(msg.requestId);
        }

        // Dispatch minimal par type
        type = typeof msg?.type === "string" ? msg.type : "unknown";
        
        try { 
          wsMessagesTotal.inc({ type });
          app.log.info({ type, requestId }, `WS message received, type: ${type}`);
        } catch (e) {
          app.log.error({ err: e }, "Error incrementing ws metrics");
        }
        
        switch (type) {
          case "ws.ping": {
            safeSend({ type: "ws.pong", ts: Date.now(), requestId });
            break;
          }

          case "chat.message": {
            app.log.info({ requestId }, "Chat message processed");
            break;
          }

          case "game.input": {
            // TODO: logique jeu
            break;
          }

          default: {
            app.log.warn({ type }, "Unknown WS message type");
            safeSend({ type: "error", data: { message: "unknown type" }, requestId });
          }
        }
        
        // Envoyer l'ACK apres traitement
        if (requestId) {
          const ack = { type: "ack", requestId };
          app.log.info({ requestId }, "WS ack sent");
          safeSend(ack);
        }
        
      } catch (parseError) {
        type = "invalid";
        // Incr pour les messages invalides aussi
        try { 
          wsMessagesTotal.inc({ type: "invalid" });
        } catch {}
        safeSend({ type: "error", data: { message: "invalid json" }, requestId });
        app.log.warn({ parseError }, "Invalid JSON received");
      }
    });
  });

  // Upgrade HTTP WS (
  app.server.on("upgrade", (request: IncomingMessage, socket: any, head: Buffer) => {
    if (request.url === "/ws") {
      wss.handleUpgrade(request, socket, head, (socketWs: WebSocket) => {
        wss.emit("connection", socketWs, request);
      });
    } else {
      socket.destroy();
    }
  });
}