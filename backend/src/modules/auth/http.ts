// backend/src/modules/auth/http.ts
import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";
import jwt, { type JwtPayload } from "jsonwebtoken";

const authPlugin: FastifyPluginAsync = async (app) => {
  // Lecture du secret (fail-fast conseillé en prod)
  const SECRET = process.env.JWT_SECRET as string | undefined;
  if (!SECRET) {
    app.log.error("Missing JWT_SECRET env var");
    // En prod tu peux décommenter pour empêcher le démarrage :
    // throw new Error("JWT_SECRET is required");
  }

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
    if (!SECRET) return reply.code(500).send({ error: "server_misconfigured" });
    const token = jwt.sign({ userId }, SECRET, { expiresIn: "24h" }); // "5m" si tu veux court
    return { token };
  });

  app.post("/validate-token", async (req, reply) => {
    const { token } = req.body as { token: string };
    if (!SECRET) return reply.code(500).send({ error: "server_misconfigured" });

    try {
      const res = jwt.verify(token, SECRET);
      // verify peut renvoyer string | JwtPayload — on gère proprement
      if (typeof res === "string") {
        return reply.code(401).send({ error: "invalid_token" });
      }
      const payload = res as JwtPayload;
      const userId = Number((payload as any).userId);
      if (!Number.isInteger(userId)) {
        return reply.code(401).send({ error: "invalid_token" });
      }
      return { userId };
    } catch {
      return reply.code(401).send({ error: "invalid_token" });
    }
  });

  app.get("/ping", async () => ({ ok: true, service: "auth" }));
};

export default authPlugin;
