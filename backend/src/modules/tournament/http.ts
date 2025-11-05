// backend/src/modules/tournament/http.ts
// Microservice de logique métier des tournois - Architecture pure
import type { FastifyPluginAsync } from "fastify";

// Regex pour validation des noms
const NAME_REGEX = /^[a-zA-Z0-9 _-]{1,20}$/;

// Types pour la clarté
interface TournamentPlayer {
  player1: string;
  player2: string;
  winner?: string;
  loser?: string;
  scores?: { winner: number; loser: number };
}

interface TournamentBracket {
  semifinals: [TournamentPlayer, TournamentPlayer];
  final: TournamentPlayer | null;
  winner: string | null;
}

interface Tournament {
  id: string;
  players: string[];
  bracket: TournamentBracket;
  currentMatch: string;
  createdAt: string;
  finishedAt?: string;
}

const tournamentPlugin: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "tournament" }));

  // 1. VALIDATION DE CRÉATION DE TOURNOI LOCAL (4 joueurs)
  app.post("/validate-tournament", async (req, reply) => {
    try {
      const { players, reservedUsernames } = req.body as { 
        players: string[]; 
        reservedUsernames?: string[];
      };

      // Vérifier que c'est un tableau
      if (!Array.isArray(players)) {
        return reply.code(400).send({ error: "players_must_be_array" });
      }

      // Vérifier qu'il y a exactement 4 joueurs
      if (players.length !== 4) {
        return reply.code(400).send({ error: "exactly_4_players_required" });
      }

      // Valider le format de chaque nom
      const invalidNames = players.filter(name => !NAME_REGEX.test(name));
      if (invalidNames.length > 0) {
        return reply.code(400).send({ 
          error: "invalid_player_names",
          invalidNames 
        });
      }

      // Vérifier l'unicité (case-insensitive)
      const uniqueNames = new Set(players.map(n => n.toLowerCase()));
      if (uniqueNames.size !== players.length) {
        return reply.code(400).send({ error: "duplicate_player_names" });
      }

      // Vérifier que les pseudos ne sont pas réservés (sauf celui de l'utilisateur connecté)
      if (reservedUsernames && Array.isArray(reservedUsernames)) {
        const reservedSet = new Set(reservedUsernames.map(u => u.toLowerCase()));
        const conflicts = players.filter(p => reservedSet.has(p.toLowerCase()));
        
        if (conflicts.length > 0) {
          return reply.code(400).send({ 
            error: "username_reserved",
            conflictingNames: conflicts,
            message: `The following usernames are reserved: ${conflicts.join(', ')}`
          });
        }
      }

      return reply.send({ 
        valid: true,
        players: players, // Retourne les noms validés
        message: "Tournament validation successful"
      });

    } catch (error) {
      app.log.error(error, "Tournament validation error");
      return reply.code(500).send({ error: "validation_failed" });
    }
  });

  // 2. GÉNÉRATION DES BRACKETS (ALGORITHME DE TOURNOI)
  app.post("/generate-brackets", async (req, reply) => {
    try {
      const { players } = req.body as { players: string[] };

      if (!Array.isArray(players) || players.length !== 4) {
        return reply.code(400).send({ error: "exactly_4_players_required" });
      }

      // Algorithme: mélanger les joueurs aléatoirement pour équité
      const shuffledPlayers = [...players].sort(() => Math.random() - 0.5);

      // Créer les brackets
      const semifinal1: TournamentPlayer = { 
        player1: shuffledPlayers[0], 
        player2: shuffledPlayers[1] 
      };
      const semifinal2: TournamentPlayer = { 
        player1: shuffledPlayers[2], 
        player2: shuffledPlayers[3] 
      };

      const bracket: TournamentBracket = {
        semifinals: [semifinal1, semifinal2],
        final: null,
        winner: null
      };

      return reply.send({
        bracket,
        shuffledPlayers,
        firstMatch: {
          type: "semifinal",
          number: 1,
          players: [semifinal1.player1, semifinal1.player2]
        }
      });

    } catch (error) {
      app.log.error(error, "Bracket generation error");
      return reply.code(500).send({ error: "bracket_generation_failed" });
    }
  });

  // 3. TRAITEMENT D'UN RÉSULTAT DE MATCH (PROGRESSION STATE MACHINE)
  app.post("/process-match-result", async (req, reply) => {
    try {
      const { 
        tournament, 
        winner, 
        loser, 
        scores 
      } = req.body as {
        tournament: Tournament;
        winner: string;
        loser: string;
        scores: { winner: number; loser: number };
      };

      if (!tournament || !winner || !loser || !scores) {
        return reply.code(400).send({ error: "missing_required_fields" });
      }

      // Valider les noms
      if (!NAME_REGEX.test(winner) || !NAME_REGEX.test(loser)) {
        return reply.code(400).send({ error: "invalid_names" });
      }

      // Valider que les noms sont dans le tournoi
      if (!tournament.players.includes(winner) || !tournament.players.includes(loser)) {
        return reply.code(400).send({ error: "names_not_in_tournament" });
      }

      // Valider winner != loser
      if (winner.toLowerCase() === loser.toLowerCase()) {
        return reply.code(400).send({ error: "winner_equals_loser" });
      }

      // Coercer les scores (0-99)
      const sanitizedScores = {
        winner: Math.max(0, Math.min(99, Number(scores.winner) | 0)),
        loser: Math.max(0, Math.min(99, Number(scores.loser) | 0))
      };

      // === STATE MACHINE DE PROGRESSION ===
      let nextMatch: any = null;
      let newCurrentMatch = tournament.currentMatch;
      let tournamentFinished = false;
      let tournamentWinner: string | null = null;

      if (tournament.currentMatch === "semifinal1") {
        // Vérifier que les noms correspondent à la demi-finale 1
        const sf1 = tournament.bracket.semifinals[0];
        const expected = new Set([sf1.player1, sf1.player2]);
        if (!expected.has(winner) || !expected.has(loser)) {
          return reply.code(400).send({ error: "names_do_not_match_semifinal1" });
        }

        // Enregistrer le résultat
        sf1.winner = winner;
        sf1.loser = loser;
        sf1.scores = sanitizedScores;

        // Passer à la demi-finale 2
        newCurrentMatch = "semifinal2";
        nextMatch = {
          type: "semifinal",
          number: 2,
          players: [tournament.bracket.semifinals[1].player1, tournament.bracket.semifinals[1].player2]
        };

      } else if (tournament.currentMatch === "semifinal2") {
        // Vérifier que les noms correspondent à la demi-finale 2
        const sf2 = tournament.bracket.semifinals[1];
        const expected = new Set([sf2.player1, sf2.player2]);
        if (!expected.has(winner) || !expected.has(loser)) {
          return reply.code(400).send({ error: "names_do_not_match_semifinal2" });
        }

        // Enregistrer le résultat
        sf2.winner = winner;
        sf2.loser = loser;
        sf2.scores = sanitizedScores;

        // Créer la finale avec les deux gagnants
        const finalist1 = tournament.bracket.semifinals[0].winner!;
        const finalist2 = tournament.bracket.semifinals[1].winner!;

        tournament.bracket.final = { player1: finalist1, player2: finalist2 };
        newCurrentMatch = "final";
        nextMatch = {
          type: "final",
          number: 1,
          players: [finalist1, finalist2]
        };

      } else if (tournament.currentMatch === "final") {
        const final = tournament.bracket.final;
        if (!final) {
          return reply.code(400).send({ error: "final_not_ready" });
        }

        // Vérifier que les noms correspondent à la finale
        const expected = new Set([final.player1, final.player2]);
        if (!expected.has(winner) || !expected.has(loser)) {
          return reply.code(400).send({ error: "names_do_not_match_final" });
        }

        // Enregistrer le résultat
        final.winner = winner;
        final.loser = loser;
        final.scores = sanitizedScores;

        // Marquer le tournoi comme terminé
        tournament.bracket.winner = winner;
        newCurrentMatch = "finished";
        tournamentFinished = true;
        tournamentWinner = winner;
        nextMatch = { type: "finished", winner };

      } else {
        return reply.code(400).send({ error: "tournament_already_finished_or_invalid_state" });
      }

      // Retourner l'état mis à jour
      return reply.send({
        success: true,
        currentMatch: newCurrentMatch,
        nextMatch,
        bracket: tournament.bracket,
        finished: tournamentFinished,
        winner: tournamentWinner,
        message: tournamentFinished 
          ? `Tournament finished! Winner: ${tournamentWinner}` 
          : `Match processed. Next: ${nextMatch.type}`
      });

    } catch (error) {
      app.log.error(error, "Match result processing error");
      return reply.code(500).send({ error: "match_processing_failed" });
    }
  });
};

export default tournamentPlugin;
