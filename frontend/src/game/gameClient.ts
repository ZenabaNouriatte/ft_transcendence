import { GameState, Vector2 } from '../types.js';

// Client de jeu qui communique avec le backend via HTTP
export class GameClient {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gameState: GameState | null = null;
  private previousGameState: GameState | null = null;
  private lastStateUpdateTime: number = 0;
  private stateUpdateInterval: number = 33; // Attendu à 30 FPS
  private gameId: string | null = null;
  private isPlaying: boolean = false;
  private isPaused: boolean = false; // Pour gérer la pause
  private isTogglingPause: boolean = false; // anti double-clic pendant l'appel fetch
  private pausedGameState: GameState | null = null; // État sauvegardé pendant la pause
  private animationId: number | null = null;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  // États des touches pour les contrôles
  private keys: { [key: string]: boolean } = {};
  private lastPaddleActions: { p1: string | null, p2: string | null } = { p1: null, p2: null };
  private lastControlUpdate: number = 0;
  private controlUpdateInterval: number = 8; // Envoyer les contrôles toutes les 8ms (~120 FPS pour fluidité max)

  private currentBackoff: number = 1000; // Start avec 1 seconde
  private lastSuccessfulFetch: number = 0;
  private errorCount: number = 0;
  private readonly MAX_ERROR_COUNT: number = 5;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    
    this.setupCanvas();
    this.setupControls();
    this.setupPauseButton();  
    this.drawInitialState(); // Afficher l'état initial
  }

  private setupPauseButton() {
    const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement | null;
    if (!pauseBtn) return;

    pauseBtn.disabled = false;        // au cas où le routeur l'avait désactivé
    pauseBtn.textContent = "Pause";
    pauseBtn.title = "";

    pauseBtn.addEventListener("click", async () => {
      if (this.isTogglingPause) return; // évite les spams
      this.isTogglingPause = true;

      try {
        if (!this.isPaused) {
          // (option serveur) on tente de pauser côté backend
          if (this.gameId) {
            try { 
              console.log("🔴 Sending PAUSE request to server...");
              const response = await fetch(`/api/games/${this.gameId}/pause`, { method: "POST" });
              console.log("🔴 Server PAUSE response:", response.status, response.ok);
            } 
            catch (e) { console.warn("Pause server failed; local pause only.", e); }
          }
          // pause locale
          this.stopRenderLoop();
          this.stopPolling();
          this.isPaused = true;
          // Sauvegarder l'état actuel pour potentielle restauration
          if (this.gameState) {
            this.pausedGameState = { ...this.gameState };
            console.log("🔴 PAUSE - Ball position saved:", { x: this.gameState.ball.x, y: this.gameState.ball.y });
          }
          pauseBtn.textContent = "Resume";
          console.log("Game paused");
        } else {
          // (option serveur) on tente de reprendre côté backend
          if (this.gameId) {
            try { 
              console.log("🟢 Sending RESUME request to server...");
              const response = await fetch(`/api/games/${this.gameId}/resume`, { method: "POST" });
              console.log("🟢 Server RESUME response:", response.status, response.ok);
            } 
            catch (e) { console.warn("Resume server failed; local resume only.", e); }
          }
          // reprise locale
          this.isPaused = false;
          // Réinitialiser l'interpolation pour éviter les glitchs
          this.previousGameState = null;
          
          // Récupérer l'état actuel du serveur
          await this.fetchGameState();
          
          // Si le serveur ne gère pas la pause correctement, on pourrait restaurer l'état sauvé
          // Pour l'instant on log pour debug
          if (this.gameState && this.pausedGameState) {
            const deltaX = Math.abs(this.gameState.ball.x - this.pausedGameState.ball.x);
            const deltaY = Math.abs(this.gameState.ball.y - this.pausedGameState.ball.y);
            console.log("🟢 RESUME - Ball moved during pause:", { 
              paused: this.pausedGameState.ball, 
              current: this.gameState.ball, 
              delta: { x: deltaX, y: deltaY } 
            });
            
            // Si la balle a bougé de plus de 50px pendant la pause, c'est suspect
            if (deltaX > 50 || deltaY > 50) {
              console.warn("⚠️ Server didn't pause correctly! Ball moved too much during pause.");
            }
          }
          
          this.pausedGameState = null; // Nettoyer
          this.startRenderLoop();
          this.startPolling();
          pauseBtn.textContent = "Pause";
          console.log("Game resumed");
        }
      } finally {
        this.isTogglingPause = false;
      }
    });
  }

  // Configuration du canvas
  private setupCanvas() {
    this.canvas.width = 800;
    this.canvas.height = 400;
    this.canvas.style.border = '2px solid white';
    this.canvas.style.backgroundColor = '#000';
  }

  // Configuration des contrôles clavier
  private setupControls() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.key] = true;
    });

    document.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
    });
  }

  // Vérifier les contrôles à chaque frame (appelé dans la boucle de rendu)
  private updateControls() {
    const now = Date.now();
    
    // Throttle les updates de contrôles (20 FPS au lieu de 60 FPS pour éviter le spam)
    if (now - this.lastControlUpdate < this.controlUpdateInterval) {
      return;
    }
    
    this.lastControlUpdate = now;
    this.handleInput();
  }

  // Gestion des inputs et envoi au serveur via HTTP
  private async handleInput() {
    if (!this.gameId || !this.isPlaying) return;

    // Déterminer l'action pour le joueur 1 (touches WASD et flèches)
    let p1Action: string | null = null;
    if (this.keys['w'] || this.keys['W'] || this.keys['ArrowUp']) {
      p1Action = 'up';
    } else if (this.keys['s'] || this.keys['S'] || this.keys['ArrowDown']) {
      p1Action = 'down';
    }

    // Déterminer l'action pour le joueur 2 (touches I/K)
    let p2Action: string | null = null;
    if (this.keys['i'] || this.keys['I']) {
      p2Action = 'up';
    } else if (this.keys['k'] || this.keys['K']) {
      p2Action = 'down';
    }

    // Envoyer seulement les actions actives (pas de "stop")
    if (p1Action) {
      await this.sendPaddleAction(1, p1Action);
    }
    
    if (p2Action) {
      await this.sendPaddleAction(2, p2Action);
    }
  }

  // Envoyer un mouvement de paddle via HTTP
  private async sendPaddleAction(player: 1 | 2, direction: string) {
    try {
      await fetch(`/api/games/${this.gameId}/paddle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player, direction })
      });
    } catch (error) {
      console.error('Error sending paddle action:', error);
    }
  }

  // Créer une partie via l'API REST
// Dans gameClient.ts, méthode createGame() - remplacez l'URL :

  private async createGame(): Promise<string> {
    try {
      const player1Name = localStorage.getItem('player1Name') || 'Player 1';
      const player2Name = localStorage.getItem('player2Name') || 'Player 2';
      
      // Récupérer le token s'il existe (pour que le backend puisse autoriser l'utilisateur connecté)
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      // CHANGEMENT: utiliser /api/games/local au lieu de /api/games
      const response = await fetch('/api/games/local', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          player1: player1Name,
          player2: player2Name,
          type: 'pong'
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorData.error || 'Unknown error'}`);
      }

      const data = await response.json();
      console.log('Game created successfully:', data);
      return data.gameId;
    } catch (error) {
      console.error('Failed to create game:', error);
      throw error;
    }
  }

  // Démarrer le jeu via l'API
  private async startGameOnServer(): Promise<void> {
    try {
      const response = await fetch(`/api/games/${this.gameId}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log('Game started on server');
    } catch (error) {
      console.error('Failed to start game on server:', error);
      throw error;
    }
  }

//Recup l'etat du jeu via http
// Ajouter ces propriétés dans la classe GameClient

private async fetchGameState(): Promise<void> {
    // Protection anti-spam - attendre au moins 50ms entre requêtes
    const now = Date.now();
    if (now - this.lastSuccessfulFetch < 50) {
        return;
    }

    try {
        console.log('Fetching game state for ID:', this.gameId);
        const response = await fetch(`/api/games/${this.gameId}/state`);
        
        if (!response.ok) {
            await this.handleNetworkError(response.status);
            return;
        }

        // Reset du compteur d'erreurs en cas de succès
        this.errorCount = 0;
        this.currentBackoff = 1000;
        this.lastSuccessfulFetch = Date.now();

        const data = await response.json();
        console.log('Received game state:', data);
        
        const newGameState = data.gameState || data;
        
        // Détecter si la balle a été resetée (changement brusque de position)
        const isBallReset = this.gameState && this.previousGameState && 
            Math.abs(newGameState.ball.x - this.gameState.ball.x) > 200;
        
        if (isBallReset) {
            console.log('Ball reset detected, skipping interpolation');
            this.previousGameState = null;
        } else {
            this.previousGameState = this.gameState;
        }
        
        this.gameState = newGameState;
        this.lastStateUpdateTime = Date.now();
        
        // Vérifier si le jeu est terminé
        if (data.status === 'ended' && data.gameState) {
            console.log('Game ended, redirecting to victory page');
            this.handleGameEnd(data.gameState);
        }
    } catch (error) {
        await this.handleNetworkError('network_error');
    }
}

private async handleNetworkError(errorType: string | number): Promise<void> {
    this.errorCount++;
    
    console.warn(`Network error (${errorType}), count: ${this.errorCount}`);
    
    // Arrêter le polling temporairement
    if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
    }
    
    // Backoff exponentiel avec limite
    this.currentBackoff = Math.min(this.currentBackoff * 1.5, 10000); // Max 10 secondes
    
    // Si trop d'erreurs, arrêter complètement
    if (this.errorCount >= this.MAX_ERROR_COUNT) {
        console.error('Too many network errors, stopping game');
        this.stop();
        return;
    }
    
    console.log(`Retrying in ${this.currentBackoff}ms...`);
    
    // Redémarrer après le backoff
    setTimeout(() => {
        if (this.isPlaying && !this.isPaused) {
            this.startPolling();
        }
    }, this.currentBackoff);
}


  // Gérer la fin du jeu
  private async handleGameEnd(finalGameState?: any) {
    // Arrêter le jeu
    this.stop();
    
    // Utiliser le gameState final passé en paramètre ou celui en cours
    const gameState = finalGameState || this.gameState;
    console.log('Final game state for victory:', gameState);
    
    // Déterminer le gagnant
    const score1 = gameState?.score1 || 0;
    const score2 = gameState?.score2 || 0;
    const player1Name = localStorage.getItem('player1Name') || 'Player 1';
    const player2Name = localStorage.getItem('player2Name') || 'Player 2';
    
    console.log(`Final scores: ${player1Name}: ${score1}, ${player2Name}: ${score2}`);
    
    const winner = score1 > score2 ? player1Name : player2Name;
    const loser = score1 > score2 ? player2Name : player1Name;
    const finalScore = `${score1} - ${score2}`;
    
    // Vérifier si on est en mode tournoi
    const currentGameMode = localStorage.getItem('currentGameMode');
    if (currentGameMode === 'tournament') {
      await this.handleTournamentMatchEnd(winner, loser, { winner: Math.max(score1, score2), loser: Math.min(score1, score2) });
    } else {
      // Mode classique - sauvegarder le jeu et aller à la page de victoire
      
      // Sauvegarder le résultat du jeu en base de données
      const gameId = localStorage.getItem('currentGameId');
      if (gameId && (window as any).finishGame) {
        try {
          await (window as any).finishGame(parseInt(gameId), score1, score2);
          console.log(`Game ${gameId} saved with scores: ${score1} - ${score2}`);
        } catch (error) {
          console.error('Error saving game to database:', error);
        }
      }
      
      localStorage.setItem('winnerName', winner);
      localStorage.setItem('finalScore', finalScore);
      localStorage.setItem('gameMode', 'classic');
      
      console.log(`Victory data stored: winner=${winner}, score=${finalScore}`);
      location.hash = "#/victory";
    }
  }
  
  // Gérer la fin d'un match de tournoi
  private async handleTournamentMatchEnd(winner: string, loser: string, scores: { winner: number; loser: number }) {
    console.log('🏆 TOURNAMENT: Handling match end...', { winner, loser, scores });
    
    try {
      const tournamentId = localStorage.getItem('tournamentId');
      if (!tournamentId) {
        console.error('❌ TOURNAMENT: No tournament ID found');
        return;
      }
      
      console.log(`🏆 TOURNAMENT: Submitting result to /api/tournaments/local/${tournamentId}/match-result`);
      
      // Envoyer le résultat au backend
      const response = await fetch(`/api/tournaments/local/${tournamentId}/match-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          winner,
          loser,
          scores
        }),
      });
      
      console.log(`🏆 TOURNAMENT: Response status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ TOURNAMENT: Failed to submit match result:', errorText);
        throw new Error(`Failed to submit match result: ${errorText}`);
      }
      
      const data = await response.json();
      console.log('🏆 TOURNAMENT: Match result submitted successfully:', data);
      
      // Mettre à jour les données du tournoi
      localStorage.setItem('tournamentData', JSON.stringify(data.tournament));
      
      if (data.nextMatch) {
        if (data.nextMatch.type === 'finished') {
          // Tournoi terminé !
          console.log('🏆 TOURNAMENT: Tournament finished!', data.nextMatch);
          localStorage.setItem('winnerName', data.nextMatch.winner);
          localStorage.setItem('finalScore', 'Tournament Winner');
          localStorage.setItem('gameMode', 'tournament');
          localStorage.removeItem('tournamentId');
          localStorage.removeItem('tournamentData');
          localStorage.removeItem('currentMatch');
          localStorage.removeItem('currentGameMode');
          
          console.log(`🏆 TOURNAMENT: Redirecting to victory page with winner: ${data.nextMatch.winner}`);
          location.hash = "#/victory";
        } else {
          // Match suivant - aller à la page de transition
          console.log('🏆 TOURNAMENT: Next match found:', data.nextMatch);
          localStorage.setItem('currentMatch', JSON.stringify(data.nextMatch));
          localStorage.setItem('lastMatchResult', JSON.stringify({
            winner,
            loser,
            scores
          }));
          
          console.log(`🏆 TOURNAMENT: Redirecting to tournament-transition page`);
          location.hash = "#/tournament-transition";
        }
      } else {
        console.error('❌ TOURNAMENT: No nextMatch data received');
        throw new Error('No nextMatch data received from server');
      }
    } catch (error) {
      console.error('❌ TOURNAMENT: Error handling tournament match end:', error);
      // Fallback vers la page de victoire normale
      localStorage.setItem('winnerName', winner);
      localStorage.setItem('finalScore', `${scores.winner} - ${scores.loser}`);
      localStorage.setItem('gameMode', 'tournament');
      location.hash = "#/victory";
    }
  }

  // Boucle de rendu
  private startRenderLoop() {
    if (this.animationId !== null) return; 
    const render = () => {
      if (this.isPlaying) {
        this.updateControls(); // Vérifier les contrôles à chaque frame
        this.draw();
        this.animationId = requestAnimationFrame(render);
      }
    };
    render();
  }

  // Arrêter la boucle de rendu
  private stopRenderLoop() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  // Démarrer le polling de l'état du jeu
  private startPolling() {
    if (this.pollingInterval !== null) return;
    this.pollingInterval = setInterval(() => {
      if (this.isPlaying) {
        this.fetchGameState();
      }
    }, 66); // 66ms = ~15 FPS au lieu de 33ms
  }

  // Arrêter le polling
  private stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  // Dessiner le jeu
  // Méthode d'interpolation linéaire pour un rendu fluide
  private lerp(start: number, end: number, factor: number): number {
    return start + (end - start) * factor;
  }

  private draw() {
    console.log('Drawing game state:', this.gameState);
    if (!this.gameState) {
      console.log('No game state available, drawing initial state');
      this.drawInitialState();
      return;
    }

    // Calculer le facteur d'interpolation pour un rendu plus fluide
    const now = Date.now();
    const timeSinceUpdate = now - this.lastStateUpdateTime;
    
    // Si trop de temps s'est écoulé (ex: après une pause), ne pas interpoler
    const maxInterpolationTime = 100; // 100ms max
    const shouldInterpolate = timeSinceUpdate < maxInterpolationTime;
    const interpolationFactor = shouldInterpolate ? Math.min(timeSinceUpdate / (1000 / 30), 1) : 1;

    const state = this.gameState;
    const ctx = this.ctx;

    // Interpoler les positions si on a un état précédent
    let p1Pos = state.p1;
    let p2Pos = state.p2;
    let ballX = state.ball.x;
    let ballY = state.ball.y;

    if (this.previousGameState && interpolationFactor < 1 && !this.isPaused && shouldInterpolate) {
      // Interpolation linéaire entre l'état précédent et actuel (seulement si pas en pause)
      p1Pos = this.lerp(this.previousGameState.p1, state.p1, interpolationFactor);
      p2Pos = this.lerp(this.previousGameState.p2, state.p2, interpolationFactor);
      
      // Vérifier si la balle ne fait pas un saut trop important (éviter les glitchs)
      const ballDistanceX = Math.abs(state.ball.x - this.previousGameState.ball.x);
      const ballDistanceY = Math.abs(state.ball.y - this.previousGameState.ball.y);
      
      if (ballDistanceX < 50 && ballDistanceY < 50) { // Seulement interpoler si mouvement raisonnable
        ballX = this.lerp(this.previousGameState.ball.x, state.ball.x, interpolationFactor);
        ballY = this.lerp(this.previousGameState.ball.y, state.ball.y, interpolationFactor);
      }
    }

    // Effacer le canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, state.width, state.height);

    // Dessiner les éléments
    ctx.fillStyle = '#fff';

    // Ligne centrale
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(state.width / 2, 0);
    ctx.lineTo(state.width / 2, state.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Paddles avec positions interpolées
    ctx.fillRect(10, p1Pos, 15, 100); // Paddle gauche
    ctx.fillRect(state.width - 25, p2Pos, 15, 100); // Paddle droite

    // Balle avec position interpolée
    ctx.beginPath();
    ctx.arc(ballX, ballY, 10, 0, Math.PI * 2);
    ctx.fill();

    // Scores
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(state.score1.toString(), state.width / 4, 60);
    ctx.fillText(state.score2.toString(), (state.width * 3) / 4, 60);
  }

  // Dessiner l'état initial du jeu (avant de cliquer sur START)
  private drawInitialState() {
    const ctx = this.ctx;
    
    // Effacer le canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 800, 400);

    // Dessiner les éléments initiaux
    ctx.fillStyle = '#fff';

    // Ligne centrale
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    ctx.moveTo(400, 0);
    ctx.lineTo(400, 400);
    ctx.stroke();
    ctx.setLineDash([]);

    // Paddles à leur position initiale (centrés)
    ctx.fillRect(10, 150, 15, 100); // Paddle gauche centré
    ctx.fillRect(775, 150, 15, 100); // Paddle droite centré

    // Balle au centre
    ctx.beginPath();
    ctx.arc(400, 200, 10, 0, Math.PI * 2);
    ctx.fill();

    // Scores initiaux
    ctx.font = '48px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('0', 200, 60);
    ctx.fillText('0', 600, 60);
  }

  // Démarrer le jeu (méthode publique)
  async start(): Promise<void> {
    try {
      console.log('Starting game client...');
      
      // 1. Créer une partie
      this.gameId = await this.createGame();
      console.log('Game created with ID:', this.gameId);

      // 2. Démarrer le jeu sur le serveur
      console.log('Starting game on server...');
      await this.startGameOnServer();

      // 3. Récupérer l'état initial
      console.log('Fetching initial game state...');
      await this.fetchGameState();

      // 4. Petit délai pour laisser le serveur s'initialiser
      await new Promise(resolve => setTimeout(resolve, 100));

      // 5. Commencer le jeu côté client
      this.isPlaying = true;
      this.isPaused = false;                                      // ✅ reset
      const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement | null;
      if (pauseBtn) pauseBtn.textContent = "Pause";
      this.startRenderLoop();
      this.startPolling();

      console.log('Game client started successfully');
    } catch (error) {
      console.error('Failed to start game client:', error);
      alert('Failed to start game. Please try again.');
    }
  }

  // Arrêter le jeu
  async stop() {
    this.isPlaying = false;
    this.stopRenderLoop();
    this.stopPolling();
    
    // ✅ Annuler la partie côté backend pour éviter qu'elle continue de tourner
    if (this.gameId) {
      try {
        await fetch(`/api/games/${this.gameId}/cancel`, { method: 'POST' });
        console.log('Game cancelled on backend:', this.gameId);
      } catch (error) {
        console.error('Failed to cancel game on backend:', error);
      }
    }
    
    this.gameId = null;
    this.gameState = null;
  }
}