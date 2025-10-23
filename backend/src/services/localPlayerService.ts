// backend/src/services/localPlayerService.ts
import { get, run } from "../database/index.js";

export interface LocalPlayer {
  id?: number;
  username: string;
  created_at?: string;
  last_used?: string;
}

export class LocalPlayerService {
  // Créer ou récupérer un joueur local par nom
  static async findOrCreateByUsername(username: string): Promise<LocalPlayer> {
    try {
      // D'abord, essayer de trouver le joueur existant
      const existingPlayer = await get<LocalPlayer>(
        `SELECT * FROM local_players WHERE username = ? ORDER BY last_used DESC LIMIT 1`,
        [username]
      );

      if (existingPlayer) {
        // Mettre à jour la date de dernière utilisation
        await run(
          `UPDATE local_players SET last_used = CURRENT_TIMESTAMP WHERE id = ?`,
          [existingPlayer.id!]
        );
        return existingPlayer;
      } else {
        // Créer un nouveau joueur local
        await run(
          `INSERT INTO local_players (username, created_at, last_used) 
           VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [username]
        );

        // Récupérer le joueur créé
        const newPlayer = await get<LocalPlayer>(
          `SELECT * FROM local_players WHERE username = ? ORDER BY id DESC LIMIT 1`,
          [username]
        );
        
        if (!newPlayer) {
          throw new Error('Failed to create local player');
        }
        
        return newPlayer;
      }
    } catch (error) {
      throw error;
    }
  }

  // Récupérer un joueur local par ID
  static async findById(id: number): Promise<LocalPlayer | null> {
    try {
      const player = await get<LocalPlayer>(
        `SELECT * FROM local_players WHERE id = ?`,
        [id]
      );
      return player || null;
    } catch (error) {
      throw error;
    }
  }

  // Récupérer un joueur local par username
  static async findByUsername(username: string): Promise<LocalPlayer | null> {
    try {
      const player = await get<LocalPlayer>(
        `SELECT * FROM local_players WHERE username = ? ORDER BY last_used DESC LIMIT 1`,
        [username]
      );
      return player || null;
    } catch (error) {
      throw error;
    }
  }

  // Nettoyer les anciens joueurs locaux (plus de 30 jours)
  static async cleanupOldPlayers(): Promise<void> {
    try {
      await run(
        `DELETE FROM local_players 
         WHERE last_used < datetime('now', '-30 days')`
      );
    } catch (error) {
      throw error;
    }
  }
}
