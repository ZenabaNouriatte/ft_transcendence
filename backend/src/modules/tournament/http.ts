import type { FastifyPluginAsync } from "fastify";
const tournamentHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "tournament" }));
};
export default tournamentHttp;
