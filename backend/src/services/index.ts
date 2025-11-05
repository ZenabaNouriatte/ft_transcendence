// backend/src/services/index.ts (merged)

import { run, get, all } from "../database/index.js";

export interface User {
  id?: number;
  username: string;
  email: string;
  password: string;
  avatar?: string;
  status?: 'online' | 'offline';
  created_at?: string;
  updated_at?: string;
}

export interface Game {
  id?: number;
  player1_id: number;
  player2_id: number | null;
  player1_type?: 'user' | 'local';
  player2_type?: 'user' | 'local';
  player1_score?: number;
  player2_score?: number;
  status?: 'waiting' | 'playing' | 'finished' | 'cancelled';
  winner_id?: number;
  winner_type?: 'user' | 'local';
  tournament_id?: number | null;
  duration?: number;
  created_at?: string;
  finished_at?: string;
}

export interface Tournament {
  id?: number;
  name: string;
  description?: string | null;
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

// ============== USERS SERVICE ==============
export class UserService {
  static async createUser(user: User): Promise<number> {
    await run(
      `INSERT INTO users (username, email, password, avatar, status, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [user.username, user.email, user.password, user.avatar || null, user.status || 'offline']
    );
    const row = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row?.id ?? 0;
  }

  static async findUserById(id: number): Promise<User | null> {
    const user = await get<User>('SELECT * FROM users WHERE id = ?', [id]);
    return user ?? null;
  }

  static async findUserByUsername(username: string): Promise<User | null> {
    const user = await get<User>('SELECT * FROM users WHERE username = ?', [username]);
    return user ?? null;
  }

  static async findUserByEmail(email: string): Promise<User | null> {
    const user = await get<User>('SELECT * FROM users WHERE email = ?', [email]);
    return user ?? null;
  }

  static async updateUserStatus(id: number, status: 'online' | 'offline'): Promise<void> {
    await run('UPDATE users SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);
  }

  static async getAllUsers(): Promise<User[]> {
    return all<User>('SELECT * FROM users ORDER BY username');
  }

  static async deleteUser(id: number): Promise<void> {
    await run('DELETE FROM users WHERE id = ?', [id]);
  }

  static async getFriends(userId: number) {
    return all(
      `SELECT f.friend_id as id, u.username, u.avatar, u.status, f.status as relation, f.created_at
         FROM friendships f JOIN users u ON u.id = f.friend_id
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC`,
      [userId]
    );
  }

  static async getUserHistory(userId: number, limit = 20) {
    return all(
      `SELECT g.*, 
              CASE 
                WHEN g.player1_type = 'user' THEN u1.username
                WHEN g.player1_type = 'local' THEN lp1.username
              END as player1_username,
              CASE 
                WHEN g.player2_type = 'user' THEN u2.username
                WHEN g.player2_type = 'local' THEN lp2.username
              END as player2_username,
              t.name as tournament_name
         FROM games g
         LEFT JOIN users u1 ON g.player1_id = u1.id AND g.player1_type = 'user'
         LEFT JOIN users u2 ON g.player2_id = u2.id AND g.player2_type = 'user'
         LEFT JOIN local_players lp1 ON g.player1_id = lp1.id AND g.player1_type = 'local'
         LEFT JOIN local_players lp2 ON g.player2_id = lp2.id AND g.player2_type = 'local'
         LEFT JOIN tournaments t ON g.tournament_id = t.id
        WHERE ((g.player1_id = ? AND g.player1_type = 'user') OR (g.player2_id = ? AND g.player2_type = 'user'))
           AND g.status = 'finished'
        ORDER BY g.created_at DESC
        LIMIT ?`,
      [userId, userId, limit]
    );
  }

  static defaultAvatar(username: string) {
    return `https://api.dicebear.com/8.x/identicon/svg?seed=${encodeURIComponent(username)}`;
  }

  /**
   * Retourne un utilisateur sans le mot de passe (sécurité)
   * Utilisé pour envoyer les données user au frontend
   */
  static safeUser(u: any): any {
    if (!u) return null;
    const { password, ...rest } = u;
    return rest;
  }

  static async updateProfile(
    userId: number,
    data: { username?: string | null; email?: string | null; avatar?: string | null }
  ) {
    await run(
      `UPDATE users SET
         username   = COALESCE(?, username),
         email      = COALESCE(?, email),
         avatar     = COALESCE(?, avatar),
         updated_at = datetime('now')
       WHERE id = ?`,
      [data.username ?? null, data.email ?? null, data.avatar ?? null, userId]
    );
  }

  static async updatePassword(userId: number, hashedPassword: string): Promise<void> {
    await run(
      `UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?`,
      [hashedPassword, userId]
    );
  }

  static async searchUsers(q: string, limit = 20, offset = 0) {
    return all(
      `SELECT id, username, avatar, status
      FROM users
      WHERE username LIKE ? OR email LIKE ?
      ORDER BY username
      LIMIT ? OFFSET ?`,
      [`%${q}%`, `%${q}%`, limit, offset]  
    );
  }

  static async getUserTournaments(userId: number) {
    return all(
      `SELECT t.*
         FROM tournaments t
         JOIN tournament_participants tp ON tp.tournament_id = t.id
        WHERE tp.user_id = ?
        ORDER BY t.created_at DESC`,
      [userId]
    );
  }
}

// ============== GAMES SERVICE ==============
export class GameService {
  static async createGame(game: Game): Promise<number> {
    await run(
      `INSERT INTO games (player1_id, player2_id, player1_type, player2_type, player1_score, player2_score, 
                         status, winner_id, winner_type, tournament_id, duration, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        game.player1_id,
        game.player2_id ?? null,
        game.player1_type || 'user',
        game.player2_type || 'user',
        game.player1_score || 0,
        game.player2_score || 0,
        game.status || 'waiting',
        game.winner_id ?? null,
        game.winner_type ?? null,
        game.tournament_id ?? null,
        game.duration || 0,
      ]
    );
    const row = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row?.id ?? 0;
  }

  static async findGameById(id: number): Promise<Game | null> {
    const game = await get<Game>('SELECT * FROM games WHERE id = ?', [id]);
    return game ?? null;
  }

  static async updateGameScore(id: number, player1_score: number, player2_score: number): Promise<void> {
    await run(`UPDATE games SET player1_score = ?, player2_score = ? WHERE id = ?`, [
      player1_score,
      player2_score,
      id,
    ]);
  }

  // Partial updates (room join, status, scores…)
  static async updateGame(id: number, updates: Partial<Game>): Promise<void> {
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.player2_id !== undefined) {
      fields.push('player2_id = ?');
      values.push(updates.player2_id);
    }
    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.player1_score !== undefined) {
      fields.push('player1_score = ?');
      values.push(updates.player1_score);
    }
    if (updates.player2_score !== undefined) {
      fields.push('player2_score = ?');
      values.push(updates.player2_score);
    }
    if (updates.winner_id !== undefined) {
      fields.push('winner_id = ?');
      values.push(updates.winner_id);
    }

    if (fields.length > 0) {
      values.push(id);
      await run(`UPDATE games SET ${fields.join(', ')} WHERE id = ?`, values);
    }
  }

  /**
   * Terminer une partie.
   * - Compatible avec les deux usages:
   *   - (id, winner_id)             -> met uniquement status/winner/finished_at
   *   - (id, winner_id, p1, p2)     -> met aussi les scores
   */
  static async finishGame(
    id: number,
    winner_id: number,
    player1_score?: number,
    player2_score?: number
  ): Promise<void> {
    if (player1_score === undefined || player2_score === undefined) {
      await run(
        `UPDATE games
            SET status = 'finished',
                winner_id = ?,
                finished_at = datetime('now')
          WHERE id = ?`,
        [winner_id, id]
      );
    } else {
      await run(
        `UPDATE games
            SET status = 'finished',
                winner_id = ?,
                player1_score = ?,
                player2_score = ?,
                finished_at = datetime('now')
          WHERE id = ?`,
        [winner_id, player1_score, player2_score, id]
      );
    }
  }

  // Nouvelle méthode pour créer un jeu à partir d'usernames (gère automatiquement users vs local players)
  static async createGameFromUsernames(gameData: {
    player1_username: string;
    player2_username: string;
    winner_username: string;
    player1_score: number;
    player2_score: number;
    duration: number;
    tournament_id?: number;
  }): Promise<number> {
    const { LocalPlayerService } = await import('./localPlayerService.js');

    // Déterminer le type et l'ID de chaque joueur
    const player1User = await UserService.findUserByUsername(gameData.player1_username);
    const player2User = await UserService.findUserByUsername(gameData.player2_username);
    const winnerUser = await UserService.findUserByUsername(gameData.winner_username);

    let player1_id: number;
    let player1_type: 'user' | 'local';
    let player2_id: number;
    let player2_type: 'user' | 'local';
    let winner_id: number;
    let winner_type: 'user' | 'local';

    // Player 1
    if (player1User) {
      player1_id = player1User.id!;
      player1_type = 'user';
    } else {
      const localPlayer1 = await LocalPlayerService.findOrCreateByUsername(gameData.player1_username);
      player1_id = localPlayer1.id!;
      player1_type = 'local';
    }

    // Player 2
    if (player2User) {
      player2_id = player2User.id!;
      player2_type = 'user';
    } else {
      const localPlayer2 = await LocalPlayerService.findOrCreateByUsername(gameData.player2_username);
      player2_id = localPlayer2.id!;
      player2_type = 'local';
    }

    // Winner
    if (winnerUser) {
      winner_id = winnerUser.id!;
      winner_type = 'user';
    } else {
      const localWinner = await LocalPlayerService.findOrCreateByUsername(gameData.winner_username);
      winner_id = localWinner.id!;
      winner_type = 'local';
    }

    const game: Game = {
      player1_id,
      player2_id,
      player1_type,
      player2_type,
      player1_score: gameData.player1_score,
      player2_score: gameData.player2_score,
      status: 'finished',
      winner_id,
      winner_type,
      tournament_id: gameData.tournament_id,
      duration: gameData.duration,
    };

    const gameId = await this.createGame(game);
    
    // Mettre à jour les statistiques uniquement pour les utilisateurs authentifiés
    await StatsService.updateStatsAfterGame(gameId);
    
    return gameId;
  }

  static async getUserGames(userId: number): Promise<Game[]> {
    return all<Game>(
      `SELECT * FROM games
        WHERE ((player1_id = ? AND player1_type = 'user') 
           OR (player2_id = ? AND player2_type = 'user'))
           AND status != 'cancelled'
        ORDER BY created_at DESC`,
      [userId, userId]
    );
  }

  static async getActiveGames(limit = 50, offset = 0): Promise<Game[]> {
    return all<Game>(
      `SELECT * FROM games
        WHERE status IN ('waiting','playing')
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }

  static async getAllGames(limit = 50, offset = 0): Promise<Game[]> {
    return all<Game>(
      `SELECT * FROM games
        WHERE status != 'cancelled'
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }

  static async listGames({
    status,
    limit = 50,
    offset = 0,
  }: {
    status?: string | null;
    limit?: number;
    offset?: number;
  }) {
    if (status === "active") {
      return all(
        `SELECT * FROM games
          WHERE status IN ('waiting','playing')
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
        [limit, offset]
      );
    }
    return all(
      `SELECT * FROM games
        WHERE status != 'cancelled'
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [limit, offset]
    );
  }
}

type TournamentInput = Pick<Tournament, "name" | "description" | "max_players" | "created_by">;

// ============== TOURNAMENTS SERVICE ==============
export class TournamentService {
  static async createTournament(tournament: TournamentInput): Promise<number> {
    await run(
      `INSERT INTO tournaments (name, description, max_players, created_by, current_players, status, created_at)
       VALUES (?, ?, ?, ?, 0, 'waiting', datetime('now'))`,
      [tournament.name, tournament.description ?? null, tournament.max_players ?? 8, tournament.created_by]
    );
    const row = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row?.id ?? 0;
  }

  static async findTournamentById(id: number): Promise<Tournament | null> {
    const tournament = await get<Tournament>('SELECT * FROM tournaments WHERE id = ?', [id]);
    return tournament ?? null;
  }

  static async joinTournament(tournamentId: number, userId: number): Promise<boolean> {
    try {
      await run(
        `INSERT OR IGNORE INTO tournament_participants (tournament_id, user_id, joined_at)
         VALUES (?, ?, datetime('now'))`,
        [tournamentId, userId]
      );

      const row = await get<{ inserted: number }>(`SELECT changes() AS inserted`);
      const inserted = Number(row?.inserted || 0);

      if (inserted === 1) {
        await run(
          `UPDATE tournaments
              SET current_players = current_players + 1
            WHERE id = ?`,
          [tournamentId]
        );
      }
      return inserted === 1;
    } catch (error) {
      console.error(`ERROR: Failed to join tournament ${tournamentId} for user ${userId}:`, error);
      throw error;
    }
  }

  static async getTournamentParticipants(tournamentId: number): Promise<User[]> {
    return all<User>(
      `SELECT u.*
         FROM users u
         JOIN tournament_participants tp ON u.id = tp.user_id
        WHERE tp.tournament_id = ?
        ORDER BY tp.joined_at`,
      [tournamentId]
    );
  }

  static async getAllTournaments(): Promise<Tournament[]> {
    return all<Tournament>('SELECT * FROM tournaments ORDER BY created_at DESC');
  }

  static async startTournament(id: number): Promise<void> {
    await run(
      `UPDATE tournaments
          SET status = 'started',
              started_at = datetime('now')
        WHERE id = ?`,
      [id]
    );
  }
}

// ============== CHAT SERVICE ==============
export class ChatService {
  static async sendMessage(message: ChatMessage): Promise<number> {
    await run(
      `INSERT INTO chat_messages (sender_id, receiver_id, tournament_id, message, type, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [
        message.sender_id,
        message.receiver_id || null,
        message.tournament_id || null,
        message.message,
        message.type || 'private',
      ]
    );
    const row = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    return row?.id ?? 0;
  }

  static async getPrivateMessages(user1Id: number, user2Id: number, limit: number = 50): Promise<ChatMessage[]> {
    return all<ChatMessage>(
      `SELECT * FROM chat_messages
        WHERE type = 'private'
          AND ((sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?))
        ORDER BY created_at DESC
        LIMIT ?`,
      [user1Id, user2Id, user2Id, user1Id, limit]
    );
  }

  static async getTournamentMessages(tournamentId: number, limit: number = 50): Promise<ChatMessage[]> {
    return all<ChatMessage>(
      `SELECT cm.*, u.username as sender_username
         FROM chat_messages cm
         JOIN users u ON cm.sender_id = u.id
        WHERE cm.type = 'tournament' AND cm.tournament_id = ?
        ORDER BY cm.created_at DESC
        LIMIT ?`,
      [tournamentId, limit]
    );
  }

  static async getGlobalMessages(limit: number = 50): Promise<ChatMessage[]> {
    return all<ChatMessage>(
      `SELECT cm.*, u.username as sender_username
         FROM chat_messages cm
         JOIN users u ON cm.sender_id = u.id
        WHERE cm.type = 'global'
        ORDER BY cm.created_at DESC
        LIMIT ?`,
      [limit]
    );
  }
}

// ============== STATS SERVICE ==============
export class StatsService {
  static async initUserStats(userId: number): Promise<void> {
    await run(`INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)`, [userId]);
  }

