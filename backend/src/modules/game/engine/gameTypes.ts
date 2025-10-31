// backend/src/modules/game/engine/gameTypes.ts
// Types et interfaces pour le moteur de jeu backend

export interface Vector2 {
  x: number;
  y: number;
}

export interface GameState {
  width: number;      // Largeur du terrain
  height: number;     // Hauteur du terrain
  ball: Vector2;      // Position de la balle
  vel: Vector2;       // Vitesse de la balle
  p1: number;         // Position Y du paddle joueur 1
  p2: number;         // Position Y du paddle joueur 2
  score1: number;     // Score joueur 1
  score2: number;     // Score joueur 2
}

export interface Player {
  id: string;  // Changé de number à string pour les IDs WebSocket
  username: string;
  paddle: 'left' | 'right';  // Quel paddle contrôle ce joueur
  connected: boolean;
  ready?: boolean;  // Statut "prêt" du joueur avant le début de la partie
}

export interface GameRoom {
  id: number;                    // ID de la partie en base
  state: GameState;              // État actuel du jeu
  players: Map<string, Player>;  // Joueurs connectés - Changé de number à string
  status: 'waiting' | 'playing' | 'paused' | 'ended';
  winner?: Player;
  createdAt: number;
  lastUpdate: number;
}

export type PaddleDirection = 'up' | 'down' | 'stop';

export interface PlayerAction {
  type: 'paddle_move';
  playerId: string; // Changé de number à string
  direction: PaddleDirection;
  timestamp: number;
}

export interface GameMessage {
  type: 'game_state' | 'game.started' | 'player_joined' | 'player_left' | 'game_ended' | 'paddle_move' | 'error';
  gameId: string;
  data: any;
  timestamp: number;
}