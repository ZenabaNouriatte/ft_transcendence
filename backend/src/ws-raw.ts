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
  userId?: number; // ← set after JWT validation (sensitive channels)
  rate: { windowStart: number; count: number };
};

// ─────────────────────────────────────────────────────────────────────────────
// Limits & timings
// ─────────────────────────────────────────────────────────────────────────────
const MAX_MSG_BYTES = 64 * 1024;        // 64KB max per message (close 1009 if exceeded)
const RATE_LIMIT_WINDOW_MS = 5_000;     // 5s sliding window
const RATE_LIMIT_MAX = 50;              // 50 messages per window per connection
const PING_INTERVAL_MS = 20_000;        // keepalive ping every 20s

const now = () => Date.now();

// ─────────────────────────────────────────────────────────────────────────────
// Prometheus gauge refresh helper
// ─────────────────────────────────────────────────────────────────────────────
const updateGauge = (wss: WebSocketServer) => {
  try { 
    const activeConnections = wss.clients.size;
    wsConnections.set(activeConnections);
    // Debug log
    console.log(`[WS] Active connections: ${activeConnections}`);
  } catch (e) {
    console.error("[WS] Error updating gauge:", e);
  }
};

export function registerRawWs(app: FastifyInstance) {
  // We do noServer so we can control the HTTP upgrade flow in app.server.on("upgrade")
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });

  // ───────────────────────────────────────────────────────────────────────────
  // 1) Keepalive (ping/pong) + refresh metrics gauge periodically
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
  // 2) Connection handler (runs after successful HTTP upgrade)
  //    We attach context, perform WS auth (channel/token), set rate-limit, etc.
  // ───────────────────────────────────────────────────────────────────────────
  wss.on("connection", async (ws: WebSocket & { ctx?: Ctx }, request: IncomingMessage) => {
    // 2.a) Base context init
    ws.ctx = {
      isAlive: true,
      ip: request.socket?.remoteAddress,
      rate: { windowStart: now(), count: 0 },
    };

    // bump counters
    wsConnections.inc();
    updateGauge(wss);
    app.log.info({ ip: ws.ctx.ip, totalConnections: wss.clients.size }, "WS connection established");

    // 2.b) Pong → mark connection as alive
    ws.on("pong", () => { if (ws.ctx) ws.ctx.isAlive = true; });

    // ─────────────────────────────────────────────────────────────────────────
    // 2.c) AUTH WS (via svc-auth) + channel gating
    //     - channel is passed as query (?channel=local|chat|game-remote)
    //     - token can be provided as ?token=... or Authorization: Bearer ...
    //     - chat & game-remote require a valid JWT; local does not.
    // ─────────────────────────────────────────────────────────────────────────
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      const channel = (url.searchParams.get("channel") || "local").toLowerCase();
      const isSensitiveChannel = channel === "chat" || channel === "game-remote";

      const bearer = request.headers["authorization"]?.toString();
      const token = url.searchParams.get("token") || bearer?.replace(/^Bearer\s+/i, "");

      if (isSensitiveChannel && !token) {
        // Policy: chat & remote game require identity
        try { ws.close(1008, "token_required"); } catch {}
        return;
      }

      if (token) {
        const resp = await fetch("http://auth:8101/validate-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        if (!resp.ok) {
          try { ws.close(1008, "invalid_token"); } catch {}
          return;
        }
        const data = await resp.json().catch(() => ({}));
        if (!Number.isInteger(data.userId) || data.userId <= 0) {
          try { ws.close(1008, "invalid_token"); } catch {}
          return;
        }
        // attach identity to socket context
        ws.ctx.userId = data.userId;
      }

      // (Optional) keep channel on the instance for downstream dispatch
      (ws as any)._channel = channel;
    } catch {
      try { ws.close(1008, "handshake_failed"); } catch {}
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2.d) Utility to send safely (stringify + error logging)
    // ─────────────────────────────────────────────────────────────────────────
    const safeSend = (objOrString: any) => {
      const payload = typeof objOrString === "string" ? objOrString : JSON.stringify(objOrString);
      if (ws.readyState === ws.OPEN) {
        ws.send(payload, (err?: Error) => {
          if (err) app.log.error({ err }, "WS send error");
        });
      }
    };

    // Welcome (small UX/smoke test)
    setTimeout(() => safeSend("hello: connected"), 100);

    // 2.e) Error/Close hooks → metrics & logs
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
    //     Steps:
    //       (1) size bound check (1009 if too large)
    //       (2) connection-level rate-limit
    //       (3) JSON parse + dispatch by 'type'
    //       (4) send ack if requestId present
    // ─────────────────────────────────────────────────────────────────────────
    ws.on("message", (buf: Buffer) => {
      // (1) size bound BEFORE parsing
      const size = Buffer.isBuffer(buf) ? buf.length : Buffer.byteLength(String(buf));
      if (size > MAX_MSG_BYTES) {
        try { ws.close(1009, "Message too large"); } catch {}
        return;
      }

      // (2) simple per-connection rate-limit
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
        const raw = buf.toString();
        const msg = JSON.parse(raw);

        // Extract requestId as string if present
        if (Object.prototype.hasOwnProperty.call(msg, "requestId") && msg.requestId != null) {
          requestId = String(msg.requestId);
        }

        // Dispatch by type
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
            // NOTE: (ws as any)._channel === "chat" should hold here if you want to assert it
            // and ws.ctx.userId should be set on sensitive channels.
            app.log.info({ requestId, userId: ws.ctx?.userId }, "Chat message processed");
            break;
          }

          case "game.input": {
            // NOTE: for remote game inputs; local game may not require auth.
            break;
          }

          default: {
            app.log.warn({ type }, "Unknown WS message type");
            safeSend({ type: "error", data: { message: "unknown type" }, requestId });
          }
        }

        // (4) ACK after handling
        if (requestId) {
          const ack = { type: "ack", requestId };
          app.log.info({ requestId }, "WS ack sent");
          safeSend(ack);
        }

      } catch (parseError) {
        // malformed JSON
        try { wsMessagesTotal.inc({ type: "invalid" }); } catch {}
        safeSend({ type: "error", data: { message: "invalid json" }, requestId });
        app.log.warn({ parseError }, "Invalid JSON received");
      }
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // 3) HTTP → WS Upgrade gate
  //    IMPORTANT: accept /ws with query string too (e.g. /ws?channel=chat&token=...)
  // ───────────────────────────────────────────────────────────────────────────
  app.server.on("upgrade", (request: IncomingMessage, socket: any, head: Buffer) => {
    try {
      const url = new URL(request.url || "/", `http://${request.headers.host}`);
      const pathname = url.pathname; // "/ws"
      if (pathname === "/ws") {
        wss.handleUpgrade(request, socket, head, (socketWs: WebSocket) => {
          wss.emit("connection", socketWs, request);
        });
      } else {
        socket.destroy();
      }
    } catch {
      socket.destroy();
    }
  });
}