  static async updateStatsAfterGame(gameId: number): Promise<void> {
    const game = await GameService.findGameById(gameId);
    if (!game || game.status !== 'finished' || !game.winner_id) return;

    // Déterminer correctement le perdant en comparant à la fois l'ID et le type
    const isPlayer1Winner = (game.winner_id === game.player1_id && game.winner_type === game.player1_type);
    const loserId = isPlayer1Winner ? game.player2_id : game.player1_id;
    const loserType = isPlayer1Winner ? game.player2_type : game.player1_type;
    const isTournamentGame = game.tournament_id !== null;

    // Mettre à jour les stats du gagnant (seulement si c'est un utilisateur authentifié)
    if (game.winner_type === 'user') {
      if (isTournamentGame) {
        await run(
          `UPDATE user_stats
              SET games_played = games_played + 1,
                  games_won    = games_won + 1,
                  tournaments_played = tournaments_played + 1,
                  updated_at   = datetime('now')
            WHERE user_id = ?`,
          [game.winner_id]
        );
      } else {
        await run(
          `UPDATE user_stats
              SET games_played = games_played + 1,
                  games_won    = games_won + 1,
                  updated_at   = datetime('now')
            WHERE user_id = ?`,
          [game.winner_id]
        );
      }
    }

    // Mettre à jour les stats du perdant (seulement si c'est un utilisateur authentifié)
    if (loserType === 'user') {
      if (isTournamentGame) {
        await run(
          `UPDATE user_stats
              SET games_played = games_played + 1,
                  games_lost   = games_lost + 1,
                  tournaments_played = tournaments_played + 1,
                  updated_at   = datetime('now')
            WHERE user_id = ?`,
          [loserId]
        );
      } else {
        await run(
          `UPDATE user_stats
              SET games_played = games_played + 1,
                  games_lost   = games_lost + 1,
                  updated_at   = datetime('now')
            WHERE user_id = ?`,
          [loserId]
        );
      }
    }
  }

