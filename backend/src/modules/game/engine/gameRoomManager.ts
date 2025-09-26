// backend/src/modules/game/engine/gameRoomManager.ts
// Gestion des salles de jeu multi-joueurs avec état centralisé

import { PongEngine } from './pongEngine.js';
import { GameRoom, Player, GameMessage, PlayerAction, PaddleDirection } from './gameTypes.js';

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
      connected: true
    };

    this.players.set(userId, player);
    console.log(`👤 [Backend] Player ${username} (${userId}) joined game ${this.gameId} as ${paddle} paddle`);

    // Si on a 2 joueurs, démarrer la partie
    if (this.players.size === 2) {
      this.startGame();
    }

    // Notifier les autres joueurs
    this.broadcastMessage({
      type: 'player_joined',
      gameId: this.gameId,
      data: { player },
      timestamp: Date.now()
    });

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
  }

  // Mettre à jour (appelé par la boucle 60 FPS)
  public update(): void {
    const gameStillRunning = this.engine.update();
    this.lastUpdate = Date.now();

    // Vérifier si la partie est terminée
    if (!gameStillRunning && this.status !== 'ended') {
      this.endGame();
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
  private endGame(): void {
    this.status = 'ended';
    const winner = this.engine.getWinner();

    console.log(`[Backend] Game ${this.gameId} ended. Winner: ${winner}`);

    this.broadcastMessage({
      type: 'game_ended',
      gameId: this.gameId,
      data: { 
        winner,
        finalState: this.engine.getGameState()
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
}