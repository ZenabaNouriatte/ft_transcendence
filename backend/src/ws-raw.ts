// src/ws-raw.ts
import { WebSocketServer, WebSocket } from 'ws';
import type { FastifyInstance } from "fastify";
import { IncomingMessage } from 'http';
import { wsConnections } from './common/metrics.js';

export function registerRawWs(app: FastifyInstance) {
  const wss = new WebSocketServer({ 
    noServer: true,
    perMessageDeflate: false
  });

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    wsConnections.inc();
    app.log.info({ ip: request.socket?.remoteAddress }, "WS connection established");

    const safeSend = (data: string) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(data, (err?: Error) => {
          if (err) app.log.error({ err }, "WS send error");
        });
      }
    };

    ws.on('error', (err: Error) => {
      app.log.error({ err }, "WS error");
    });

    ws.on('close', (code: number, reason: Buffer) => {
      wsConnections.dec();
      app.log.info({ code, reason: reason.toString() }, "WS closed");
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      const text = data.toString();
      app.log.info({ text, isBinary }, "WS message received");
      safeSend(`echo:${text}`);
    });

    // Envoi différé du message de bienvenue
    setTimeout(() => {
      safeSend("hello: connected");
    }, 100);
  });

  // Gestion manuelle des upgrades
  app.server.on('upgrade', (request: IncomingMessage, socket: any, head: Buffer) => {
    if (request.url === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });
}