  static async updateTournamentWin(userId: number): Promise<void> {
    await run(
      `UPDATE user_stats
          SET tournaments_won = tournaments_won + 1,
              updated_at = datetime('now')
        WHERE user_id = ?`,
      [userId]
    );
  }

  static async getUserStats(userId: number) {
    const stats = await get('SELECT * FROM user_stats WHERE user_id = ?', [userId]);
    return stats ?? null;
  }

  static async getLeaderboard(limit: number = 10) {
    return all(
      `SELECT u.username, us.*
         FROM user_stats us
         JOIN users u ON us.user_id = u.id
        ORDER BY us.games_won DESC, us.games_played ASC
        LIMIT ?`,
      [limit]
    );
  }
}

// ============== FRIENDSHIP SERVICE ==============
export class FriendshipService {
  static async request(selfId: number, targetId: number) {
    await run(
      `INSERT OR IGNORE INTO friendships (user_id, friend_id, status)
       VALUES (?, ?, 'pending')`,
      [selfId, targetId]
    );
  }

  static async accept(selfId: number, targetId: number) {
    // on accepte la demande inverse (target -> self)
    console.log(`[DEBUG] Accepting friendship: selfId=${selfId}, targetId=${targetId}`);
    const result = await run(
      `UPDATE friendships SET status='accepted'
        WHERE user_id = ? AND friend_id = ? AND status = 'pending'`,
      [targetId, selfId]
    );
    console.log(`[DEBUG] Accept result:`, result);
    
    // Vérifier que l'update a bien fonctionné
    const friendship = await get(
      'SELECT * FROM friendships WHERE user_id = ? AND friend_id = ?',
      [targetId, selfId]
    );
    console.log(`[DEBUG] Friendship after accept:`, friendship);
  }

