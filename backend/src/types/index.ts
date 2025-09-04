
// Types Frontend/Backend 
// a completer selon les besoin

// ===== ENTITES DE BASE =====
export interface User {
  id: number;
  username: string;
  email?: string;
  created_at: string; // ISO date
}

export interface Game {
  id: number;
  status: 'waiting' | 'playing' | 'finished';
  created_at: string;
}

// ===== WEBSOCKET =====
export interface WSMessage<T = any> {
  type: string;           // ex: "chat.message", "game.input"
  data: T;               // charge utile
  requestId?: string;    // pour tracer les reponse
}

// Messages WS courants a completer
export interface ChatMessage {
  text: string;
  roomId?: string;
  userId?: number;
}

export interface GameInput {
  action: string;        // "join", "move", "quit"...
  payload?: any;         // specifique a l'action
}

// ===== REPONSES API =====
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

// ===== TYPES UTILITAIRES =====
export type GameStatus = Game['status'];
export type WSMessageType = 
  | 'chat.message' 
  | 'game.input' 
  | 'user.join'
  | 'error'
  | 'ack';

