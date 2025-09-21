// LOGIQUE DU JEU PONG

import { GameState, Vector2 } from './types.js';

// Classe principale du jeu
export class PongGame {
  // Éléments DOM
  private canvas: HTMLCanvasElement;              // Canvas HTML pour le rendu
  private ctx: CanvasRenderingContext2D;          // Contexte 2D pour dessiner
  
  // État du jeu
  private gameState: GameState;                   // État complet du jeu (balle, scores, etc.)
  private animationId: number | null = null;     // ID de l'animation requestAnimationFrame
  private keys: { [key: string]: boolean } = {}; // État des touches pressées
  
  // Système d'accélération progressive pour éviter les parties trop longues
  private baseSpeed: number = 5;                 // Vitesse de base de la balle
  private currentSpeed: number = 5;              // Vitesse actuelle de la balle
  private lastScoreTime: number = Date.now();    // Timestamp du dernier point marqué
  private accelerationInterval: number = 3000;   // Accélérer toutes les 3 secondes
  private accelerationFactor: number = 1.2;      // Augmenter de 20% à chaque fois
  private maxSpeed: number = 12;                 // Vitesse maximum pour rester jouable

  // Constructeur de la classe PongGame
  // Initialise le jeu avec un canvas HTML et configure tout l'état initial
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    
    // Initialisation de l'état du jeu
    this.gameState = {
      width: 800,                    // Largeur du terrain
      height: 400,                   // Hauteur du terrain
      ball: { x: 400, y: 200 },      // Balle parfaitement centrée
      vel: { x: 0, y: 0 },           // Balle immobile au début
      p1: 150,                       // Paddle gauche centré verticalement
      p2: 150,                       // Paddle droite centré verticalement
      score1: 0,                     // Score initial joueur 1
      score2: 0                      // Score initial joueur 2
    };