  static async decline(selfId: number, targetId: number) {
    // on refuse la demande inverse (target -> self) en la supprimant
    console.log(`[DEBUG] Declining friendship: selfId=${selfId}, targetId=${targetId}`);
    const result = await run(
      `DELETE FROM friendships 
        WHERE user_id = ? AND friend_id = ? AND status = 'pending'`,
      [targetId, selfId]
    );
    console.log(`[DEBUG] Decline result:`, result);
  }

  static async block(selfId: number, targetId: number) {
    // Supprimer toutes les amitiés existantes entre les deux utilisateurs
    await run(
      `DELETE FROM friendships WHERE 
       (user_id = ? AND friend_id = ?) OR 
       (user_id = ? AND friend_id = ?)`,
      [selfId, targetId, targetId, selfId]
    );
    
    // Ajouter le blocage
    await run(
      `INSERT INTO friendships (user_id, friend_id, status)
       VALUES (?, ?, 'blocked')`,
      [selfId, targetId]
    );
  }

  static async unblock(selfId: number, targetId: number) {
    await run(
      `DELETE FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'blocked'`,
      [selfId, targetId]
    );
  }

  static async getBlockedUsers(userId: number): Promise<number[]> {
    const results = await all(
      `SELECT friend_id FROM friendships WHERE user_id = ? AND status = 'blocked'`,
      [userId]
    );
    return results.map((r: any) => r.friend_id);
  }

