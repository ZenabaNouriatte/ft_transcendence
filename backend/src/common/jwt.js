// backend/src/common/jwt.ts
import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { env } from "./env.js";

declare module "fastify" {
  interface FastifyInstance {
    auth: (req: FastifyRequest, rep: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user: { sub: number; username?: string };
  }
}

export default fp(async function (fastify: FastifyInstance) {
  await fastify.register(fastifyJwt, { secret: env.JWT_SECRET });
  fastify.decorate("auth", async (req, reply) => {
    try { await req.jwtVerify(); }
    catch { return reply.code(401).send({ error: "Unauthorized" }); }
  });
});
