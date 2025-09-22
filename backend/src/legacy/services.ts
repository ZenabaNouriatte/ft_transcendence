import { db } from './db.js';

// Types pour nos entités
export interface User {
    id?: number;
    username: string;
    email: string;
    password: string;
    avatar?: string;
    status?: 'online' | 'offline' | 'ingame';
    created_at?: string;
    updated_at?: string;
}

export interface Game {
    id?: number;
    player1_id: number;
    player2_id: number;
    player1_score?: number;
    player2_score?: number;
    status?: 'waiting' | 'playing' | 'finished' | 'cancelled';
    winner_id?: number;
    tournament_id?: number;
    created_at?: string;
    finished_at?: string;
}

export interface Tournament {
    id?: number;
    name: string;
    description?: string;
    max_players?: number;
    current_players?: number;
    status?: 'waiting' | 'started' | 'finished';
    created_by: number;
    winner_id?: number;
    created_at?: string;
    started_at?: string;
    finished_at?: string;
}

export interface ChatMessage {
    id?: number;
    sender_id: number;
    receiver_id?: number;
    tournament_id?: number;
    message: string;
    type?: 'private' | 'tournament' | 'global';
    created_at?: string;
}

// ============== FONCTIONS UTILISATEURS ==============

export class UserService {
    // Créer un nouvel utilisateur
    static async createUser(user: User): Promise<number> {
        const sql = `
            INSERT INTO users (username, email, password, avatar, status)
            VALUES (?, ?, ?, ?, ?)
        `;
        const result = await db.run(sql, [
            user.username,
            user.email,
            user.password,
            user.avatar || null,
            user.status || 'offline'
        ]);
        return result.lastID!;
    }

    // Trouver un utilisateur par ID
    static async findUserById(id: number): Promise<User | null> {
        const sql = 'SELECT * FROM users WHERE id = ?';
        return await db.get(sql, [id]);
    }

    // Trouver un utilisateur par username
    static async findUserByUsername(username: string): Promise<User | null> {
        const sql = 'SELECT * FROM users WHERE username = ?';
        return await db.get(sql, [username]);
    }

    // Trouver un utilisateur par email
    static async findUserByEmail(email: string): Promise<User | null> {
        const sql = 'SELECT * FROM users WHERE email = ?';
        return await db.get(sql, [email]);
    }

    // Mettre à jour le statut d'un utilisateur
    static async updateUserStatus(id: number, status: 'online' | 'offline' | 'ingame'): Promise<void> {
        const sql = 'UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
        await db.run(sql, [status, id]);
    }

    // Récupérer tous les utilisateurs
    static async getAllUsers(): Promise<User[]> {
        const sql = 'SELECT * FROM users ORDER BY username';
        return await db.all(sql);
    }

    // Supprimer un utilisateur
    static async deleteUser(id: number): Promise<void> {
        const sql = 'DELETE FROM users WHERE id = ?';
        await db.run(sql, [id]);
    }
}

// ============== FONCTIONS JEUX ==============

export class GameService {
    // Créer un nouveau jeu
    static async createGame(game: Game): Promise<number> {
        const sql = `
            INSERT INTO games (player1_id, player2_id, player1_score, player2_score, status, tournament_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const result = await db.run(sql, [
            game.player1_id,
            game.player2_id,
            game.player1_score || 0,
            game.player2_score || 0,
            game.status || 'waiting',
            game.tournament_id || null
        ]);
        return result.lastID!;
    }

    // Trouver un jeu par ID
    static async findGameById(id: number): Promise<Game | null> {
        const sql = 'SELECT * FROM games WHERE id = ?';
        return await db.get(sql, [id]);
    }

    // Mettre à jour le score d'un jeu
    static async updateGameScore(id: number, player1_score: number, player2_score: number): Promise<void> {
        const sql = 'UPDATE games SET player1_score = ?, player2_score = ? WHERE id = ?';
        await db.run(sql, [player1_score, player2_score, id]);
    }

    // Terminer un jeu
    static async finishGame(id: number, winner_id: number): Promise<void> {
        const sql = `
            UPDATE games 
            SET status = 'finished', winner_id = ?, finished_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;
        await db.run(sql, [winner_id, id]);
    }

    // Récupérer les jeux d'un utilisateur
    static async getUserGames(userId: number): Promise<Game[]> {
        const sql = `
            SELECT * FROM games 
            WHERE player1_id = ? OR player2_id = ? 
            ORDER BY created_at DESC
        `;
        return await db.all(sql, [userId, userId]);
    }

    // Récupérer les jeux en cours
    static async getActiveGames(): Promise<Game[]> {
        const sql = "SELECT * FROM games WHERE status IN ('waiting', 'playing') ORDER BY created_at";
        return await db.all(sql);
    }
}

// ============== FONCTIONS TOURNOIS ==============

export class TournamentService {
    // Créer un nouveau tournoi
    static async createTournament(tournament: Tournament): Promise<number> {
        const sql = `
            INSERT INTO tournaments (name, description, max_players, created_by)
            VALUES (?, ?, ?, ?)
        `;
        const result = await db.run(sql, [
            tournament.name,
            tournament.description || null,
            tournament.max_players || 8,
            tournament.created_by
        ]);
        return result.lastID!;
    }