  static async isBlocked(userId: number, targetId: number): Promise<boolean> {
    const result = await get(
      `SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? AND status = 'blocked'`,
      [targetId, userId]
    );
    return !!result;
  }

  static async getFriendshipStatus(userId: number, targetId: number): Promise<string | null> {
    const result = await get(
      `SELECT status FROM friendships 
       WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)`,
      [userId, targetId, targetId, userId]
    );
    return result?.status || null;
  }

  static async getFriendshipStatusFromPerspective(userId: number, targetId: number): Promise<string> {
    // Chercher si l'utilisateur a envoyé une demande à targetId
    const sentRequest = await get(
      `SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?`,
      [userId, targetId]
    );
    
    // Chercher si targetId a envoyé une demande à l'utilisateur
    const receivedRequest = await get(
      `SELECT status FROM friendships WHERE user_id = ? AND friend_id = ?`,
      [targetId, userId]
    );
    
    if (sentRequest?.status === 'accepted' || receivedRequest?.status === 'accepted') {
      return 'friend';
    }
    
    if (sentRequest?.status === 'pending') {
      return 'sent';
    }
    
    if (receivedRequest?.status === 'pending') {
      return 'received';
    }
    
    return 'none';
  }

  static async getPendingRequests(userId: number) {
    return all(
      `SELECT f.id, f.user_id, u.username, u.avatar, f.created_at
       FROM friendships f 
       JOIN users u ON u.id = f.user_id
       WHERE f.friend_id = ? AND f.status = 'pending'
       ORDER BY f.created_at DESC`,
      [userId]
    );
  }

