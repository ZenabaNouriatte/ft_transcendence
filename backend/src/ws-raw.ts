// src/ws-raw.ts
import { WebSocketServer, WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "http";
import type { Socket } from "node:net";
import { wsConnections, wsMessagesTotal } from "./common/metrics.js";

export function registerRawWs(app: FastifyInstance) {
  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
  });

  wss.on("connection", (ws: WebSocket, request: IncomingMessage) => {
    wsConnections.inc();
    app.log.info(
      { ip: request.socket?.remoteAddress },
      "WS connection established"
    );

    const safeSend = (data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data, (err?: Error) => {
          if (err) app.log.error({ err }, "WS send error");
        });
      }
    };

    ws.on("error", (err: Error) => {
      app.log.error({ err }, "WS error");
    });

    ws.on("close", (code: number, reason: Buffer) => {
      wsConnections.dec();
      app.log.info(
        { code, reason: reason?.toString?.() || "" },
        "WS closed"
      );
    });

    ws.on("message", (buf: Buffer) => {
      let type = "unknown";
      try {
        const msg = JSON.parse(buf.toString());
        type = msg?.type || "unknown";
      } catch {
        type = "invalid";
      }
      // métrique : compteur des messages reçus par type
      wsMessagesTotal.inc({ type });
    });

    // petit message de bienvenue différé
    setTimeout(() => {
      safeSend("hello: connected");
    }, 100);
  });

  // gestion manuelle des upgrades HTTP -> WS
  app.server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    if (request.url === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });
}
