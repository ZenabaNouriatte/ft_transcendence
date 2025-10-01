// backend/src/modules/auth/http.ts
import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";

const authPlugin: FastifyPluginAsync = async (app) => {
  app.post("/validate-register", async (req, reply) => {
    const body = req.body as { username: string; email: string; password: string };
    if (!body?.username || !body?.email || !body?.password) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const hashed = await bcrypt.hash(body.password, 10);
    return { ...body, password: hashed };
  });

  app.post("/validate-password", async (req, reply) => {
    const body = req.body as { password: string; hashedPassword: string };
    if (!body?.password || !body?.hashedPassword) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const ok = await bcrypt.compare(body.password, body.hashedPassword);
    return ok ? { ok: true } : reply.code(401).send({ ok: false });
  });

  app.post("/generate-token", async (req, reply) => {
    const { userId } = req.body as { userId: number };
    if (!userId) return reply.code(400).send({ error: "invalid_payload" });
    const token = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString("base64");
    return { token };
  });

  app.post("/validate-token", async (req, reply) => {
    const { token } = req.body as { token: string };
    if (!token) return reply.code(400).send({ error: "invalid_payload" });
    try {
      const decoded = JSON.parse(Buffer.from(token, "base64").toString());
      if (typeof decoded?.userId === "number") return { userId: decoded.userId };
      return reply.code(401).send({ error: "invalid_token" });
    } catch {
      return reply.code(401).send({ error: "invalid_token" });
    }
  });

  app.get("/ping", async () => ({ ok: true, service: "auth" }));
};

export default authPlugin;
