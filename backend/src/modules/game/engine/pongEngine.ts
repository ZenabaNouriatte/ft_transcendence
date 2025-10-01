// backend/src/modules/game/engine/pongEngine.ts
// Moteur de jeu Pong migré du frontend - Version backend centralisée

import { GameState, Vector2, PaddleDirection } from './gameTypes.js';

export class PongEngine {
  private gameState: GameState;
  private gameEnded: boolean = false;
  private winner: string | null = null;
  private isPaused: boolean = false;

  // Paramètres de jeu (identiques au frontend)
  private baseSpeed: number = 5;
  private currentSpeed: number = 5;
  private lastScoreTime: number = Date.now();
  private accelerationInterval: number = 3000;   // 3 secondes
  private accelerationFactor: number = 1.2;
  private maxSpeed: number = 12;
  private readonly maxScore: number = 5;

  // Constantes de jeu
  private readonly paddleSpeed: number = 10; // Réduit de 12 à 10 pour un meilleur équilibre
  private readonly paddleHeight: number = 100;
  private readonly paddleWidth: number = 15;
  private readonly ballRadius: number = 10;

  constructor() {
    // État initial identique au frontend
    this.gameState = {
      width: 800,
      height: 400,
      ball: { x: 400, y: 200 },    // Centré
      vel: { x: 0, y: 0 },         // Immobile au démarrage
      p1: 150,                     // Paddle gauche centré
      p2: 150,                     // Paddle droite centré
      score1: 0,
      score2: 0
    };
  }

  // Démarrer la partie
  public startGame(): void {
    this.resetBall();
    this.lastScoreTime = Date.now();
    this.currentSpeed = this.baseSpeed;
    this.gameEnded = false;
    this.winner = null;
    console.log('🎮 Game started on backend!');
  }

  // Mouvement des paddles (depuis WebSocket)
  public movePaddle(player: 'left' | 'right', direction: PaddleDirection): void {
    if (this.gameEnded) return;

    const paddleKey = player === 'left' ? 'p1' : 'p2';
    let newPosition = this.gameState[paddleKey];

    switch (direction) {
      case 'up':
        newPosition = Math.max(0, newPosition - this.paddleSpeed);
        break;
      case 'down':
        newPosition = Math.min(
          this.gameState.height - this.paddleHeight, 
          newPosition + this.paddleSpeed
        );
        break;
      case 'stop':
        // Pas de changement de position
        break;
    }

    this.gameState[paddleKey] = newPosition;
  }

  // Mise à jour physique (60 FPS)
  public update(): boolean {
    if (this.gameEnded || this.isPaused) return !this.gameEnded;

    this.updateAcceleration();
    this.updateBallPhysics();
    this.checkCollisions();
    this.checkScoring();

    return !this.gameEnded; // true si le jeu continue
  }

  // --- LOGIQUE PHYSIQUE (MIGRÉE DU FRONTEND) ---

  private updateAcceleration(): void {
    const currentTime = Date.now();
    const timeSinceLastScore = currentTime - this.lastScoreTime;
    
    if (timeSinceLastScore >= this.accelerationInterval && this.currentSpeed < this.maxSpeed) {
      const newSpeed = Math.min(this.currentSpeed * this.accelerationFactor, this.maxSpeed);
      
      // Ajuster la vitesse proportionnellement
      const speedRatio = newSpeed / this.currentSpeed;
      this.gameState.vel.x *= speedRatio;
      this.gameState.vel.y *= speedRatio;
      this.currentSpeed = newSpeed;
      this.lastScoreTime = currentTime;
      
      console.log(`⚡ [Backend] Speed increased to ${this.currentSpeed.toFixed(2)}`);
    }
  }

  private updateBallPhysics(): void {
    this.gameState.ball.x += this.gameState.vel.x;
    this.gameState.ball.y += this.gameState.vel.y;

    // Rebond sur les murs haut/bas
    if (this.gameState.ball.y <= this.ballRadius || 
        this.gameState.ball.y >= this.gameState.height - this.ballRadius) {
      this.gameState.vel.y = -this.gameState.vel.y;
      // Correction de position pour éviter que la balle reste coincée
      this.gameState.ball.y = Math.max(this.ballRadius, 
        Math.min(this.gameState.height - this.ballRadius, this.gameState.ball.y));
    }
  }

