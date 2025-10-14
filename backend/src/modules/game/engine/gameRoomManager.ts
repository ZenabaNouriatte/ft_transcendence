// backend/src/modules/game/engine/gameRoomManager.ts
import { PongEngine } from './pongEngine.js';
import { Player, GameMessage, PaddleDirection } from './gameTypes.js';
import type { WebSocket } from 'ws';

// ─────────────────────────────────────────────────────────────────────────────
// Manager
// ─────────────────────────────────────────────────────────────────────────────
export class GameRoomManager {
  private rooms: Map<string, GameRoomInstance> = new Map();
  private gameLoopInterval: ReturnType<typeof setInterval> | null = null;
  private readonly tickRate = 60; // 60 FPS

  constructor() {
    this.startGameLoop();
    console.log('🎮 GameRoomManager initialized (60 FPS)');
  }

  public createRemoteRoom(hostUserId: number, hostUsername: string): string {
    const gameId = `remote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const room = new GameRoomInstance(gameId, true);
    
    room.addPlayer(String(hostUserId), hostUsername);
    
    this.rooms.set(gameId, room);
    console.log(`[Backend] Created REMOTE room ${gameId} (host: ${hostUsername})`);
    return gameId;
  }

  // Créer une room locale (non-remote)
  public createRoom(gameId: string): GameRoomInstance {
    const room = new GameRoomInstance(gameId, false);
    this.rooms.set(gameId, room);
    console.log(`[Backend] Created LOCAL room ${gameId}`);
    return room;
  }

  // Lister les rooms remote en attente
  public listWaitingRooms(): Array<{ gameId: string; hostUsername: string; createdAt: number }> {
    const waiting: Array<{ gameId: string; hostUsername: string; createdAt: number }> = [];
    this.rooms.forEach((room, gameId) => {
      if (room.isRemote() && room.getStatus() === 'waiting' && room.getPlayerCount() === 1) {
        const players = room.getPlayers();
        waiting.push({
          gameId,
          hostUsername: players[0]?.username || 'Unknown',
          createdAt: room.getCreatedAt(),
        });
      }
    });
    return waiting;
  }

  public getRoom(gameId: string): GameRoomInstance | undefined {
    return this.rooms.get(gameId);
  }

  public deleteRoom(gameId: string): void {
    this.rooms.delete(gameId);
    console.log(`[Backend] Deleted room ${gameId}`);
  }

  private startGameLoop(): void {
    this.gameLoopInterval = setInterval(() => {
      this.rooms.forEach((room) => {
        if (room.getStatus() === 'playing') {
          room.update();
        }
      });
    }, 1000 / this.tickRate);
  }

  public shutdown(): void {
    if (this.gameLoopInterval) clearInterval(this.gameLoopInterval);
    this.rooms.clear();
    console.log('[Backend] GameRoomManager shut down');
  }

  public getStats() {
    const activeGames = Array.from(this.rooms.values()).filter((r) => r.getStatus() === 'playing').length;
    const totalPlayers = Array.from(this.rooms.values()).reduce((total, room) => total + room.getPlayerCount(), 0);
    return { totalRooms: this.rooms.size, activeGames, totalPlayers };
  }

  public startGame(gameId: string): boolean {
    const room = this.getRoom(gameId);
    if (!room) return false;
    room.startGame();
    return true;
  }

  public movePaddle(gameId: string, player: 1 | 2, direction: 'up' | 'down' | 'stop'): boolean {
    const room = this.getRoom(gameId);
    if (!room) return false;
    const side = player === 1 ? 'left' : 'right';
    room.movePaddle(side, direction);
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Room
// ─────────────────────────────────────────────────────────────────────────────
export class GameRoomInstance {
  private gameId: string;
  private engine: PongEngine;
  private players: Map<string, Player> = new Map(); // userId → Player
  private status: 'waiting' | 'playing' | 'paused' | 'ended' = 'waiting';
  private createdAt: number = Date.now();
  private lastUpdate: number = Date.now();
  private remoteMode: boolean;
  private wsConnections: Map<string, WebSocket> = new Map(); // userId → WS

  constructor(gameId: string, remoteMode: boolean = false) {
    this.gameId = gameId;
    this.engine = new PongEngine();
    this.remoteMode = remoteMode;
    console.log(`[Backend] Room ${gameId} created (remote: ${remoteMode})`);
  }

  public isRemote(): boolean { return this.remoteMode; }
  public getCreatedAt(): number { return this.createdAt; }

  // Ajouter un joueur (+ éventuellement sa WS)
  public addPlayer(userId: string, username: string, ws?: WebSocket): boolean {
  // ✅ Si le joueur existe déjà (reconnexion/attach), juste mettre à jour la WS
  if (this.players.has(userId)) {
    console.log(`[Backend] Player ${username} already in room, updating connection`);
    if (this.remoteMode && ws) {
      this.wsConnections.set(userId, ws);
      console.log(`[Backend] Player ${username} WS updated`);
    }
    
    // ✅ Vérifier si on peut démarrer maintenant
    if (this.players.size === 2 && this.status === 'waiting') {
      this.startGame();
    }
    return true;
  }

  // ✅ Nouveau joueur
  if (this.players.size >= 2) {
    console.log(`[Backend] Room ${this.gameId} full`);
    return false;
  }
  
  const paddle = this.players.size === 0 ? 'left' : 'right';
  const player: Player = { id: userId, username, paddle, connected: true };
  this.players.set(userId, player);

  if (this.remoteMode && ws) {
    this.wsConnections.set(userId, ws);
    console.log(`[Backend] Player ${username} connected via WS (paddle: ${paddle})`);
  }

  console.log(`👤 Player ${username} joined ${this.gameId} (${paddle} paddle) - Total: ${this.players.size}`);
  
  // ✅ Démarrer si 2 joueurs ET les 2 ont une WS
  if (this.players.size === 2) {
    const hasAllConnections = Array.from(this.players.keys()).every(id => this.wsConnections.has(id));
    
    if (hasAllConnections) {
      console.log(`[Backend] 🎮 Both players connected with WS, starting game ${this.gameId}`);
      this.startGame();
    } else {
      console.log(`[Backend] ⏳ Waiting for all players to connect their WS...`);
    }
  } else {
    // Notifier du player_joined
    this.broadcastToClients({
      type: 'player_joined',
      gameId: this.gameId,
      data: { player },
      timestamp: Date.now(),
    });
  }
  
  return true;
}

  public removePlayer(userId: string): void {
    const player = this.players.get(userId);
    if (!player) return;
    this.wsConnections.delete(userId);
    this.players.delete(userId);
    console.log(`[Backend] Player ${player.username} left ${this.gameId}`);
    if (this.status === 'playing') {
      this.engine.pause();
      this.status = 'paused';
    }
  }

  public startGame(): void {
    if (this.players.size !== 2) {
      console.log(`[Backend] Cannot start ${this.gameId}: need 2 players (have ${this.players.size})`);
      return;
    }
    this.status = 'playing';
    this.engine.startGame();
    console.log(`[Backend] Game ${this.gameId} started!`);
    if (this.remoteMode) {
      this.broadcastToClients({
        type: 'game_started',
        gameId: this.gameId,
        data: { players: Array.from(this.players.values()) },
        timestamp: Date.now(),
      });
    }
  }

  public update(): void {
    const running = this.engine.update();
    this.lastUpdate = Date.now();
    if (this.remoteMode) this.broadcastGameState();
    if (!running && this.status !== 'ended') this.endGame();
  }

  private endGame(): void {
    this.status = 'ended';
    const winner = this.engine.getWinner();
    console.log(`[Backend] Game ${this.gameId} ended. Winner: ${winner}`);
    if (this.remoteMode) {
      this.broadcastToClients({
        type: 'game_ended',
        gameId: this.gameId,
        data: { winner, finalState: this.engine.getGameState() },
        timestamp: Date.now(),
      });
    }
  }

  private broadcastGameState(): void {
    const gameState = this.engine.getGameState();
    
    // 🔥 Log pour debug
    console.log(`[Room ${this.gameId}] Broadcasting state, ball at:`, gameState.ball);
    
    const message: GameMessage = {
      type: 'game_state',
      gameId: this.gameId,
      data: { 
        gameState: gameState,
        players: Array.from(this.players.values())
      },
      timestamp: Date.now(),
    };
    
    this.broadcastToClients(message);
  }

  private broadcastToClients(message: GameMessage): void {
    const payload = JSON.stringify(message);
    this.wsConnections.forEach((sock) => {
      if (sock.readyState === sock.OPEN) sock.send(payload);
    });
  }

  public movePaddle(player: 'left' | 'right', direction: PaddleDirection): void {
    if (this.status !== 'playing') return;
    this.engine.movePaddle(player, direction);
  }

  public pauseGame(): boolean {
    if (this.status !== 'playing') return false;
    this.engine.pause();
    console.log(`[Backend] Game ${this.gameId} paused`);
    return true;
  }

  public resumeGame(): boolean {
    if (this.status !== 'playing') return false;
    this.engine.resume();
    console.log(`[Backend] Game ${this.gameId} resumed`);
    return true;
  }
  
// APRÈS la méthode resumeGame() (ligne ~vers 170) :

  public attachSocket(userId: string, ws: WebSocket): boolean {
    if (!this.remoteMode) return false;
    if (!this.players.has(userId)) return false;

    // (Ré)attacher la socket de ce joueur
    this.wsConnections.set(userId, ws);

    // ✅ Envoyer snapshot initial
    const snapshot = {
      type: 'game_state',
      gameId: this.gameId,
      data: { 
        gameState: this.engine.getGameState(),
        players: Array.from(this.players.values())
      },
      timestamp: Date.now(),
    };
    
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(snapshot));
        console.log(`[Backend] ✅ Sent initial state to player ${userId}`);
      }
    } catch (error) {
      console.error(`[Backend] ❌ Failed to send initial state to ${userId}:`, error);
    }

    if (this.status === 'waiting' && this.players.size === 2) {
      const hasAllConnections = Array.from(this.players.keys()).every(id => this.wsConnections.has(id));
      
      if (hasAllConnections) {
        console.log(`[Backend] 🎮 All players attached, starting game ${this.gameId}`);
        this.startGame();
      }
    }
    
    return true;
  }

  // Getters
  public getGameId(): string { return this.gameId; }
  public getStatus(): 'waiting' | 'playing' | 'paused' | 'ended' { return this.status; }
  public getPlayerCount(): number { return this.players.size; }
  public getPlayers(): Player[] { return Array.from(this.players.values()); }
  public getPlayer(userId: string): Player | undefined { return this.players.get(userId); }
  public hasPlayer(userId: string): boolean { return this.players.has(userId); }
  public getGameState() { return this.engine.getGameState(); }
}
