import websocket from "@fastify/websocket";
import type { FastifyInstance } from "fastify";
import { wsConnections } from "./common/metrics.js";

// Alias minimal pour éviter @types/ws
type WS = {
  send: (data: any) => void;
  on: (event: string, listener: (...args: any[]) => void) => void;
  readyState: number;
  OPEN: number;
  ping?: () => void;
};

export async function registerWs(app: FastifyInstance) {
  await app.register(websocket);

  app.get("/ws", { websocket: true }, (conn: any /*, req */) => {
    const socket = (conn?.socket as WS) || null;
    if (!socket) {
      app.log.warn("WS handler without socket");
      return;
    }

    wsConnections.inc();
    app.log.info("WS connected");

    try {
      socket.send("hello: connected");
    } catch (err) {
      app.log.error({ err }, "WS hello send failed");
    }

    socket.on("message", (msg: any) => {
      const text = Buffer.isBuffer(msg) ? msg.toString() : String(msg);
      app.log.info({ text }, "WS message in");
      try {
        socket.send(`echo:${text}`);
      } catch (err) {
        app.log.error({ err }, "WS echo send failed");
      }
    });

    // keepalive (optionnel)
    const iv = setInterval(() => {
      if (socket.readyState === socket.OPEN) {
        try { socket.ping?.(); } catch (err) { app.log.error({ err }, "WS ping failed"); }
      } else {
        clearInterval(iv);
      }
    }, 30000);

    socket.on("error", (err: any) => {
      app.log.error({ err }, "WS error");
      clearInterval(iv);
    });

    socket.on("close", (code: any, reason: any) => {
      clearInterval(iv);
      wsConnections.dec();
      app.log.info({ code, reason: String(reason ?? "") }, "WS closed");
    });
  });
}


