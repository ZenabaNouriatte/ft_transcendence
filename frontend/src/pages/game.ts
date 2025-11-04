import { GameClient } from '../game/gameClient.js';

// Variable globale pour tracker le client de jeu actuel
let currentGameClient: GameClient | null = null;
let gameKeyListener: ((event: KeyboardEvent) => void) | null = null;

/**
 * Retourne le HTML de la page de jeu
 */
export function getGameHTML(): string {
  return `
    <div class="flex flex-col items-center">
      <!-- Affichage des noms des joueurs avec contrôles -->
      <!-- Largeur fixe 800px pour correspondre exactement à la largeur du canvas -->
      <div id="playerNames" class="mb-6 text-gray-800 flex items-center justify-between" style="width: 800px; position: relative;">
        <div class="flex flex-col items-center" style="width: 200px;">
          <span id="player1Display" class="text-xl font-bold text-black">Player 1</span>
          <span class="text-sm text-blue-900">(W/S or ↑/↓)</span>
        </div>
        <!-- "VS" centré absolument -->
        <span class="text-lg text-blue-900 font-medium absolute left-1/2 transform -translate-x-1/2">VS</span>
        <div class="flex flex-col items-center" style="width: 200px;">
          <span id="player2Display" class="text-xl font-bold text-black">Player 2</span>
          <span class="text-sm text-blue-900">(I/K)</span>
        </div>
      </div>
      
      <!-- Canvas de jeu (800x400) -->
      <canvas id="pongCanvas" class="mb-4"></canvas>
      
      <!-- Bouton Start (visible au début) -->
      <div id="startSection" class="flex gap-4 mb-4">
        <button id="startBtn" class="retro-btn">
          <img class="btn-icon" src="/images/classic.png" alt="Play">START GAME
        </button>
      </div>
      
      <!-- Boutons de contrôle du jeu (cachés au début, visibles une fois le jeu démarré) -->
      <div id="gameControls" class="hidden gap-4">
        <button id="pauseBtn" class="retro-btn-small hover-blue">
          Pause
        </button>
        <button id="backToMenuBtn" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `;
}

/**
 * Attache les event listeners de la page de jeu
 */
export function attachGameEvents() {
  const canvas = document.getElementById("pongCanvas") as HTMLCanvasElement;
  
  let player1Name: string;
  let player2Name: string;
  let isTournamentMode = false;
  let currentMatchInfo: any = null;
  
  // Vérifier si on est en mode tournoi
  const currentGameMode = localStorage.getItem('currentGameMode');
  if (currentGameMode === 'tournament') {
    const currentMatchString = localStorage.getItem('currentMatch');
    if (currentMatchString) {
      currentMatchInfo = JSON.parse(currentMatchString);
      isTournamentMode = true;
      
      // Récupérer les joueurs du match actuel
      player1Name = currentMatchInfo.players[0];
      player2Name = currentMatchInfo.players[1];
      

    } else {
      // Fallback si pas d'info de match
      const tournamentPlayers = JSON.parse(localStorage.getItem('tournamentPlayers') || '[]');
      player1Name = tournamentPlayers[0] || 'Player 1';
      player2Name = tournamentPlayers[1] || 'Player 2';

    }
  } else {
    // Mode classique
    player1Name = localStorage.getItem('player1Name') || 'Player 1';
    player2Name = localStorage.getItem('player2Name') || 'Player 2';

  }
  
  // Sauvegarder les noms pour le jeu actuel
  localStorage.setItem('player1Name', player1Name);
  localStorage.setItem('player2Name', player2Name);
  
  // Affichage des noms des joueurs dans l'interface
  const player1Display = document.getElementById('player1Display');
  const player2Display = document.getElementById('player2Display');
  
  if (player1Display) {
    player1Display.textContent = player1Name;
  }
  if (player2Display) {
    player2Display.textContent = player2Name;
  }
  
  if (canvas) {
    // Nettoyer le client de jeu précédent s'il existe
    if (currentGameClient) {
      currentGameClient.stop().then(() => {
        currentGameClient = null;
      });
    }
    
    // INITIALISATION DU CLIENT DE JEU

    currentGameClient = new GameClient(canvas);
    
    // Variables pour tracker les états du jeu
    let gameStarted = false;
    let isPaused = false;
    
    // Fonction pour démarrer le jeu
    const startGame = async () => {
      if (currentGameClient && !gameStarted) {
        try {
          await currentGameClient.start();
          gameStarted = true;
          
          // Masquer la section start et afficher les contrôles
          const startSection = document.getElementById("startSection");
          const gameControls = document.getElementById("gameControls");
          
          if (startSection) startSection.style.display = "none";
          if (gameControls) {
            gameControls.classList.remove("hidden");
            gameControls.classList.add("flex");
          }
        } catch (error) {
          alert('Failed to connect to game server. Please try again.');
        }
      }
    };

    // GESTION DU BOUTON START
    document.getElementById("startBtn")?.addEventListener("click", startGame);
    
    // GESTION DE LA TOUCHE ENTRÉE POUR DÉMARRER LE JEU
    gameKeyListener = (event: KeyboardEvent) => {
      if (event.key === "Enter" && !gameStarted) {
        event.preventDefault();
        startGame();
      }
    };
    
    // Ajouter l'écouteur de clavier
    document.addEventListener("keydown", gameKeyListener);

    // BOUTON RETOUR AU MENU PRINCIPAL
    document.getElementById("backToMenuBtn")?.addEventListener("click", async () => {
      // ✅ IMPORTANT: Arrêter et annuler la partie côté backend AVANT de changer de page
      if (currentGameClient) {
        await currentGameClient.stop();
        currentGameClient = null;
      }
      
      // Nettoyer les données de jeu
      localStorage.removeItem('currentGameMode');
      location.hash = "";
    });
  }
}

// Export du client pour pouvoir le nettoyer
export function cleanupGameClient() {
  if (currentGameClient) {
    currentGameClient.stop();
    currentGameClient = null;
  }
  if (gameKeyListener) {
    document.removeEventListener("keydown", gameKeyListener);
    gameKeyListener = null;
  }
}
