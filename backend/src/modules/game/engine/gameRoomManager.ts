// backend/src/modules/game/engine/gameRoomManager.ts
// Gestion des salles de jeu multi-joueurs avec état centralisé

import { PongEngine } from './pongEngine.js';
import { GameRoom, Player, GameMessage, PlayerAction, PaddleDirection } from './gameTypes.js';
import { GameService, UserService, StatsService } from '../../../services/index.js';

export class GameRoomManager {
  private rooms: Map<string, GameRoomInstance> = new Map();
  private gameLoopInterval: ReturnType<typeof setInterval> | null = null;
  private readonly tickRate = 60; // 60 FPS

  constructor() {
    this.startGameLoop();
    console.log('🎮 GameRoomManager initialized with 60 FPS game loop');
  }

  // Créer une nouvelle salle
  public createRoom(gameId: string): GameRoomInstance {
    const room = new GameRoomInstance(gameId);
    this.rooms.set(gameId, room);
    console.log(`[Backend] Created game room ${gameId}`);
    return room;
  }

  // Récupérer une salle
  public getRoom(gameId: string): GameRoomInstance | undefined {
    return this.rooms.get(gameId);
  }

  // Supprimer une salle terminée
  public deleteRoom(gameId: string): void {
    this.rooms.delete(gameId);
    console.log(`[Backend] Deleted game room ${gameId}`);
  }

  // BOUCLE PRINCIPALE : Met à jour toutes les parties actives (60 FPS)
  private startGameLoop(): void {
    this.gameLoopInterval = setInterval(() => {
      this.rooms.forEach((room) => {
        if (room.getStatus() === 'playing') {
          room.update();
        }
      });
    }, 1000 / this.tickRate); // ~16.67ms pour 60 FPS
  }

  // Nettoyer les ressources
  public shutdown(): void {
    if (this.gameLoopInterval) {
      clearInterval(this.gameLoopInterval);
    }
    this.rooms.clear();
    console.log('[Backend] GameRoomManager shut down');
  }

  // Statistiques pour monitoring
  public getStats(): {
    totalRooms: number;
    activeGames: number;
    totalPlayers: number;
  } {
    const activeGames = Array.from(this.rooms.values()).filter(r => r.getStatus() === 'playing').length;
    const totalPlayers = Array.from(this.rooms.values()).reduce((total, room) => total + room.getPlayerCount(), 0);
    
    return {
      totalRooms: this.rooms.size,
      activeGames,
      totalPlayers
    };
  }
  
  // Démarrer un jeu spécifique par ID
  public startGame(gameId: string): boolean {
    const room = this.getRoom(gameId);
    if (!room) {
      console.log(`[Backend] Cannot start game ${gameId}: room not found`);
      return false;
    }
    
    try {
      room.startGame();
      console.log(`[Backend] Started game ${gameId}`);
      return true;
    } catch (error) {
      console.error(`[Backend] Failed to start game ${gameId}:`, error);
      return false;
    }
  }

  public removePlayerFromAllRooms(userId: string): void {
    console.log(`[GameRoomManager] Removing player ${userId} from all rooms`);
    
    const roomsToCleanup = [];
    
    // Parcourir toutes les rooms pour trouver celles où ce joueur participe
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.hasPlayer(userId)) {
        console.log(`[GameRoomManager] Found player ${userId} in room ${roomId}`);
        room.removePlayer(userId);
        
        // Si la room n'a plus de joueurs, marquer pour suppression
        if (room.getPlayerCount() === 0) {
          roomsToCleanup.push(roomId);
        }
      }
    }
    
    // Supprimer les rooms vides
    for (const roomId of roomsToCleanup) {
      console.log(`[GameRoomManager] Cleaning up empty room ${roomId}`);
      this.deleteRoom(roomId);
    }
  }
  
  // Contrôler le paddle d'un jeu spécifique
  public movePaddle(gameId: string, player: 1 | 2, direction: 'up' | 'down' | 'stop'): boolean {
    const room = this.getRoom(gameId);
    if (!room) {
      console.log(`[Backend] Cannot move paddle in game ${gameId}: room not found`);
      return false;
    }
    
    try {
      // Convertir player number en side string
      const side = player === 1 ? 'left' : 'right';
      const paddleDirection: PaddleDirection = direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'stop';
      
      room.movePaddle(side, paddleDirection);
      return true;
    } catch (error) {
      console.error(`[Backend] Failed to move paddle in game ${gameId}:`, error);
      return false;
    }
  }
}

