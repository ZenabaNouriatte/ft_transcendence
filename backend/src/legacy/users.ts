import { FastifyRequest, FastifyReply } from 'fastify';
import { UserService, StatsService } from '../services.js';
import crypto from 'crypto';

// Fonction simple pour hasher les mots de passe (remplacez par bcrypt en production)
function hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Fonction simple pour vérifier les mots de passe
function verifyPassword(password: string, hashedPassword: string): boolean {
    return hashPassword(password) === hashedPassword;
}

// Fonction simple pour générer un token (remplacez par JWT en production)
function generateToken(userId: number): string {
    const payload = { userId, timestamp: Date.now() };
    return Buffer.from(JSON.stringify(payload)).toString('base64');
}

// Fonction pour décoder le token
function decodeToken(token: string): { userId: number; timestamp: number } | null {
    try {
        const payload = JSON.parse(Buffer.from(token, 'base64').toString());
        return payload;
    } catch {
        return null;
    }
}

// Types pour les requêtes
interface RegisterRequest {
    username: string;
    email: string;
    password: string;
    avatar?: string;
}

interface LoginRequest {
    username: string;
    password: string;
}

// Routes utilisateurs
export async function userRoutes(fastify: any) {
    
    // POST /api/users/register - Inscription
    fastify.post('/api/users/register', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { username, email, password, avatar } = request.body as RegisterRequest;

            // Validation basique
            if (!username || !email || !password) {
                return reply.status(400).send({
                    error: 'Username, email et password sont requis'
                });
            }

            if (username.length < 3) {
                return reply.status(400).send({
                    error: 'Le username doit faire au moins 3 caractères'
                });
            }

            // Vérifier si l'utilisateur existe déjà
            const existingUser = await UserService.findUserByUsername(username);
            if (existingUser) {
                return reply.status(409).send({
                    error: 'Ce username est déjà pris'
                });
            }

            const existingEmail = await UserService.findUserByEmail(email);
            if (existingEmail) {
                return reply.status(409).send({
                    error: 'Cet email est déjà utilisé'
                });
            }

            // Créer l'utilisateur
            const hashedPassword = hashPassword(password);
            const userId = await UserService.createUser({
                username,
                email,
                password: hashedPassword,
                avatar: avatar || null
            });

            // Initialiser les statistiques
            await StatsService.initUserStats(userId);

            // Générer un token
            const token = generateToken(userId);

            // Récupérer l'utilisateur créé (sans le mot de passe)
            const user = await UserService.findUserById(userId);
            const { password: _, ...userWithoutPassword } = user!;

            return reply.status(201).send({
                message: 'Utilisateur créé avec succès',
                user: userWithoutPassword,
                token
            });

        } catch (error) {
            console.error('Erreur lors de l\'inscription:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // POST /api/users/login - Connexion
    fastify.post('/api/users/login', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { username, password } = request.body as LoginRequest;

            // Validation
            if (!username || !password) {
                return reply.status(400).send({
                    error: 'Username et password sont requis'
                });
            }

            // Trouver l'utilisateur
            const user = await UserService.findUserByUsername(username);
            if (!user) {
                return reply.status(401).send({
                    error: 'Identifiants invalides'
                });
            }

            // Vérifier le mot de passe
            if (!verifyPassword(password, user.password)) {
                return reply.status(401).send({
                    error: 'Identifiants invalides'
                });
            }

            // Mettre à jour le statut à "online"
            await UserService.updateUserStatus(user.id!, 'online');

            // Générer un token
            const token = generateToken(user.id!);

            // Retourner les données utilisateur (sans le mot de passe)
            const { password: _, ...userWithoutPassword } = user;

            return reply.send({
                message: 'Connexion réussie',
                user: userWithoutPassword,
                token
            });

        } catch (error) {
            console.error('Erreur lors de la connexion:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/users/profile - Profil utilisateur (nécessite authentification)
    fastify.get('/api/users/profile', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            // Récupérer le token de l'en-tête Authorization
            const authHeader = request.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return reply.status(401).send({
                    error: 'Token d\'authentification requis'
                });
            }

            const token = authHeader.substring(7); // Retirer "Bearer "
            const decoded = decodeToken(token);
            
            if (!decoded) {
                return reply.status(401).send({
                    error: 'Token invalide'
                });
            }

            // Récupérer l'utilisateur
            const user = await UserService.findUserById(decoded.userId);
            if (!user) {
                return reply.status(404).send({
                    error: 'Utilisateur non trouvé'
                });
            }

            // Récupérer les statistiques
            const stats = await StatsService.getUserStats(decoded.userId);

            // Retourner les données (sans le mot de passe)
            const { password: _, ...userWithoutPassword } = user;

            return reply.send({
                user: userWithoutPassword,
                stats: stats || {
                    games_played: 0,
                    games_won: 0,
                    games_lost: 0,
                    tournaments_played: 0,
                    tournaments_won: 0
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du profil:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/users - Liste des utilisateurs
    fastify.get('/api/users', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const users = await UserService.getAllUsers();
            
            // Retirer les mots de passe
            const usersWithoutPasswords = users.map(user => {
                const { password: _, ...userWithoutPassword } = user;
                return userWithoutPassword;
            });

            return reply.send({
                users: usersWithoutPasswords
            });

        } catch (error) {
            console.error('Erreur lors de la récupération des utilisateurs:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/users/:id - Profil d'un utilisateur spécifique
    fastify.get('/api/users/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { id } = request.params as { id: string };
            const userId = parseInt(id);

            if (isNaN(userId)) {
                return reply.status(400).send({
                    error: 'ID utilisateur invalide'
                });
            }

            const user = await UserService.findUserById(userId);
            if (!user) {
                return reply.status(404).send({
                    error: 'Utilisateur non trouvé'
                });
            }

            const stats = await StatsService.getUserStats(userId);

            // Retourner les données (sans le mot de passe)
            const { password: _, ...userWithoutPassword } = user;

            return reply.send({
                user: userWithoutPassword,
                stats: stats || {
                    games_played: 0,
                    games_won: 0,
                    games_lost: 0,
                    tournaments_played: 0,
                    tournaments_won: 0
                }
            });

        } catch (error) {
            console.error('Erreur lors de la récupération de l\'utilisateur:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // POST /api/users/logout - Déconnexion
    fastify.post('/api/users/logout', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            // Récupérer le token
            const authHeader = request.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.substring(7);
                const decoded = decodeToken(token);
                
                if (decoded) {
                    // Mettre à jour le statut à "offline"
                    await UserService.updateUserStatus(decoded.userId, 'offline');
                }
            }

            return reply.send({
                message: 'Déconnexion réussie'
            });

        } catch (error) {
            console.error('Erreur lors de la déconnexion:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });

    // GET /api/users/leaderboard - Classement des joueurs
    fastify.get('/api/users/leaderboard', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const { limit } = request.query as { limit?: string };
            const limitNumber = limit ? parseInt(limit) : 10;

            const leaderboard = await StatsService.getLeaderboard(limitNumber);

            return reply.send({
                leaderboard
            });

        } catch (error) {
            console.error('Erreur lors de la récupération du classement:', error);
            return reply.status(500).send({
                error: 'Erreur interne du serveur'
            });
        }
    });
}

// Middleware pour vérifier l'authentification
export function authenticateToken(request: FastifyRequest, reply: FastifyReply, done: any) {
    const authHeader = request.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.status(401).send({
            error: 'Token d\'authentification requis'
        });
    }

    const token = authHeader.substring(7);
    const decoded = decodeToken(token);
    
    if (!decoded) {
        return reply.status(401).send({
            error: 'Token invalide'
        });
    }

    // Ajouter l'ID utilisateur à la requête
    (request as any).userId = decoded.userId;
    done();
}
