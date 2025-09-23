import type { FastifyPluginAsync } from "fastify";

const tournamentPlugin: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "tournament" }));

  // Créer un tournoi
  app.post("/validate-tournament", async (req, reply) => {
    const { name, description, max_players, created_by } = (req.body as any) || {};

    if (!created_by) return reply.code(401).send({ error: "no_user" });
    if (typeof name !== "string" || name.trim().length < 3) {
      return reply.code(400).send({ error: "name_invalid" });
    }
    const mp = Number(max_players ?? 8);
    if (!Number.isFinite(mp) || mp < 2 || mp > 64) {
      return reply.code(400).send({ error: "max_players_invalid" });
    }
    const desc = description ? String(description).slice(0, 500) : null;

    return {
      name: name.trim(),
      description: desc,
      max_players: mp,
      created_by,
      current_players: 1,
      status: "waiting",
      message: "Tournoi validé",
    };
  });

  // Rejoindre un tournoi
  app.post("/validate-tournament-join", async (req, reply) => {
    const { tournamentState, currentUserId } = (req.body as any) || {};
    if (!tournamentState || !currentUserId) return reply.code(400).send({ error: "invalid_payload" });
    if (tournamentState.status !== "waiting") return reply.code(400).send({ error: "not_joinable" });
    if (tournamentState.current_players >= tournamentState.max_players) {
      return reply.code(400).send({ error: "tournament_full" });
    }
    // (le gateway vérifiera "déjà inscrit" en DB)
    return { valid: true, message: "Inscription validée" };
  });

  // Démarrer un tournoi
  app.post("/validate-tournament-start", async (req, reply) => {
    const { tournamentState, currentUserId } = (req.body as any) || {};
    if (!tournamentState || !currentUserId) return reply.code(400).send({ error: "invalid_payload" });
    if (tournamentState.created_by !== currentUserId) return reply.code(403).send({ error: "forbidden" });
    if (tournamentState.current_players < 2) return reply.code(400).send({ error: "not_enough_players" });
    if (tournamentState.status !== "waiting") return reply.code(400).send({ error: "bad_status" });
    return { valid: true, newStatus: "started" };
  });
};

export default tournamentPlugin;
