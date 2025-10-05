// backend/src/modules/user/http.ts
import type { FastifyPluginAsync } from "fastify";

// ---- helpers de validation "pures" (pas d'accès DB ici)
function isValidUsername(v: unknown): v is string {
  return typeof v === "string" && v.trim().length >= 3 && v.trim().length <= 32;
}
function isValidEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}
function isValidAvatar(v: unknown): v is string {
  if (typeof v !== "string") return false;
  
  // Longueur max raisonnable
  if (v.length > 500) return false;
  
  try {
    const u = new URL(v);
    // Protocoles autorisés uniquement
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    
    return true;
  } catch {
    return false;
  }
}

// ---- types de payload (validation uniquement)
type ProfilePayload = {
  username?: string | null;
  email?: string | null;
  avatar?: string | null;
};
type FriendshipPayload = {
  selfId: number;
  targetId: number;
  action: "request" | "accept" | "block";
};

// ---- plugin Fastify
const userPlugin: FastifyPluginAsync = async (app) => {
  // santé
  app.get("/ping", async () => ({ ok: true, service: "user" }));

  // POST /validate-profile
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

  // POST /validate-username
  app.post("/validate-username", async (req, reply) => {
    const { username } = (req.body ?? {}) as { username?: string };
    if (!username || !isValidUsername(username)) {
      return reply.code(400).send({ valid: false, error: "invalid_username" });
    }
    return reply.send({ valid: true, username: username.trim() });
  });

  // POST /validate-friendship
  app.post("/validate-friendship", async (req, reply) => {
    const { selfId, targetId, action } = (req.body ?? {}) as Partial<FriendshipPayload>;

    if (typeof selfId !== "number" || typeof targetId !== "number") {
      return reply.code(400).send({ error: "bad_ids" });
    }
    if (!action || !["request", "accept", "block"].includes(action)) {
      return reply.code(400).send({ error: "bad_action" });
    }
    if (selfId === targetId) {
      return reply.code(400).send({ error: "same_user" });
    }
    // règles fines côté gateway / DB
    return reply.send({ action });
  });
};

export default userPlugin;
