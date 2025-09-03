import type { FastifyPluginAsync } from "fastify";
const gameHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "game" }));
};
export default gameHttp;
