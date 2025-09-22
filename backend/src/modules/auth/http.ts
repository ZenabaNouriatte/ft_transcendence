// import type { FastifyPluginAsync } from "fastify";
// const authHttp: FastifyPluginAsync = async (app) => {
//   app.get("/ping", async () => ({ ok: true, service: "auth" }));
// };
// export default authHttp;

import type { FastifyPluginAsync } from "fastify";

const authHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "auth" }));

  app.post("/validate-register", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const username = String(b.username || "").trim();
    const email = String(b.email || "").trim();
    const password = String(b.password || "");
    const avatar = b.avatar ? String(b.avatar) : null;

    if (!username || !password) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const crypto = await import("crypto");
    const hashedPassword = crypto.createHash("sha256").update(password).digest("hex");
    return { username, email, password: hashedPassword, avatar };
  });

  app.post("/validate-password", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const password = String(b.password || "");
    const hashed = String(b.hashedPassword || "");
    const crypto = await import("crypto");
    const inHash = crypto.createHash("sha256").update(password).digest("hex");
    if (inHash !== hashed) return reply.code(401).send({ error: "invalid_password" });
    return { valid: true };
  });

  app.post("/generate-token", async (req) => {
    const userId = Number((req.body as any)?.userId || 0);
    const payload = { userId, ts: Date.now() };
    return { token: Buffer.from(JSON.stringify(payload)).toString("base64") };
  });

  app.post("/validate-token", async (req, reply) => {
    const token = String((req.body as any)?.token || "");
    try {
      const p = JSON.parse(Buffer.from(token, "base64").toString());
      return { userId: Number(p.userId), valid: true };
    } catch {
      return reply.code(401).send({ error: "invalid_token" });
    }
  });
};

export default authHttp;

