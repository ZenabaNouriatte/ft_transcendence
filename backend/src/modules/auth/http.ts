import type { FastifyPluginAsync } from "fastify";
const authHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "auth" }));
};
export default authHttp;
