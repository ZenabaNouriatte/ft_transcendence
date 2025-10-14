// backend/src/modules/game/http.ts
import type { FastifyPluginAsync } from "fastify";
import { gameRoomManager } from "./engine/roomManagerSingleton.js";


const gamePlugin: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "game" }));

  // 1) Validation création de partie
  app.post("/validate-game-creation", async (req, reply) => {
    const { player2_id, tournament_id, currentUserId } = (req.body as any) || {};

    if (!currentUserId) return reply.code(401).send({ error: "no_user" });

    if (player2_id && currentUserId === player2_id) {
      return reply.code(400).send({ error: "Vous ne pouvez pas jouer contre vous-même" });
    }

    if (!player2_id) {
      return {
        player1_id: currentUserId,
        player2_id: null,
        status: "waiting",
        tournament_id: tournament_id || null,
        message: "Partie créée en attente d'un adversaire",
        updatePlayerStatus: false,
      };
    } else {
      return {
        player1_id: currentUserId,
        player2_id: Number(player2_id),
        status: "playing",
        tournament_id: tournament_id || null,
        message: "Partie créée avec succès",
        updatePlayerStatus: true,
      };
    }
  });

  // 2) Validation rejoindre une partie
  app.post("/validate-game-join", async (req, reply) => {
    const { gameState, currentUserId } = (req.body as any) || {};

    if (!gameState || !currentUserId) return reply.code(400).send({ error: "invalid_payload" });
    if (gameState.status !== "waiting") return reply.code(400).send({ error: "Cette partie n'est pas en attente de joueurs" });
    if (gameState.player1_id === currentUserId) return reply.code(400).send({ error: "Vous ne pouvez pas rejoindre votre propre partie" });

    return { valid: true, message: "Vous avez rejoint la partie avec succès", newStatus: "playing" };
  });

  // 3) Validation MAJ score
  app.post("/validate-score-update", async (req, reply) => {
    const { gameState, player1_score, player2_score, currentUserId } = (req.body as any) || {};

    if (!gameState || !currentUserId) return reply.code(400).send({ error: "invalid_payload" });
    if (gameState.player1_id !== currentUserId && gameState.player2_id !== currentUserId) {
      return reply.code(403).send({ error: "Vous ne participez pas à cette partie" });
    }
    if (gameState.status !== "playing") return reply.code(400).send({ error: "Cette partie n'est pas en cours" });

    if (
      typeof player1_score !== "number" || typeof player2_score !== "number" ||
      player1_score < 0 || player2_score < 0
    ) {
      return reply.code(400).send({ error: "Scores invalides" });
    }

    return { valid: true, player1_score, player2_score, message: "Score mis à jour avec succès" };
  });

  // 4) Validation fin de partie
  app.post("/validate-game-finish", async (req, reply) => {
    const { gameState, winner_id, currentUserId } = (req.body as any) || {};

    if (!gameState || !currentUserId) return reply.code(400).send({ error: "invalid_payload" });
    if (gameState.player1_id !== currentUserId && gameState.player2_id !== currentUserId) {
      return reply.code(403).send({ error: "Vous ne participez pas à cette partie" });
    }
    if (gameState.status !== "playing") return reply.code(400).send({ error: "Cette partie n'est pas en cours" });
    if (winner_id !== gameState.player1_id && winner_id !== gameState.player2_id) {
      return reply.code(400).send({ error: "Le gagnant doit être un des joueurs de la partie" });
    }

    return { valid: true, winner_id, message: "Partie terminée avec succès" };
  });

  // 5) Pause d'une partie
  app.post("/games/:gameId/pause", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    
    console.log(`[Backend API] Pause request for game ${gameId}`);
    
    const room = gameRoomManager.getRoom(gameId);
    if (!room) {
      console.log(`[Backend API] Game ${gameId} not found`);
      return reply.code(404).send({ error: "Game not found" });
    }

    const success = room.pauseGame();
    if (success) {
      console.log(`[Backend API] Game ${gameId} paused successfully`);
      return { success: true, message: "Game paused" };
    } else {
      console.log(`[Backend API] Failed to pause game ${gameId}`);
      return reply.code(400).send({ error: "Cannot pause game" });
    }
  });

  // 6) Reprise d'une partie
  app.post("/games/:gameId/resume", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    
    console.log(`[Backend API] Resume request for game ${gameId}`);
    
    const room = gameRoomManager.getRoom(gameId);
    if (!room) {
      console.log(`[Backend API] Game ${gameId} not found`);
      return reply.code(404).send({ error: "Game not found" });
    }

    const success = room.resumeGame();
    if (success) {
      console.log(`[Backend API] Game ${gameId} resumed successfully`);
      return { success: true, message: "Game resumed" };
    } else {
      console.log(`[Backend API] Failed to resume game ${gameId}`);
      return reply.code(400).send({ error: "Cannot resume game" });
    }
  });

  // 7) État d'une partie (pour debug)
  app.get("/games/:gameId/state", async (req, reply) => {
    const { gameId } = req.params as { gameId: string };
    
    const room = gameRoomManager.getRoom(gameId);
    if (!room) {
      return reply.code(404).send({ error: "Game not found" });
    }

    return {
      gameId,
      status: room.getStatus(),
      playerCount: room.getPlayerCount(),
      gameState: room.getGameState()
    };
  });
};

// Exporter l'instance du manager pour utilisation ailleurs
export { gameRoomManager };
export default gamePlugin;
