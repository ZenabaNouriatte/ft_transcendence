import { FastifyRequest, FastifyReply } from 'fastify';
import { GameService, UserService, StatsService } from '../services.js';

// Types pour les requêtes
interface CreateGameRequest {
    player2_id?: number; // Optionnel si on veut créer une partie en attente
    tournament_id?: number;
}

interface UpdateScoreRequest {
    player1_score: number;
    player2_score: number;
}

interface JoinGameRequest {
    // Pas de body nécessaire, l'ID du joueur vient du token
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

// Routes pour les jeux
export async function gameRoutes(fastify: any) {

    // POST /api/games - Créer une nouvelle partie
    fastify.post('/api/games', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { player2_id, tournament_id } = request.body as CreateGameRequest;

            // Si pas de player2_id, créer une partie en attente
            if (!player2_id) {
                const gameId = await GameService.createGame({
                    player1_id: userId,
                    player2_id: 0, // Placeholder, sera mis à jour quand quelqu'un rejoindra
                    status: 'waiting',
                    tournament_id
                });

                return reply.status(201).send({
                    message: 'Partie créée en attente d\'un adversaire',
                    gameId,
                    status: 'waiting'
                });
            }

            // Vérifier que le joueur 2 existe
            const player2 = await UserService.findUserById(player2_id);
            if (!player2) {
                return reply.status(404).send({
                    error: 'Joueur 2 non trouvé'
                });
            }

            // Vérifier qu'on ne joue pas contre soi-même
            if (userId === player2_id) {
                return reply.status(400).send({
                    error: 'Vous ne pouvez pas jouer contre vous-même'
                });
            }

            // Créer la partie
            const gameId = await GameService.createGame({
                player1_id: userId,
                player2_id,
                status: 'playing',
                tournament_id
            });

            // Mettre à jour le statut des joueurs
            await UserService.updateUserStatus(userId, 'ingame');
            await UserService.updateUserStatus(player2_id, 'ingame');

            return reply.status(201).send({
                message: 'Partie créée avec succès',
                gameId,
                status: 'playing'
            });

        } catch (error) {
            console.error('Erreur lors de la création de la partie:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/games - Récupérer toutes les parties
    fastify.get('/api/games', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { status } = request.query as { status?: string };
            
            let games;
            if (status === 'active') {
                games = await GameService.getActiveGames();
            } else {
                // Pour toutes les parties, on fait une requête SQL directe
                games = await fastify.db.all(
                    'SELECT * FROM games ORDER BY created_at DESC'
                );
            }

            return reply.send({
                games
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des parties:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/games/:id - Récupérer une partie spécifique
    fastify.get('/api/games/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };
            const gameId = parseInt(id);

            if (isNaN(gameId)) {
                return reply.status(400).send({
                    error: 'ID de partie invalide'
                });
            }

            const game = await GameService.findGameById(gameId);
            if (!game) {
                return reply.status(404).send({
                    error: 'Partie non trouvée'
                });
            }

            // Récupérer les informations des joueurs
            const player1 = await UserService.findUserById(game.player1_id);
            const player2 = game.player2_id ? await UserService.findUserById(game.player2_id) : null;

            return reply.send({
                game: {
                    ...game,
                    player1_username: player1?.username,
                    player2_username: player2?.username
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération de la partie:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // POST /api/games/:id/join - Rejoindre une partie en attente
    fastify.post('/api/games/:id/join', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { id } = request.params as { id: string };
            const gameId = parseInt(id);

            if (isNaN(gameId)) {
                return reply.status(400).send({
                    error: 'ID de partie invalide'
                });
            }

            const game = await GameService.findGameById(gameId);
            if (!game) {
                return reply.status(404).send({
                    error: 'Partie non trouvée'
                });
            }

            if (game.status !== 'waiting') {
                return reply.status(400).send({
                    error: 'Cette partie n\'est pas en attente de joueurs'
                });
            }

            if (game.player1_id === userId) {
                return reply.status(400).send({
                    error: 'Vous ne pouvez pas rejoindre votre propre partie'
                });
            }

            // Mettre à jour la partie avec le joueur 2
            await fastify.db.run(
                'UPDATE games SET player2_id = ?, status = ? WHERE id = ?',
                [userId, 'playing', gameId]
            );

            // Mettre à jour le statut des joueurs
            await UserService.updateUserStatus(game.player1_id, 'ingame');
            await UserService.updateUserStatus(userId, 'ingame');

            return reply.send({
                message: 'Vous avez rejoint la partie avec succès',
                gameId,
                status: 'playing'
            });

        } catch (error) {
            console.error('Erreur lors de la participation à la partie:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // PUT /api/games/:id/score - Mettre à jour le score
    fastify.put('/api/games/:id/score', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { id } = request.params as { id: string };
            const gameId = parseInt(id);
            const { player1_score, player2_score } = request.body as UpdateScoreRequest;

            if (isNaN(gameId)) {
                return reply.status(400).send({
                    error: 'ID de partie invalide'
                });
            }

            const game = await GameService.findGameById(gameId);
            if (!game) {
                return reply.status(404).send({
                    error: 'Partie non trouvée'
                });
            }

            // Vérifier que l'utilisateur participe à cette partie
            if (game.player1_id !== userId && game.player2_id !== userId) {
                return reply.status(403).send({
                    error: 'Vous ne participez pas à cette partie'
                });
            }

            if (game.status !== 'playing') {
                return reply.status(400).send({
                    error: 'Cette partie n\'est pas en cours'
                });
            }

            // Validation des scores
            if (typeof player1_score !== 'number' || typeof player2_score !== 'number' ||
                player1_score < 0 || player2_score < 0) {
                return reply.status(400).send({
                    error: 'Scores invalides'
                });
            }

            // Mettre à jour le score
            await GameService.updateGameScore(gameId, player1_score, player2_score);

            return reply.send({
                message: 'Score mis à jour avec succès',
                player1_score,
                player2_score
            });

        } catch (error) {
            console.error('Erreur lors de la mise à jour du score:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // POST /api/games/:id/finish - Terminer une partie
    fastify.post('/api/games/:id/finish', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const userId = await getUserFromToken(request);
            if (!userId) {
                return reply.status(401).send({
                    error: 'Authentification requise'
                });
            }

            const { id } = request.params as { id: string };
            const gameId = parseInt(id);
            const { winner_id } = request.body as { winner_id: number };

            if (isNaN(gameId)) {
                return reply.status(400).send({
                    error: 'ID de partie invalide'
                });
            }

            const game = await GameService.findGameById(gameId);
            if (!game) {
                return reply.status(404).send({
                    error: 'Partie non trouvée'
                });
            }

            // Vérifier que l'utilisateur participe à cette partie
            if (game.player1_id !== userId && game.player2_id !== userId) {
                return reply.status(403).send({
                    error: 'Vous ne participez pas à cette partie'
                });
            }

            if (game.status !== 'playing') {
                return reply.status(400).send({
                    error: 'Cette partie n\'est pas en cours'
                });
            }

            // Vérifier que le gagnant participe à la partie
            if (winner_id !== game.player1_id && winner_id !== game.player2_id) {
                return reply.status(400).send({
                    error: 'Le gagnant doit être un des joueurs de la partie'
                });
            }

            // Terminer la partie
            await GameService.finishGame(gameId, winner_id);

            // Mettre à jour les statistiques
            await StatsService.updateStatsAfterGame(gameId);

            // Remettre les joueurs en ligne
            await UserService.updateUserStatus(game.player1_id, 'online');
            if (game.player2_id) {
                await UserService.updateUserStatus(game.player2_id, 'online');
            }

            const winner = await UserService.findUserById(winner_id);

            return reply.send({
                message: 'Partie terminée avec succès',
                winner: winner?.username,
                winner_id
            });

        } catch (error) {
            console.error('Erreur lors de la fin de partie:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/games/user/:id - Récupérer les parties d'un utilisateur
    fastify.get('/api/games/user/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };
            const playerId = parseInt(id);

            if (isNaN(playerId)) {
                return reply.status(400).send({
                    error: 'ID utilisateur invalide'
                });
            }

            const games = await GameService.getUserGames(playerId);

            return reply.send({
                games
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des parties utilisateur:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/games/waiting - Récupérer les parties en attente
    fastify.get('/api/games/waiting', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const waitingGames = await fastify.db.all(
                `SELECT g.*, u.username as player1_username 
                 FROM games g 
                 JOIN users u ON g.player1_id = u.id 
                 WHERE g.status = 'waiting' 
                 ORDER BY g.created_at`
            );

            return reply.send({
                games: waitingGames
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des parties en attente:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });
}