  static async getFriends(userId: number) {
    return all(
      `SELECT u.id, u.username, u.avatar, u.status, f.created_at as friend_since
       FROM friendships f 
       JOIN users u ON (u.id = f.friend_id OR u.id = f.user_id)
       WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted' AND u.id != ?
       ORDER BY u.username`,
      [userId, userId, userId]
    );
  }
}

// Direct Message Service
export class DirectMessageService {
  /**
   * Envoyer un message direct
   */
  static async sendMessage(senderId: number, receiverId: number, message: string): Promise<any> {
    // Vérifier que les deux utilisateurs existent
    const sender = await get(`SELECT id FROM users WHERE id = ?`, [senderId]);
    const receiver = await get(`SELECT id FROM users WHERE id = ?`, [receiverId]);
    
    if (!sender || !receiver) {
      throw new Error('Sender or receiver not found');
    }
    
    // Vérifier que l'utilisateur n'est pas bloqué
    const isBlocked = await FriendshipService.isBlocked(senderId, receiverId);
    if (isBlocked) {
      throw new Error('Cannot send message to blocked user');
    }
    
    await run(
      `INSERT INTO direct_messages (sender_id, receiver_id, message) VALUES (?, ?, ?)`,
      [senderId, receiverId, message]
    );
    
    const result = await get<{ id: number }>(`SELECT last_insert_rowid() AS id`);
    const messageId = result?.id ?? 0;
    
    return {
      id: messageId,
      sender_id: senderId,
      receiver_id: receiverId,
      message,
      read_at: null,
      created_at: new Date().toISOString()
    };
  }
  
