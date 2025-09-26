// DÉFINITIONS DES TYPES TYPESCRIPT

// Représente un vecteur 2D utilisé pour la position de la balle et sa vitesse
export interface Vector2 { 
  x: number; 
  y: number; 
}

// Contient toutes les informations nécessaires pour le jeu
export interface GameState {
  width: number;          // Largeur du terrain de jeu (800px)
  height: number;         // Hauteur du terrain de jeu (400px)
  ball: Vector2;          // Position actuelle de la balle
  vel: Vector2;           // Vitesse actuelle de la balle (pixels par frame)
  p1: number;             // Position verticale du paddle du joueur 1
  p2: number;             // Position verticale du paddle du joueur 2
  score1: number;         // Score du joueur 1
  score2: number;         // Score du joueur 2
}

// Envoi des mouvements des joueurs (clients) au serveur
export type ClientMsg =
  | { type: "playerMove"; dir: -1 | 0 | 1 }; // -1: haut, 0: arrêt, 1: bas

// Envoie les états de jeu et synchronisation du serveur au client
export type ServerMsg =
  | { type: "startGame" }                           // Démarrage d'une partie
  | { type: "gameState"; state: GameState }        // Nouvel état du jeu
  | { type: "endGame"; winner: "p1" | "p2" };      // Fin de partie avec gagnant