  private checkCollisions(): void {
    // Collision paddle gauche (joueur 1)
    if (this.gameState.ball.x <= this.paddleWidth + this.ballRadius &&
        this.gameState.ball.y >= this.gameState.p1 &&
        this.gameState.ball.y <= this.gameState.p1 + this.paddleHeight &&
        this.gameState.vel.x < 0) {

      this.bounceOffPaddle('left');
    }

    // Collision paddle droite (joueur 2)
    if (this.gameState.ball.x >= this.gameState.width - this.paddleWidth - this.ballRadius &&
        this.gameState.ball.y >= this.gameState.p2 &&
        this.gameState.ball.y <= this.gameState.p2 + this.paddleHeight &&
        this.gameState.vel.x > 0) {

      this.bounceOffPaddle('right');
    }
  }

  private bounceOffPaddle(paddle: 'left' | 'right'): void {
    const paddleY = paddle === 'left' ? this.gameState.p1 : this.gameState.p2;
    const relativeIntersectY = (this.gameState.ball.y - (paddleY + this.paddleHeight/2)) / (this.paddleHeight/2);
    const bounceAngle = relativeIntersectY * Math.PI/3; // Max 60°
    const speed = Math.sqrt(this.gameState.vel.x ** 2 + this.gameState.vel.y ** 2);

    if (paddle === 'left') {
      this.gameState.vel.x = speed * Math.cos(bounceAngle);   // Vers la droite
      this.gameState.ball.x = this.paddleWidth + this.ballRadius; // Anti-coincé
    } else {
      this.gameState.vel.x = -speed * Math.cos(bounceAngle);  // Vers la gauche  
      this.gameState.ball.x = this.gameState.width - this.paddleWidth - this.ballRadius;
    }
    
    this.gameState.vel.y = speed * Math.sin(bounceAngle);
  }

  private checkScoring(): void {
    // Point pour joueur 2 (balle sort à gauche)
    if (this.gameState.ball.x < 0) {
      this.gameState.score2++;
      console.log(`[Backend] Player 2 scored! Score: ${this.gameState.score1} - ${this.gameState.score2}`);
      this.checkGameEnd();
      if (!this.gameEnded) this.resetBall();
    }
    
    // Point pour joueur 1 (balle sort à droite)
    if (this.gameState.ball.x > this.gameState.width) {
      this.gameState.score1++;
      console.log(`[Backend] Player 1 scored! Score: ${this.gameState.score1} - ${this.gameState.score2}`);
      this.checkGameEnd();
      if (!this.gameEnded) this.resetBall();
    }
  }

  private checkGameEnd(): void {
    if (this.gameState.score1 >= this.maxScore) {
      this.gameEnded = true;
      this.winner = 'Player 1';
      console.log('[Backend] Player 1 wins!');
    } else if (this.gameState.score2 >= this.maxScore) {
      this.gameEnded = true;
      this.winner = 'Player 2';
      console.log('[Backend] Player 2 wins!');
    }
  }

  private resetBall(): void {
    this.currentSpeed = this.baseSpeed;
    this.lastScoreTime = Date.now();
    
    this.gameState.ball.x = this.gameState.width / 2;
    this.gameState.ball.y = this.gameState.height / 2;
    
    // Direction aléatoire (gauche ou droite)
    const direction = Math.random() < 0.5 ? -1 : 1;
    const angle = (Math.random() - 0.5) * Math.PI / 3; // Entre -60° et +60°
    
    this.gameState.vel.x = direction * this.currentSpeed * Math.cos(angle);
    this.gameState.vel.y = this.currentSpeed * Math.sin(angle);
  }

  // GETTERS POUR L'API (lecture seule)
  public getGameState(): Readonly<GameState> {
    return { ...this.gameState };
  }

  public isGameEnded(): boolean {
    return this.gameEnded;
  }

  public getWinner(): string | null {
    return this.winner;
  }

  // MÉTHODES POUR PAUSE/REPRISE (NOUVEAUTÉ BACKEND)
  public pause(): void {
    this.isPaused = true;
    console.log('[Backend] Game paused');
  }

  public resume(): void {
    this.isPaused = false;
    console.log('[Backend] Game resumed');
  }

  public isPausedState(): boolean {
    return this.isPaused;
  }
}