  /**
   * Récupérer la conversation entre deux utilisateurs
   */
  static async getConversation(userId: number, otherUserId: number, limit = 50): Promise<any[]> {
    return all(
      `SELECT dm.*, 
              sender.username as sender_username, 
              sender.avatar as sender_avatar,
              receiver.username as receiver_username,
              receiver.avatar as receiver_avatar
       FROM direct_messages dm
       JOIN users sender ON sender.id = dm.sender_id
       JOIN users receiver ON receiver.id = dm.receiver_id
       WHERE (dm.sender_id = ? AND dm.receiver_id = ?) 
          OR (dm.sender_id = ? AND dm.receiver_id = ?)
       ORDER BY dm.created_at DESC
       LIMIT ?`,
      [userId, otherUserId, otherUserId, userId, limit]
    );
  }
  
  /**
   * Récupérer la liste des conversations (avec le dernier message et le nombre de non-lus)
   */
  static async getConversations(userId: number): Promise<any[]> {
    // Récupérer toutes les personnes avec qui on a échangé des messages
    const conversationUsers = await all(
      `SELECT DISTINCT
         CASE 
           WHEN sender_id = ? THEN receiver_id 
           ELSE sender_id 
         END as other_user_id
       FROM direct_messages
       WHERE sender_id = ? OR receiver_id = ?`,
      [userId, userId, userId]
    );
    
    // Pour chaque utilisateur, récupérer les détails et le dernier message
    const conversations = [];
    for (const conv of conversationUsers) {
      const otherUserId = conv.other_user_id;
      
      // Récupérer les infos de l'autre utilisateur
      const user = await get(
        `SELECT id, username, avatar, status FROM users WHERE id = ?`,
        [otherUserId]
      );
      
      if (!user) continue;
      
      // Récupérer le dernier message
      const lastMsg = await get(
        `SELECT message, created_at, sender_id
         FROM direct_messages
         WHERE (sender_id = ? AND receiver_id = ?)
            OR (sender_id = ? AND receiver_id = ?)
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, otherUserId, otherUserId, userId]
      );
      
      // Compter les messages non lus
      const unreadResult = await get(
        `SELECT COUNT(*) as count
         FROM direct_messages
         WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL`,
        [userId, otherUserId]
      );
      
      conversations.push({
        other_user_id: otherUserId,
        other_username: user.username,
        other_avatar: user.avatar,
        other_status: user.status || 'offline',
        last_message: lastMsg?.message || '',
        last_message_at: lastMsg?.created_at || new Date().toISOString(),
        last_sender_id: lastMsg?.sender_id || null,
        unread_count: unreadResult?.count || 0
      });
    }
    
    // Trier par date du dernier message
    conversations.sort((a, b) => {
      return new Date(b.last_message_at).getTime() - new Date(a.last_message_at).getTime();
    });
    
    return conversations;
  }
  
  /**
   * Marquer les messages comme lus
   */
  static async markAsRead(userId: number, otherUserId: number): Promise<void> {
    await run(
      `UPDATE direct_messages 
       SET read_at = CURRENT_TIMESTAMP 
       WHERE receiver_id = ? AND sender_id = ? AND read_at IS NULL`,
      [userId, otherUserId]
    );
  }
  
  /**
   * Obtenir le nombre de messages non lus
   */
  static async getUnreadCount(userId: number): Promise<number> {
    const result = await get(
      `SELECT COUNT(*) as count 
       FROM direct_messages 
       WHERE receiver_id = ? AND read_at IS NULL`,
      [userId]
    );
    return result?.count || 0;
  }
  
  /**
   * Supprimer un message (optionnel)
   */
  static async deleteMessage(messageId: number, userId: number): Promise<boolean> {
    await run(
      `DELETE FROM direct_messages 
       WHERE id = ? AND sender_id = ?`,
      [messageId, userId]
    );
    // Vérifier si le message existait
    const check = await get(
      `SELECT 1 FROM direct_messages WHERE id = ?`,
      [messageId]
    );
    return !check; // Si le message n'existe plus, la suppression a réussi
  }
}