// Instance individuelle d'une salle de jeu
export class GameRoomInstance {
  private gameId: string;
  private engine: PongEngine;
  private players: Map<string, Player> = new Map(); // Changé de number à string
  private status: 'waiting' | 'playing' | 'paused' | 'ended' = 'waiting';
  private createdAt: number = Date.now();
  private lastUpdate: number = Date.now();
  private messageHandlers: Set<(message: GameMessage) => void> = new Set();

  constructor(gameId: string) {
    this.gameId = gameId;
    this.engine = new PongEngine();
    console.log(`[Backend] GameRoom ${gameId} created`);
  }

  // Ajouter un joueur
  public addPlayer(userId: string, username: string): boolean { // Changé de number à string
    if (this.players.size >= 2) {
      console.log(`[Backend] Room ${this.gameId} full, cannot add user ${userId}`);
      return false; // Partie pleine
    }

    // Déterminer quel paddle attribuer
    const paddle = this.players.size === 0 ? 'left' : 'right';
    
    const player: Player = {
      id: userId,
      username,
      paddle,
      connected: true,
      ready: false
    };

    this.players.set(userId, player);
    console.log(`👤 [Backend] Player ${username} (${userId}) joined game ${this.gameId} as ${paddle} paddle`);

    // Notifier les autres joueurs avec la liste complète
    this.broadcastMessage({
      type: 'player_joined',
      gameId: this.gameId,
      data: {
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          username: p.username,
          paddle: p.paddle,
          ready: p.ready || false
        }))
      },
      timestamp: Date.now()
    });

    return true;
  }

  // Définir le statut "ready" d'un joueur
  public setPlayerReady(userId: string, ready: boolean): boolean {
    const player = this.players.get(userId);
    if (!player) {
      console.log(`[Backend] Cannot set ready status: player ${userId} not found in room ${this.gameId}`);
      return false;
    }

    player.ready = ready;
    console.log(`[Backend] Player ${player.username} (${userId}) ready status set to ${ready} in room ${this.gameId}`);
    
    // Diffuser la mise à jour du statut ready
    this.broadcastMessage({
      type: 'player_joined',
      gameId: this.gameId,
      data: {
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          username: p.username,
          paddle: p.paddle,
          ready: p.ready
        }))
      },
      timestamp: Date.now()
    });
    
    // Vérifier si tous les joueurs sont prêts
    const allPlayersReady = Array.from(this.players.values()).every(p => p.ready === true);
    const hasEnoughPlayers = this.players.size >= 2;
    
    if (allPlayersReady && hasEnoughPlayers && this.status === 'waiting') {
      console.log(`[Backend] All players ready in room ${this.gameId}, starting countdown`);
      
      // Countdown de 3 secondes
      this.broadcastMessage({
        type: 'game_state',
        gameId: this.gameId,
        data: { countdown: 3 },
        timestamp: Date.now()
      });
      
      setTimeout(() => {
        this.broadcastMessage({
          type: 'game_state',
          gameId: this.gameId,
          data: { countdown: 2 },
          timestamp: Date.now()
        });
      }, 1000);
      
      setTimeout(() => {
        this.broadcastMessage({
          type: 'game_state',
          gameId: this.gameId,
          data: { countdown: 1 },
          timestamp: Date.now()
        });
      }, 2000);
      
      setTimeout(() => {
        this.broadcastMessage({
          type: 'game_state',
          gameId: this.gameId,
          data: { countdown: 0 },
          timestamp: Date.now()
        });
        this.startGame();
      }, 3000);
    }
    
    return true;
  }

  // Traiter une action de joueur
  public handlePlayerAction(action: PlayerAction): boolean {
    const player = this.players.get(action.playerId);
    if (!player || this.status !== 'playing') {
      return false;
    }

    // Appliquer l'action au moteur de jeu
    this.engine.movePaddle(player.paddle, action.direction);
    return true;
  }

  // Démarrer la partie
  public startGame(): void {
    if (this.players.size !== 2) return;
    
    this.status = 'playing';
    this.engine.startGame();
    console.log(`[Backend] Game ${this.gameId} started!`);
    
    // Diffuser le message de démarrage aux clients
    this.broadcastMessage({
      type: 'game.started',
      gameId: this.gameId,
      data: {
        players: Array.from(this.players.values()).map(p => ({
          id: p.id,
          username: p.username,
          paddle: p.paddle,
          ready: p.ready
        }))
      },
      timestamp: Date.now()
    });
  }

  // Mettre à jour (appelé par la boucle 60 FPS)
  public update(): void {
    const gameStillRunning = this.engine.update();
    this.lastUpdate = Date.now();

    // Vérifier si la partie est terminée
    if (!gameStillRunning && this.status !== 'ended') {
      // Ne pas bloquer la boucle de jeu, fire and forget
      this.endGame().catch(error => 
        console.error(`[Backend] Error ending game ${this.gameId}:`, error)
      );
    }

    // Diffuser l'état de jeu à tous les clients connectés
    this.broadcastGameState();
  }

  // Retirer un joueur
  public removePlayer(userId: string): void { // Changé de number à string
    const player = this.players.get(userId);
    if (!player) return;

    this.players.delete(userId);
    console.log(`[Backend] Player ${player.username} (${userId}) left game ${this.gameId}`);

    // Pauser le jeu si un joueur part
    if (this.status === 'playing') {
      this.status = 'paused';
      this.engine.pause();
    }

    this.broadcastMessage({
      type: 'player_left',
      gameId: this.gameId,
      data: { playerId: userId, username: player.username },
      timestamp: Date.now()
    });
  }

  // Terminer la partie
  private async endGame(): Promise<void> {
    this.status = 'ended';
    const winnerPaddle = this.engine.getWinner();
    const finalState = this.engine.getGameState();

    console.log(`[Backend] Game ${this.gameId} ended. Winner paddle: ${winnerPaddle}`);

    // Trouver le joueur gagnant avec son nom complet
    let winnerPlayer = null;
    if (winnerPaddle) {
      // Convertir "Player 1"/"Player 2" en "left"/"right"
      const winnerSide = winnerPaddle === 'Player 1' ? 'left' : 'right';
      
      // Trouver le joueur qui a ce paddle
      for (const player of this.players.values()) {
        if (player.paddle === winnerSide) {
          winnerPlayer = {
            id: player.id,
            name: player.username,
            paddle: player.paddle
          };
          console.log(`[Backend] Winner found: ${player.username} (${player.id})`);
          break;
        }
      }
    }

    // Sauvegarder le jeu en base pour les statistiques
    if (winnerPaddle) {
      await this.saveGameToDB(winnerPaddle, finalState);
    }

    this.broadcastMessage({
      type: 'game_ended',
      gameId: this.gameId,
      data: { 
        winner: winnerPlayer,  // Objet complet au lieu d'une simple string
        finalState
      },
      timestamp: Date.now()
    });
  }

  // Diffuser l'état de jeu à tous les clients (60 FPS)
  private broadcastGameState(): void {
    const message: GameMessage = {
      type: 'game_state',
      gameId: this.gameId,
      data: {
        state: this.engine.getGameState(),
        players: Array.from(this.players.values())
      },
      timestamp: Date.now()
    };

    this.broadcastMessage(message);
  }

  // Diffuser un message à tous les clients connectés
  private broadcastMessage(message: GameMessage): void {
    this.messageHandlers.forEach(handler => {
      try {
        handler(message);
      } catch (error) {
        console.error('[Backend] Error broadcasting message:', error);
      }
    });
  }

  // Gestion des handlers WebSocket
  public addMessageHandler(handler: (message: GameMessage) => void): void {
    this.messageHandlers.add(handler);
  }

  public removeMessageHandler(handler: (message: GameMessage) => void): void {
    this.messageHandlers.delete(handler);
  }

  // GETTERS PUBLICS
  public getGameId(): string { return this.gameId; }
  public getStatus(): string { return this.status; }
  public getPlayerCount(): number { return this.players.size; }
  public getPlayers(): Player[] { return Array.from(this.players.values()); }
  public getPlayer(userId: string): Player | undefined { return this.players.get(userId); }
  public hasPlayer(userId: string): boolean { return this.players.has(userId); } // Changé de number à string
  public getGameState() { return this.engine.getGameState(); }

  // Bouger un paddle
  public movePaddle(player: 'left' | 'right', direction: PaddleDirection): void {
    if (this.status !== 'playing') {
      console.log(`[Backend] Cannot move paddle, game not in playing state (${this.status})`);
      return;
    }
    
    this.engine.movePaddle(player, direction);
  }

  // Mettre en pause
  public pauseGame(): boolean {
    if (this.status !== 'playing') {
      console.log(`[Backend] Cannot pause game ${this.gameId}, not in playing state (${this.status})`);
      return false;
    }
    
    this.engine.pause();
    console.log(`[Backend] Game ${this.gameId} paused`);
    return true;
  }

  // Reprendre le jeu
  public resumeGame(): boolean {
    if (this.status !== 'playing') {
      console.log(`[Backend] Cannot resume game ${this.gameId}, not in playing state (${this.status})`);
      return false;
    }
    
    this.engine.resume();
    console.log(`[Backend] Game ${this.gameId} resumed`);
    return true;
  }

  // Sauvegarder le jeu en base pour les statistiques
  private async saveGameToDB(winner: string, finalState: any): Promise<void> {
    try {
      console.log(`[Backend] Saving local game ${this.gameId} to database for stats`);
      
      // Récupérer les joueurs par leur paddle (left = player1, right = player2)
      const playersArray = Array.from(this.players.values());
      if (playersArray.length !== 2) {
        console.warn(`[Backend] Game ${this.gameId} has ${playersArray.length} players, skipping DB save`);
        return;
      }

      // Trouver les joueurs par leur paddle assigné (left/right)
      const playerLeft = playersArray.find(p => p.paddle === 'left');
      const playerRight = playersArray.find(p => p.paddle === 'right');
      
      if (!playerLeft || !playerRight) {
        console.warn(`[Backend] Could not find both paddles in game ${this.gameId}, skipping DB save`);
        return;
      }

      console.log(`[Backend] Game players: LEFT=${playerLeft.username} (${playerLeft.id}), RIGHT=${playerRight.username} (${playerRight.id})`);

      // Trouver ou créer les joueurs en base
      let player1Info = await this.findOrCreatePlayer(playerLeft.username);
      let player2Info = await this.findOrCreatePlayer(playerRight.username);

      // Déterminer le gagnant - le moteur retourne "Player 1" ou "Player 2"
      // Player 1 = left paddle, Player 2 = right paddle
      const winnerInfo = winner === 'Player 1' ? player1Info : player2Info;
      const winnerUsername = winner === 'Player 1' ? playerLeft.username : playerRight.username;
      
      console.log(`[Backend] Game winner from engine: ${winner}, mapping to ${winnerInfo.type} ID: ${winnerInfo.id} (${winnerUsername})`);

      // Calculer les scores et la durée
      const player1Score = finalState.score1;
      const player2Score = finalState.score2;
      const gameDuration = Math.round((Date.now() - this.createdAt) / 1000); // Durée en secondes

      // Créer le jeu en base avec la nouvelle méthode
      const gameId = await GameService.createGameFromUsernames({
        player1_username: playerLeft.username,
        player2_username: playerRight.username,
        winner_username: winnerUsername,
        player1_score: player1Score,
        player2_score: player2Score,
        duration: gameDuration,
        tournament_id: undefined // Pas de tournoi pour les jeux locaux
      });

      // Les statistiques sont automatiquement mises à jour dans createGameFromUsernames
      // pour les utilisateurs authentifiés seulement

      console.log(`[Backend] Local game ${this.gameId} saved as DB game ${gameId} with winner ${winnerUsername} (${winnerInfo.type} ID: ${winnerInfo.id})`);

    } catch (error) {
      console.error(`[Backend] Failed to save game ${this.gameId} to DB:`, error);
    }
  }

  // Trouver ou créer un joueur (utilisateur authentifié ou joueur local)
  private async findOrCreatePlayer(username: string): Promise<{ id: number; type: 'user' | 'local' }> {
    try {
      // D'abord, chercher dans les utilisateurs authentifiés
      let user = await UserService.findUserByUsername(username);
      
      if (user) {
        console.log(`[Backend] Using authenticated user ${username} with ID ${user.id}`);
        return { id: user.id!, type: 'user' };
      }

      // Si pas trouvé dans les users, créer ou récupérer un joueur local
      const { LocalPlayerService } = await import('../../../services/localPlayerService.js');
      const localPlayer = await LocalPlayerService.findOrCreateByUsername(username);
      
      console.log(`[Backend] Using local player ${username} with ID ${localPlayer.id}`);
      return { id: localPlayer.id!, type: 'local' };
    } catch (error) {
      console.error(`[Backend] Failed to find/create player ${username}:`, error);
      throw error;
    }
  }
}