    this.setupCanvas();
    this.setupControls();
    // Dessiner l'état initial du jeu (balle centrée et immobile)
    this.draw();
  }

  // Configuration du canvas HTML
  // Définit la taille, les bordures et la couleur de fond
  private setupCanvas() {
    this.canvas.width = this.gameState.width;
    this.canvas.height = this.gameState.height;
    this.canvas.style.border = '2px solid white';
    this.canvas.style.backgroundColor = '#000';
  }

  // Configuration des contrôles clavier
  // Écoute les événements keydown/keyup pour gérer les mouvements des paddles
  private setupControls() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
    });
  }

  // Méthode de mise à jour du jeu (appelée à chaque frame)
  // Gère les mouvements des paddles, la physique de la balle, les collisions et le score
  private update() {
    const paddleSpeed = 8;    // Vitesse de déplacement des paddles
    const paddleHeight = 100; // Hauteur des paddles

    // CONTRÔLES JOUEUR 1 (PADDLE GAUCHE)
    if (this.keys['w'] || this.keys['W'] || this.keys['ArrowUp']) {
      this.gameState.p1 = Math.max(0, this.gameState.p1 - paddleSpeed);
    }
    if (this.keys['s'] || this.keys['S'] || this.keys['ArrowDown']) {
      this.gameState.p1 = Math.min(this.gameState.height - paddleHeight, this.gameState.p1 + paddleSpeed);
    }

    // CONTRÔLES JOUEUR 2 (PADDLE DROITE)
    if (this.keys['i'] || this.keys['I']) {
      this.gameState.p2 = Math.max(0, this.gameState.p2 - paddleSpeed);
    }
    if (this.keys['k'] || this.keys['K']) {
      this.gameState.p2 = Math.min(this.gameState.height - paddleHeight, this.gameState.p2 + paddleSpeed);
    }

    // SYSTÈME D'ACCÉLÉRATION PROGRESSIVE
    const currentTime = Date.now();
    const timeSinceLastScore = currentTime - this.lastScoreTime;
    
    // Debug: afficher le temps toutes les secondes (visible dans la console F12)
    if (Math.floor(timeSinceLastScore / 1000) > Math.floor((timeSinceLastScore - 16) / 1000)) {
      console.log(`⏱️ Temps sans point: ${(timeSinceLastScore/1000).toFixed(1)}s - Vitesse: ${this.currentSpeed.toFixed(2)}`);
    }
    
    // Accélérer la balle toutes les 3 secondes si pas de point marqué et si pas à la vitesse max
    if (timeSinceLastScore >= this.accelerationInterval && this.currentSpeed < this.maxSpeed) {
      const newSpeed = Math.min(this.currentSpeed * this.accelerationFactor, this.maxSpeed);
      
      // Ajuster la vitesse de la balle proportionnellement
      const speedRatio = newSpeed / this.currentSpeed;
      this.gameState.vel.x *= speedRatio;
      this.gameState.vel.y *= speedRatio;
      this.currentSpeed = newSpeed;
      this.lastScoreTime = currentTime; // Reset le timer pour la prochaine accélération
      console.log(`⚡ Vitesse augmentée ! Nouvelle vitesse: ${this.currentSpeed.toFixed(2)} (après ${(timeSinceLastScore/1000).toFixed(1)}s)`);
    }

    // PHYSIQUE DE LA BALLE
    // Mise à jour de la position de la balle selon sa vitesse
    this.gameState.ball.x += this.gameState.vel.x;
    this.gameState.ball.y += this.gameState.vel.y;

    // COLLISIONS AVEC LES MURS HAUT/BAS
    // Rebond élastique sur les murs horizontaux
    if (this.gameState.ball.y <= 10 || this.gameState.ball.y >= this.gameState.height - 10) {
      this.gameState.vel.y = -this.gameState.vel.y;
    }

    const paddleWidth = 15;  // Largeur des paddles
    const ballRadius = 10;   // Rayon de la balle

    // COLLISION AVEC PADDLE GAUCHE (JOUEUR 1)
    if (this.gameState.ball.x <= paddleWidth + ballRadius &&
        this.gameState.ball.y >= this.gameState.p1 &&
        this.gameState.ball.y <= this.gameState.p1 + paddleHeight &&
        this.gameState.vel.x < 0) { // Seulement si la balle va vers la gauche
      
      // Calcul de la position relative sur le paddle (0 = centre, -1 = haut, 1 = bas)
      const relativeIntersectY = (this.gameState.ball.y - (this.gameState.p1 + paddleHeight/2)) / (paddleHeight/2);
      
      // Calcul du nouvel angle basé sur la position d'impact (plus c'est loin du centre, plus l'angle est grand)
      const bounceAngle = relativeIntersectY * Math.PI/3; // Maximum 60 degrés
      const speed = Math.sqrt(this.gameState.vel.x * this.gameState.vel.x + this.gameState.vel.y * this.gameState.vel.y);
      
      // Application de la nouvelle vitesse avec l'angle calculé
      this.gameState.vel.x = speed * Math.cos(bounceAngle);  // Toujours vers la droite
      this.gameState.vel.y = speed * Math.sin(bounceAngle);  // Angle vertical selon l'impact
      this.gameState.ball.x = paddleWidth + ballRadius;      // Empêcher la balle de rester coincée
    }

    // COLLISION AVEC PADDLE DROITE (JOUEUR 2)
    if (this.gameState.ball.x >= this.gameState.width - paddleWidth - ballRadius &&
        this.gameState.ball.y >= this.gameState.p2 &&
        this.gameState.ball.y <= this.gameState.p2 + paddleHeight &&
        this.gameState.vel.x > 0) { // Seulement si la balle va vers la droite
      
      // Calcul de la position relative sur le paddle (0 = centre, -1 = haut, 1 = bas)
      const relativeIntersectY = (this.gameState.ball.y - (this.gameState.p2 + paddleHeight/2)) / (paddleHeight/2);
      
      // Calcul du nouvel angle basé sur la position d'impact
      const bounceAngle = relativeIntersectY * Math.PI/3; // Maximum 60 degrés
      const speed = Math.sqrt(this.gameState.vel.x * this.gameState.vel.x + this.gameState.vel.y * this.gameState.vel.y);
      
      // Application de la nouvelle vitesse avec l'angle calculé
      this.gameState.vel.x = -speed * Math.cos(bounceAngle); // Toujours vers la gauche
      this.gameState.vel.y = speed * Math.sin(bounceAngle);  // Angle vertical selon l'impact
      this.gameState.ball.x = this.gameState.width - paddleWidth - ballRadius; // Empêcher la balle de rester coincée
    }

    // SYSTÈME DE SCORE
    // Point pour le joueur 2 si la balle sort à gauche
    if (this.gameState.ball.x < 0) {
      this.gameState.score2++;
      this.resetBall();
    }
    // Point pour le joueur 1 si la balle sort à droite
    if (this.gameState.ball.x > this.gameState.width) {
      this.gameState.score1++;
      this.resetBall();
    }
  }

  // Reset de la balle au centre après un point
  // Remet aussi la vitesse à la valeur de base et reset le timer d'accélération
  private resetBall() {
    // Remettre la vitesse de base quand un point est marqué
    this.currentSpeed = this.baseSpeed;
    this.lastScoreTime = Date.now(); // Reset le timer d'accélération
    
    // Repositionner la balle au centre
    this.gameState.ball = { x: this.gameState.width / 2, y: this.gameState.height / 2 };
    
    // Donner une vitesse aléatoire à la balle (direction et angle)
    this.gameState.vel = { 
      x: Math.random() > 0.5 ? this.baseSpeed : -this.baseSpeed, // Direction aléatoire
      y: (Math.random() - 0.5) * 6  // Angle vertical aléatoire
    };
    
    console.log("Point marqué ! Vitesse remise à la base:", this.baseSpeed);
  }


  // Rendu graphique du jeu
  // Dessine tous les éléments du jeu sur le canvas
  private draw() {
    // NETTOYAGE DU CANVAS
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.gameState.width, this.gameState.height);

    // LIGNE CENTRALE POINTILLÉE
    this.ctx.setLineDash([10, 10]); // Ligne pointillée
    this.ctx.strokeStyle = '#fff';
    this.ctx.beginPath();
    this.ctx.moveTo(this.gameState.width / 2, 0);
    this.ctx.lineTo(this.gameState.width / 2, this.gameState.height);
    this.ctx.stroke();
    this.ctx.setLineDash([]); // Remettre ligne continue

    // PADDLES (RAQUETTES)
    this.ctx.fillStyle = '#fff';
    // Paddle gauche (joueur 1)
    this.ctx.fillRect(0, this.gameState.p1, 15, 100);
    // Paddle droite (joueur 2)  
    this.ctx.fillRect(this.gameState.width - 15, this.gameState.p2, 15, 100);

    // BALLE
    this.ctx.beginPath();
    this.ctx.arc(this.gameState.ball.x, this.gameState.ball.y, 10, 0, Math.PI * 2);
    this.ctx.fill();

    // AFFICHAGE DU SCORE
    this.ctx.font = '48px Arial';
    this.ctx.textAlign = 'center';
    this.ctx.fillText(
      `${this.gameState.score1}  ${this.gameState.score2}`,
      this.gameState.width / 2,
      60
    );
  }


  // Boucle principale du jeu
  // Appelle update() puis draw() à chaque frame et programme la frame suivante
  private gameLoop = () => {
    this.update();
    this.draw();
    this.animationId = requestAnimationFrame(this.gameLoop);
  }

  // Démarrage du jeu
  // Lance la boucle d'animation et donne une vitesse initiale à la balle si nécessaire
  public start() {
    if (!this.animationId) {
      // Si la balle est immobile (vitesse 0), lui donner une vitesse initiale
      if (this.gameState.vel.x === 0 && this.gameState.vel.y === 0) {
        // Initialiser le timer et la vitesse de base
        this.currentSpeed = this.baseSpeed;
        this.lastScoreTime = Date.now();
        
        // Vitesse initiale aléatoire
        this.gameState.vel = { 
          x: Math.random() > 0.5 ? this.baseSpeed : -this.baseSpeed, 
          y: (Math.random() - 0.5) * 6 
        };
      }
      this.gameLoop();
    }
  }

  // Arrêt du jeu
  // Stoppe la boucle d'animation
  public stop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }


  // Getter pour l'état du jeu
  // Permet aux autres modules d'accéder à l'état actuel (en lecture seule)
  public getGameState(): GameState {
    return { ...this.gameState }; // Copie pour éviter les modifications externes
  }
}
