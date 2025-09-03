import websocket from "@fastify/websocket";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { wsConnections } from "./common/metrics.js"; // keep if you have it

export async function registerWs(app: FastifyInstance) {
  await app.register(websocket, { options: { perMessageDeflate: false } });

  app.get("/ws", { websocket: true }, (conn, req: FastifyRequest) => {
    const ws = conn.socket;

    // wsConnections?.inc?.();
    app.log.info({ ip: req.socket?.remoteAddress, state: ws.readyState }, "WS handler entered");

    const safeSend = (data: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data, (err?: Error) => {
          if (err) app.log.error({ err }, "WS send cb error");
        });
      } else {
        app.log.warn({ state: ws.readyState }, "WS not OPEN, skip send");
      }
    };

    ws.on("error", (err: unknown) => {
      app.log.error({ err }, "WS error");
    });

    ws.on("close", (code: number, reason: Buffer) => {
      // wsConnections?.dec?.();
      app.log.info({ code, reason: reason?.toString() }, "WS closed");
    });

    ws.on("message", (buf: Buffer) => {
      const txt = buf.toString();
      app.log.info({ txt }, "WS message in");
      safeSend(`echo:${txt}`);
    });

    setTimeout(() => {
      app.log.info({ state: ws.readyState }, "WS state before hello");
      safeSend("hello");
    }, 10);
  });
}

