// backend/src/modules/user/http.ts
import type { FastifyPluginAsync } from "fastify";

// helpers de validation "pures" (pas d'accès DB ici)
function isValidUsername(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 3 && v.trim().length <= 32;
}
function isValidEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isValidAvatar(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

type ProfilePayload = {
  username?: string | null;
  email?: string | null;
  avatar?: string | null;
};

const userPlugin: FastifyPluginAsync = async (app) => {
  // Sanity check
  app.get("/ping", async () => ({ ok: true, service: "user" }));

  /**
   * POST /validate-profile
   * Valide et normalise un payload de mise à jour de profil.
   * - Ne touche pas à la DB (la DB est gérée par le gateway).
   */
  app.post("/validate-profile", async (req, reply) => {
    const body = (req.body ?? {}) as ProfilePayload;
    const out: ProfilePayload = {};

    if (body.username != null) {
      if (!isValidUsername(body.username)) {
        return reply.code(400).send({ error: "invalid_username", hint: "min 3, max 32" });
      }
      out.username = body.username.trim();
    }

    if (body.email != null) {
      if (!isValidEmail(body.email)) {
        return reply.code(400).send({ error: "invalid_email" });
      }
      out.email = body.email.trim().toLowerCase();
    }

    if (body.avatar != null) {
      if (!isValidAvatar(body.avatar)) {
        return reply.code(400).send({ error: "invalid_avatar_url" });
      }
      out.avatar = body.avatar.trim();
    }

    if (!("username" in out) && !("email" in out) && !("avatar" in out)) {
      return reply.code(400).send({ error: "empty_update" });
    }

    return reply.send(out);
  });
};

export default userPlugin;
