import { FastifyRequest, FastifyReply } from 'fastify';
import { TournamentService, UserService, GameService } from '../services.js';

// Types pour les requêtes
interface CreateTournamentRequest {
    name: string;
    description?: string;
    max_players?: number;
}

interface JoinTournamentRequest {
    // L'ID utilisateur vient du token
}

interface StartTournamentRequest {
    // Pas de body nécessaire
}

// Fonction pour décoder le token (copiée de users.ts)
function decodeToken(token: string): { userId: number; timestamp: number } | null {
    try {
        const payload = JSON.parse(Buffer.from(token, 'base64').toString());
        return payload;
    } catch {
        return null;
    }
}

// Middleware pour extraire l'utilisateur du token
async function getUserFromToken(request: FastifyRequest): Promise<number | null> {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.substring(7);
    const decoded = decodeToken(token);
    return decoded ? decoded.userId : null;
}

// Routes pour les tournois
export async function tournamentRoutes(fastify: any) {

    // POST /api/tournaments - Créer un nouveau tournoi
    fastify.post('/api/tournaments', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { name, description, max_players } = request.body as CreateTournamentRequest;

            // Validation
            if (!name || name.trim().length === 0) {
                return reply.status(400).send({
                    error: 'Le nom du tournoi est requis'
                });
            }

            if (max_players && (max_players < 2 || max_players > 32)) {
                return reply.status(400).send({
                    error: 'Le nombre maximum de joueurs doit être entre 2 et 32'
                });
            }

            // Créer le tournoi
            const tournamentId = await TournamentService.createTournament({
                name: name.trim(),
                description: description?.trim() || null,
                max_players: max_players || 8,
                created_by: userId
            });

            // Le créateur rejoint automatiquement le tournoi
            await TournamentService.joinTournament(tournamentId, userId);

            return reply.status(201).send({
                message: 'Tournoi créé avec succès',
                tournamentId
            });

        } catch (error) {
            console.error('Erreur lors de la création du tournoi:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/tournaments - Récupérer tous les tournois
    fastify.get('/api/tournaments', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { status } = request.query as { status?: string };

            let tournaments;
            if (status) {
                tournaments = await fastify.db.all(
                    `SELECT t.*, u.username as creator_username 
                     FROM tournaments t 
                     JOIN users u ON t.created_by = u.id 
                     WHERE t.status = ? 
                     ORDER BY t.created_at DESC`,
                    [status]
                );
            } else {
                tournaments = await fastify.db.all(
                    `SELECT t.*, u.username as creator_username 
                     FROM tournaments t 
                     JOIN users u ON t.created_by = u.id 
                     ORDER BY t.created_at DESC`
                );
            }

            return reply.send({
                tournaments
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des tournois:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/tournaments/:id - Récupérer un tournoi spécifique
    fastify.get('/api/tournaments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };
            const tournamentId = parseInt(id);

            if (isNaN(tournamentId)) {
                return reply.status(400).send({
                    error: 'ID de tournoi invalide'
                });
            }

            const tournament = await TournamentService.findTournamentById(tournamentId);
            if (!tournament) {
                return reply.status(404).send({
                    error: 'Tournoi non trouvé'
                });
            }

            // Récupérer les participants
            const participants = await TournamentService.getTournamentParticipants(tournamentId);

            // Récupérer le créateur
            const creator = await UserService.findUserById(tournament.created_by);

            // Récupérer les parties du tournoi
            const games = await fastify.db.all(
                `SELECT g.*, 
                        u1.username as player1_username,
                        u2.username as player2_username,
                        winner.username as winner_username
                 FROM games g
                 LEFT JOIN users u1 ON g.player1_id = u1.id
                 LEFT JOIN users u2 ON g.player2_id = u2.id
                 LEFT JOIN users winner ON g.winner_id = winner.id
                 WHERE g.tournament_id = ?
                 ORDER BY g.created_at`,
                [tournamentId]
            );

            return reply.send({
                tournament: {
                    ...tournament,
                    creator_username: creator?.username
                },
                participants,
                games
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du tournoi:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // POST /api/tournaments/:id/join - Rejoindre un tournoi
    fastify.post('/api/tournaments/:id/join', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { id } = request.params as { id: string };
            const tournamentId = parseInt(id);

            if (isNaN(tournamentId)) {
                return reply.status(400).send({
                    error: 'ID de tournoi invalide'
                });
            }

            const tournament = await TournamentService.findTournamentById(tournamentId);
            if (!tournament) {
                return reply.status(404).send({
                    error: 'Tournoi non trouvé'
                });
            }

            if (tournament.status !== 'waiting') {
                return reply.status(400).send({
                    error: 'Ce tournoi n\'accepte plus de nouveaux participants'
                });
            }

            if (tournament.current_players >= tournament.max_players) {
                return reply.status(400).send({
                    error: 'Le tournoi est complet'
                });
            }

            // Vérifier si l'utilisateur n'est pas déjà inscrit
            const existingParticipant = await fastify.db.get(
                'SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
                [tournamentId, userId]
            );

            if (existingParticipant) {
                return reply.status(400).send({
                    error: 'Vous êtes déjà inscrit à ce tournoi'
                });
            }

            // Rejoindre le tournoi
            await TournamentService.joinTournament(tournamentId, userId);

            return reply.send({
                message: 'Vous avez rejoint le tournoi avec succès'
            });

        } catch (error) {
            console.error('Erreur lors de l\'inscription au tournoi:', error);
            if (error.message === 'L\'utilisateur est déjà inscrit à ce tournoi') {
                return reply.status(400).send({
                    error: error.message
                });
            }
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // POST /api/tournaments/:id/start - Démarrer un tournoi
    fastify.post('/api/tournaments/:id/start', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { id } = request.params as { id: string };
            const tournamentId = parseInt(id);

            if (isNaN(tournamentId)) {
                return reply.status(400).send({
                    error: 'ID de tournoi invalide'
                });
            }

            const tournament = await TournamentService.findTournamentById(tournamentId);
            if (!tournament) {
                return reply.status(404).send({
                    error: 'Tournoi non trouvé'
                });
            }

            // Vérifier que l'utilisateur est le créateur
            if (tournament.created_by !== userId) {
                return reply.status(403).send({
                    error: 'Seul le créateur peut démarrer le tournoi'
                });
            }

            if (tournament.status !== 'waiting') {
                return reply.status(400).send({
                    error: 'Ce tournoi a déjà été démarré'
                });
            }

            if (tournament.current_players < 2) {
                return reply.status(400).send({
                    error: 'Il faut au moins 2 participants pour démarrer le tournoi'
                });
            }

            // Démarrer le tournoi
            await TournamentService.startTournament(tournamentId);

            // Récupérer les participants pour créer les premières parties
            const participants = await TournamentService.getTournamentParticipants(tournamentId);

            // Créer les parties du premier tour (simple pour l'exemple)
            const games = [];
            for (let i = 0; i < participants.length - 1; i += 2) {
                if (participants[i + 1]) {
                    const gameId = await GameService.createGame({
                        player1_id: participants[i].id!,
                        player2_id: participants[i + 1].id!,
                        tournament_id: tournamentId,
                        status: 'waiting'
                    });
                    games.push(gameId);
                }
            }

            return reply.send({
                message: 'Tournoi démarré avec succès',
                gamesCreated: games.length
            });

        } catch (error) {
            console.error('Erreur lors du démarrage du tournoi:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/tournaments/:id/participants - Récupérer les participants d'un tournoi
    fastify.get('/api/tournaments/:id/participants', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };
            const tournamentId = parseInt(id);

            if (isNaN(tournamentId)) {
                return reply.status(400).send({
                    error: 'ID de tournoi invalide'
                });
            }

            const participants = await TournamentService.getTournamentParticipants(tournamentId);

            return reply.send({
                participants
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des participants:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/tournaments/:id/games - Récupérer les parties d'un tournoi
    fastify.get('/api/tournaments/:id/games', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };
            const tournamentId = parseInt(id);

            if (isNaN(tournamentId)) {
                return reply.status(400).send({
                    error: 'ID de tournoi invalide'
                });
            }

            const games = await fastify.db.all(
                `SELECT g.*, 
                        u1.username as player1_username,
                        u2.username as player2_username,
                        winner.username as winner_username
                 FROM games g
                 LEFT JOIN users u1 ON g.player1_id = u1.id
                 LEFT JOIN users u2 ON g.player2_id = u2.id
                 LEFT JOIN users winner ON g.winner_id = winner.id
                 WHERE g.tournament_id = ?
                 ORDER BY g.created_at`,
                [tournamentId]
            );

            return reply.send({
                games
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des parties du tournoi:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // DELETE /api/tournaments/:id - Supprimer un tournoi (créateur seulement)
    fastify.delete('/api/tournaments/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { id } = request.params as { id: string };
            const tournamentId = parseInt(id);

            if (isNaN(tournamentId)) {
                return reply.status(400).send({
                    error: 'ID de tournoi invalide'
                });
            }

            const tournament = await TournamentService.findTournamentById(tournamentId);
            if (!tournament) {
                return reply.status(404).send({
                    error: 'Tournoi non trouvé'
                });
            }

            // Vérifier que l'utilisateur est le créateur
            if (tournament.created_by !== userId) {
                return reply.status(403).send({
                    error: 'Seul le créateur peut supprimer le tournoi'
                });
            }

            if (tournament.status === 'started') {
                return reply.status(400).send({
                    error: 'Impossible de supprimer un tournoi déjà commencé'
                });
            }

            // Supprimer le tournoi (les participants seront supprimés automatiquement via CASCADE)
            await fastify.db.run('DELETE FROM tournaments WHERE id = ?', [tournamentId]);

            return reply.send({
                message: 'Tournoi supprimé avec succès'
            });

        } catch (error) {
            console.error('Erreur lors de la suppression du tournoi:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // POST /api/tournaments/:id/leave - Quitter un tournoi
    fastify.post('/api/tournaments/:id/leave', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { id } = request.params as { id: string };
            const tournamentId = parseInt(id);

            if (isNaN(tournamentId)) {
                return reply.status(400).send({
                    error: 'ID de tournoi invalide'
                });
            }

            const tournament = await TournamentService.findTournamentById(tournamentId);
            if (!tournament) {
                return reply.status(404).send({
                    error: 'Tournoi non trouvé'
                });
            }

            if (tournament.status !== 'waiting') {
                return reply.status(400).send({
                    error: 'Impossible de quitter un tournoi déjà commencé'
                });
            }

            // Vérifier que l'utilisateur participe au tournoi
            const participation = await fastify.db.get(
                'SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
                [tournamentId, userId]
            );

            if (!participation) {
                return reply.status(400).send({
                    error: 'Vous ne participez pas à ce tournoi'
                });
            }

            // Retirer l'utilisateur du tournoi
            await fastify.db.run(
                'DELETE FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
                [tournamentId, userId]
            );

            // Mettre à jour le nombre de participants
            await fastify.db.run(
                'UPDATE tournaments SET current_players = current_players - 1 WHERE id = ?',
                [tournamentId]
            );

            return reply.send({
                message: 'Vous avez quitté le tournoi avec succès'
            });

        } catch (error) {
            console.error('Erreur lors de la sortie du tournoi:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });
}
