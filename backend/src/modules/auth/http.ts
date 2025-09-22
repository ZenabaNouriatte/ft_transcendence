// import type { FastifyPluginAsync } from "fastify";
// const authHttp: FastifyPluginAsync = async (app) => {
//   app.get("/ping", async () => ({ ok: true, service: "auth" }));
// };
// export default authHttp;

import type { FastifyPluginAsync } from "fastify";

const authHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "auth" }));

  // Le gateway appelle cet endpoint avant d'écrire en DB
  app.post("/validate-register", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const username = String(b.username || "").trim();
    const email = String(b.email || "").trim();
    const password = String(b.password || "");     // ← requis par le repo côté gateway
    const avatar = b.avatar ? String(b.avatar) : null;

    if (!username || !password) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    // renvoyer un objet "propre" que le gateway va persister
    return { username, email, password, avatar };
  });

  app.post("/validate-login", async (req, reply) => {
    const b = (req.body ?? {}) as any;
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    if (!username || !password) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    return { username, password };
  });
};

export default authHttp;
