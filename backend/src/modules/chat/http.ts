import type { FastifyPluginAsync } from "fastify";
const chatHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "chat" }));
};
export default chatHttp;