    // Trouver un tournoi par ID
    static async findTournamentById(id: number): Promise<Tournament | null> {
        const sql = 'SELECT * FROM tournaments WHERE id = ?';
        return await db.get(sql, [id]);
    }

    // Rejoindre un tournoi
    static async joinTournament(tournamentId: number, userId: number): Promise<void> {
        // Vérifier si l'utilisateur n'est pas déjà inscrit
        const existingParticipant = await db.get(
            'SELECT id FROM tournament_participants WHERE tournament_id = ? AND user_id = ?',
            [tournamentId, userId]
        );

        if (existingParticipant) {
            throw new Error('L\'utilisateur est déjà inscrit à ce tournoi');
        }

        // Ajouter le participant
        await db.run(
            'INSERT INTO tournament_participants (tournament_id, user_id) VALUES (?, ?)',
            [tournamentId, userId]
        );

        // Mettre à jour le nombre de participants
        await db.run(
            'UPDATE tournaments SET current_players = current_players + 1 WHERE id = ?',
            [tournamentId]
        );
    }

    // Récupérer les participants d'un tournoi
    static async getTournamentParticipants(tournamentId: number): Promise<User[]> {
        const sql = `
            SELECT u.* FROM users u
            JOIN tournament_participants tp ON u.id = tp.user_id
            WHERE tp.tournament_id = ?
            ORDER BY tp.joined_at
        `;
        return await db.all(sql, [tournamentId]);
    }

    // Récupérer tous les tournois
    static async getAllTournaments(): Promise<Tournament[]> {
        const sql = 'SELECT * FROM tournaments ORDER BY created_at DESC';
        return await db.all(sql);
    }

    // Démarrer un tournoi
    static async startTournament(id: number): Promise<void> {
        const sql = `
            UPDATE tournaments 
            SET status = 'started', started_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `;
        await db.run(sql, [id]);
    }
}

// ============== FONCTIONS CHAT ==============

export class ChatService {
    // Envoyer un message
    static async sendMessage(message: ChatMessage): Promise<number> {
        const sql = `
            INSERT INTO chat_messages (sender_id, receiver_id, tournament_id, message, type)
            VALUES (?, ?, ?, ?, ?)
        `;
        const result = await db.run(sql, [
            message.sender_id,
            message.receiver_id || null,
            message.tournament_id || null,
            message.message,
            message.type || 'private'
        ]);
        return result.lastID!;
    }

    // Récupérer les messages privés entre deux utilisateurs
    static async getPrivateMessages(user1Id: number, user2Id: number, limit: number = 50): Promise<ChatMessage[]> {
        const sql = `
            SELECT * FROM chat_messages 
            WHERE type = 'private' 
            AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
            ORDER BY created_at DESC 
            LIMIT ?
        `;
        return await db.all(sql, [user1Id, user2Id, user2Id, user1Id, limit]);
    }

    // Récupérer les messages d'un tournoi
    static async getTournamentMessages(tournamentId: number, limit: number = 50): Promise<ChatMessage[]> {
        const sql = `
            SELECT cm.*, u.username as sender_username
            FROM chat_messages cm
            JOIN users u ON cm.sender_id = u.id
            WHERE cm.type = 'tournament' AND cm.tournament_id = ?
            ORDER BY cm.created_at DESC 
            LIMIT ?
        `;
        return await db.all(sql, [tournamentId, limit]);
    }

    // Récupérer les messages globaux
    static async getGlobalMessages(limit: number = 50): Promise<ChatMessage[]> {
        const sql = `
            SELECT cm.*, u.username as sender_username
            FROM chat_messages cm
            JOIN users u ON cm.sender_id = u.id
            WHERE cm.type = 'global'
            ORDER BY cm.created_at DESC 
            LIMIT ?
        `;
        return await db.all(sql, [limit]);
    }
}

// ============== FONCTIONS STATISTIQUES ==============

export class StatsService {
    // Initialiser les statistiques d'un utilisateur
    static async initUserStats(userId: number): Promise<void> {
        const sql = `
            INSERT OR IGNORE INTO user_stats (user_id)
            VALUES (?)
        `;
        await db.run(sql, [userId]);
    }

    // Mettre à jour les statistiques après un jeu
    static async updateStatsAfterGame(gameId: number): Promise<void> {
        const game = await GameService.findGameById(gameId);
        if (!game || game.status !== 'finished' || !game.winner_id) return;

        const loserId = game.winner_id === game.player1_id ? game.player2_id : game.player1_id;

        // Mettre à jour les stats du gagnant
        await db.run(`
            UPDATE user_stats 
            SET games_played = games_played + 1,
                games_won = games_won + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `, [game.winner_id]);

        // Mettre à jour les stats du perdant
        await db.run(`
            UPDATE user_stats 
            SET games_played = games_played + 1,
                games_lost = games_lost + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `, [loserId]);
    }

    // Récupérer les statistiques d'un utilisateur
    static async getUserStats(userId: number): Promise<any> {
        const sql = 'SELECT * FROM user_stats WHERE user_id = ?';
        return await db.get(sql, [userId]);
    }

    // Récupérer le classement des joueurs
    static async getLeaderboard(limit: number = 10): Promise<any[]> {
        const sql = `
            SELECT u.username, us.* 
            FROM user_stats us
            JOIN users u ON us.user_id = u.id
            ORDER BY us.games_won DESC, us.games_played ASC
            LIMIT ?
        `;
        return await db.all(sql, [limit]);
    }
}