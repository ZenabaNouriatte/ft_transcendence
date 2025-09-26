// backend/src/services/index.ts (merged)

import { run, get, all } from "../database/index.js";

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
  player2_id: number | null;
  player1_score?: number;
  player2_score?: number;
  status?: 'waiting' | 'playing' | 'finished' | 'cancelled';
  winner_id?: number;
  tournament_id?: number | null;
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

  static async updateUserStatus(id: number, status: 'online' | 'offline' | 'ingame'): Promise<void> {
    await run(`UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, id]);
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
      `SELECT g.*
         FROM games g
        WHERE g.player1_id = ? OR g.player2_id = ?
        ORDER BY g.created_at DESC
        LIMIT ?`,
      [userId, userId, limit]
    );
  }

  static defaultAvatar(username: string) {
    return `https://api.dicebear.com/8.x/identicon/svg?seed=${encodeURIComponent(username)}`;
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

  static async searchUsers(q: string, limit = 20, offset = 0) {
    return all(
      `SELECT id, username, avatar, status
         FROM users
        WHERE username LIKE ?
        ORDER BY username
        LIMIT ? OFFSET ?`,
      [`%${q}%`, limit, offset]
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
      `INSERT INTO games (player1_id, player2_id, player1_score, player2_score, status, tournament_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      [
        game.player1_id,
        game.player2_id ?? null,
        game.player1_score || 0,
        game.player2_score || 0,
        game.status || 'waiting',
        game.tournament_id ?? null,
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

  static async getUserGames(userId: number): Promise<Game[]> {
    return all<Game>(
      `SELECT * FROM games
        WHERE player1_id = ? OR player2_id = ?
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

    const loserId = game.winner_id === game.player1_id ? game.player2_id : game.player1_id;

    await run(
      `UPDATE user_stats
          SET games_played = games_played + 1,
              games_won    = games_won + 1,
              updated_at   = datetime('now')
        WHERE user_id = ?`,
      [game.winner_id]
    );

    await run(
      `UPDATE user_stats
          SET games_played = games_played + 1,
              games_lost   = games_lost + 1,
              updated_at   = datetime('now')
        WHERE user_id = ?`,
      [loserId]
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
    await run(
      `UPDATE friendships SET status='accepted'
        WHERE user_id = ? AND friend_id = ?`,
      [targetId, selfId]
    );
  }

  static async block(selfId: number, targetId: number) {
    await run(
      `INSERT OR REPLACE INTO friendships (user_id, friend_id, status)
       VALUES (?, ?, 'blocked')`,
      [selfId, targetId]
    );
  }
}
