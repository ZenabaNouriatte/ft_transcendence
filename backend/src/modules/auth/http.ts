// backend/src/modules/auth/http.ts
import type { FastifyPluginAsync } from "fastify";
import { q } from "../../database/index.js";
import { hashPassword, verifyPassword } from "../../common/security.js";

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

export default async function authRoutes(fastify: FastifyInstance) {
  // POST /api/auth/register
  fastify.post("/register", {
    schema: {
      body: {
        type: "object",
        required: ["username", "email", "password"],
        additionalProperties: false,
        properties: {
          username: { type: "string", minLength: 3, maxLength: 32 },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (req, reply) => {
    const { username, email, password } = req.body as any;

    const exists = await q.get("SELECT 1 FROM users WHERE email = ?", [email]);
    if (exists) return reply.code(409).send({ error: "Email already registered" });

    const pwdHash = await hashPassword(password);         // ← bcrypt ici
    await q.run(
      "INSERT INTO users (username, email, password) VALUES (?,?,?)",
      [username, email, pwdHash]
    );

    return reply.code(201).send({ ok: true });
  });

  // POST /api/auth/login
  fastify.post("/login", {
    schema: {
      body: {
        type: "object",
        required: ["email", "password"],
        additionalProperties: false,
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8, maxLength: 128 },
        },
      },
    },
  }, async (req: any, reply) => {
    const { email, password } = req.body as any;

    const user = await q.get<{ id: number; username: string; password: string }>(
      "SELECT id, username, password FROM users WHERE email = ?", [email]
    );
    if (!user) return reply.code(401).send({ error: "Invalid credentials" });

    const ok = await verifyPassword(user.password, password); // ← bcrypt.compare
    if (!ok) return reply.code(401).send({ error: "Invalid credentials" });

    const token = fastify.jwt.sign({ sub: user.id, username: user.username }, { expiresIn: "7d" });
    return reply.send({ token, user: { id: user.id, username: user.username, email } });
  });
}

export default authPlugin;
