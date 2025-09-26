// ROUTEUR SPA (SINGLE PAGE APPLICATION)

 // Ce fichier gère toute la navigation et l'interface utilisateur de l'application.
 // Il implémente un système de routage basé sur les hash (#) de l'URL pour créer
 // une Single Page Application (SPA) avec plusieurs "pages" :

// Pages disponibles:
// - "/" (ou "") : Page d'accueil avec choix du mode de jeu
// - "#/classic" : Page de saisie des noms pour le mode classique (2 joueurs)
// - "#/tournament" : Page de création de tournoi dynamique (3-10 joueurs)
// - "#/game" : Page de jeu Pong avec canvas et contrôles
// - "#/victory" : Page de victoire avec affichage du gagnant et score final

import { GameClient } from './gameClient.js';

// Type pour une fonction qui retourne le HTML d'une page
type Route = () => string;

// Instance globale du client de jeu (null quand pas en jeu)
let currentGameClient: GameClient | null = null;


// DÉFINITION DES ROUTES ET TEMPLATES HTML
// Chaque route correspond à une "page" de l'application.
const routes: Record<string, Route> = {
  
  // PAGE D'ACCUEIL
  "": () => `
    <div class="flex flex-col items-center">
      <h1 class="text-4xl mb-8 text-center">Welcome to our Pong Game</h1>
      <div class="bg-blue-900 p-8 rounded-lg shadow-lg">
        <p class="mb-6 text-xl text-blue-300 text-center">Pick your game style</p>
        <div class="flex flex-row gap-4">
          <button id="classicBtn" class="px-8 py-4 bg-green-600 text-white text-lg rounded hover:bg-green-500 transition-colors">
            🎮 CLASSIC
          </button>
          <button id="tournamentBtn" class="px-8 py-4 bg-purple-600 text-white text-lg rounded hover:bg-purple-500 transition-colors">
            🏆 TOURNAMENT
          </button>
        </div>
      </div>
    </div>
  `,
  // PAGE MODE CLASSIC
  // Formulaire de saisie des noms des deux joueurs
  "#/classic": () => `
    <div class="flex flex-col items-center">
      <h1 class="text-3xl mb-8">Classic Mode</h1>
      <div class="bg-blue-900 p-6 rounded-lg shadow-lg max-w-2xl w-full">
        <p class="mb-6 text-blue-300 text-center">Enter players usernames:</p>
        
        <!-- Formulaire des deux joueurs en grid responsive -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label class="block text-blue-200 text-sm mb-2"><strong>Player 1</strong> (Left - W/S):</label>
            <input id="player1Input" class="w-full p-3 rounded text-black" 
                   placeholder="Player 1 username" maxlength="20">
          </div>
          
          <div>
            <label class="block text-blue-200 text-sm mb-2"><strong>Player 2</strong> (Right - I/K):</label>
            <input id="player2Input" class="w-full p-3 rounded text-black" 
                   placeholder="Player 2 username" maxlength="20">
          </div>
        </div>
        
        <button id="playBtn" class="w-full px-4 py-3 bg-green-600 text-white rounded hover:bg-green-500 transition-colors">
          🏓 START GAME
        </button>
      </div>
      <div class="mt-6">
        <button id="backBtn" class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-400">
          ← Back to menu
        </button>
      </div>
    </div>
  `,
  // PAGE TOURNAMENT - Saisie de 4 joueurs pour un tournoi
  "#/tournament": () => `
    <div class="flex flex-col items-center">
      <h1 class="text-3xl mb-8">🏆 Create Tournament 🏆</h1>
      <div class="bg-purple-900 p-8 rounded-lg shadow-lg max-w-2xl w-full">
        <p class="mb-6 text-purple-300 text-center">Enter players' usernames:</p>
        
        <!-- Liste des 4 joueurs fixes -->
        <div id="playersList" class="mb-6">
          <div class="player-entry mb-3 flex items-center gap-3">
            <span class="w-8 text-purple-200 font-bold">1.</span>
            <input type="text" class="player-input flex-1 p-3 rounded text-black" placeholder="Player 1 username" maxlength="20" data-index="0">
          </div>
          <div class="player-entry mb-3 flex items-center gap-3">
            <span class="w-8 text-purple-200 font-bold">2.</span>
            <input type="text" class="player-input flex-1 p-3 rounded text-black" placeholder="Player 2 username" maxlength="20" data-index="1">
          </div>
          <div class="player-entry mb-3 flex items-center gap-3">
            <span class="w-8 text-purple-200 font-bold">3.</span>
            <input type="text" class="player-input flex-1 p-3 rounded text-black" placeholder="Player 3 username" maxlength="20" data-index="2">
          </div>
          <div class="player-entry mb-3 flex items-center gap-3">
            <span class="w-8 text-purple-200 font-bold">4.</span>
            <input type="text" class="player-input flex-1 p-3 rounded text-black" placeholder="Player 4 username" maxlength="20" data-index="3">
          </div>
        </div>
        
        <!-- Boutons d'action -->
        <div class="flex gap-4">
          <button id="backToMenuBtn" class="flex-1 px-4 py-3 bg-gray-500 text-white rounded hover:bg-gray-400">
            ← Back to menu
          </button>
          <button id="startTournamentBtn" class="flex-1 px-4 py-3 bg-green-600 text-white rounded hover:bg-green-500 transition-colors">
            🚀 Start Tournament
          </button>
        </div>
      </div>
    </div>
  `,
  // PAGE DE TRANSITION ENTRE MATCHS DE TOURNOI
  "#/tournament-transition": () => `
    <div class="flex flex-col items-center">
      <div class="bg-purple-900 p-8 rounded-lg shadow-2xl max-w-2xl w-full text-center mb-8">
        <h1 class="text-4xl mb-6 text-white font-bold">🏆 Tournament Progress 🏆</h1>
        <div id="matchResult" class="mb-6">
          <h2 class="text-3xl mb-4 text-green-400 font-bold">Match Result</h2>
          <div id="matchWinner" class="text-2xl mb-2 text-white">Winner: <span class="font-bold">-</span></div>
          <div id="matchScore" class="text-xl mb-4 text-gray-300">Score: <span class="font-bold">-</span></div>
        </div>
        <div id="nextMatchInfo" class="mb-6">
          <h3 class="text-2xl mb-4 text-blue-400 font-bold">Next Match</h3>
          <div id="nextMatchType" class="text-xl mb-2 text-white">-</div>
          <div id="nextMatchPlayers" class="text-lg text-gray-300">- vs -</div>
        </div>
        <button id="continueToNextMatchBtn" class="px-8 py-4 bg-green-600 text-white text-xl rounded-lg hover:bg-green-500 transition-colors shadow-lg">
          🎮 Continue to Next Match
        </button>
        <div class="mt-6">
          <button id="quitTournamentBtn" class="px-6 py-2 bg-gray-600 text-white rounded hover:bg-gray-500">
            🏠 Quit Tournament
          </button>
        </div>
      </div>
    </div>
  `,
  // PAGE DE VICTOIRE
  "#/victory": () => `
    <div class="flex flex-col items-center">
      <div class="bg-gradient-to-r from-yellow-300 via-yellow-400 to-yellow-500 p-8 rounded-lg shadow-2xl max-w-2xl w-full text-center mb-8">
        <h1 class="text-5xl mb-4 text-black font-bold">🏆 VICTORY 🏆</h1>
        <h2 id="winnerName" class="text-4xl mb-6 text-black font-bold">Winner Name</h2>
        <div id="finalScore" class="text-2xl mb-8 text-black">
          Final Score: <span class="font-bold">0 - 0</span>
        </div>
        <div class="flex gap-6 justify-center">
          <button id="playAgainBtn" class="px-8 py-4 bg-green-600 text-white text-xl rounded-lg hover:bg-green-500 transition-colors shadow-lg">
            🎮 Play Again
          </button>
          <button id="backToMenuBtn" class="px-8 py-4 bg-gray-600 text-white text-xl rounded-lg hover:bg-gray-500 transition-colors shadow-lg">
            🏠 Back to Menu
          </button>
        </div>
      </div>
    </div>
  `,
  // PAGE DE JEU PONG
  "#/game": () => `
    <div class="flex flex-col items-center">
      <!-- Affichage des noms des joueurs avec contrôles -->
      <!-- Largeur fixe 800px pour correspondre exactement à la largeur du canvas -->
      <div id="playerNames" class="mb-6 text-gray-300 flex items-center justify-between" style="width: 800px; position: relative;">
        <div class="flex flex-col items-center" style="width: 200px;">
          <span id="player1Display" class="text-xl font-bold text-white">Player 1</span>
          <span class="text-sm text-gray-400">(W/S or ↑/↓)</span>
        </div>
        <!-- "VS" centré absolument -->
        <span class="text-lg text-gray-500 font-medium absolute left-1/2 transform -translate-x-1/2">VS</span>
        <div class="flex flex-col items-center" style="width: 200px;">
          <span id="player2Display" class="text-xl font-bold text-white">Player 2</span>
          <span class="text-sm text-gray-400">(I/K)</span>
        </div>
      </div>
      
      <!-- Canvas de jeu (800x400) -->
      <canvas id="pongCanvas" class="mb-4"></canvas>
      
      <!-- Bouton Start (visible au début) -->
      <div id="startSection" class="flex gap-4 mb-4">
        <button id="startBtn" class="px-8 py-4 bg-green-600 text-white text-lg rounded hover:bg-green-500 transition-colors">
          🚀 START GAME
        </button>
      </div>
      
      <!-- Boutons de contrôle du jeu (cachés au début, visibles une fois le jeu démarré) -->
      <div id="gameControls" class="hidden gap-4">
        <button id="pauseBtn" class="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-500">
          Pause
        </button>
        <button id="backToMenuBtn" class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-400">
          Back to menu
        </button>
      </div>
    </div>
  `
};

// FONCTION PRINCIPALE DE RENDU

// Cette fonction est le cœur du routeur SPA. Elle :
// 1. Lit la route actuelle (hash de l'URL)
// 2. Nettoie le jeu précédent si nécessaire
// 3. Affiche le HTML correspondant à la route
// 4. Attache les événements spécifiques à chaque page
function render() {
  const root = document.getElementById("app");
  if (!root) return;

  const route = location.hash || "";

  // Nettoyer le jeu précédent si on quitte la page de jeu
  if (currentGameClient && route !== "#/game") {
    currentGameClient.stop();
    currentGameClient = null;
  }

  // AFFICHAGE DE LA PAGE
  root.innerHTML = routes[route]();

  // GESTION DES ÉVÉNEMENTS PAR PAGE
  if (route === "") {
    // --- PAGE D'ACCUEIL ---
    // Gestion des boutons de choix du mode de jeu
    document.getElementById("classicBtn")?.addEventListener("click", () => {
      location.hash = "#/classic";
    });
    
    document.getElementById("tournamentBtn")?.addEventListener("click", () => {
      location.hash = "#/tournament";
    });
    
  } else if (route === "#/classic") {
    // PAGE MODE CLASSIC
    const player1Input = document.getElementById("player1Input") as HTMLInputElement;
    const player2Input = document.getElementById("player2Input") as HTMLInputElement;
    const playBtn = document.getElementById("playBtn");
    
    // Focus automatique sur le premier input pour une meilleure UX
    player1Input?.focus();
    
    // Fonction pour démarrer le jeu après validation des noms
    const startGame = () => {
      const player1Name = player1Input?.value.trim();
      const player2Name = player2Input?.value.trim();
      
      // Validation : noms non vides
      if (!player1Name || player1Name.length === 0) {
        alert("Please enter Player 1's name!");
        player1Input?.focus();
        return;
      }
      
      if (!player2Name || player2Name.length === 0) {
        alert("Please enter Player 2's name!");
        player2Input?.focus();
        return;
      }
      
      // Validation : noms uniques
      if (player1Name.toLowerCase() === player2Name.toLowerCase()) {
        alert("Players must have different names!");
        player2Input?.focus();
        return;
      }
      
      // Stocker les noms des deux joueurs dans localStorage
      localStorage.setItem('player1Name', player1Name);
      localStorage.setItem('player2Name', player2Name);
      
      // Marquer explicitement qu'on est en mode classique
      localStorage.setItem('currentGameMode', 'classic');
      localStorage.removeItem('tournamentPlayers'); // Nettoyer les données de tournoi précédentes
      
      location.hash = "#/game";
    };
    
    // Event listeners pour les interactions
    playBtn?.addEventListener("click", startGame);
    
    // Navigation par clavier : Entrée pour passer au champ suivant ou commencer
    player1Input?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        player2Input?.focus();
      }
    });
    
    player2Input?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        startGame();
      }
    });
    
    // Bouton retour vers le menu principal
    document.getElementById("backBtn")?.addEventListener("click", () => {
      // Nettoyer les données de jeu
      localStorage.removeItem('currentGameMode');
      location.hash = "";
    });
    
  } else if (route === "#/tournament") {
    // PAGE TOURNAMENT - Saisie de 4 joueurs pour un tournoi
    
    // Fonction pour commencer le tournoi
    async function startTournament() {
      const inputs = document.querySelectorAll(".player-input") as NodeListOf<HTMLInputElement>;
      const players: string[] = [];
      
      // Collecter les noms des 4 joueurs
      inputs.forEach(input => {
        const name = input.value.trim();
        if (name) {
          players.push(name);
        }
      });
      
      if (players.length !== 4) {
        alert("Please enter all 4 player names!");
        return;
      }
      
      // Vérifier l'unicité des noms (insensible à la casse)
      const lowercaseNames = players.map(name => name.toLowerCase());
      const uniqueNames = new Set(lowercaseNames);
      
      if (uniqueNames.size !== players.length) {
        alert("All players must have different names!");
        return;
      }
      
      // Créer le tournoi via l'API backend
      try {
        const response = await fetch('/api/tournaments/local', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ players }),
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create tournament');
        }
        
        const data = await response.json();
        
        // Sauvegarder les informations du tournoi
        localStorage.setItem("tournamentId", data.tournamentId);
        localStorage.setItem("tournamentData", JSON.stringify(data.tournament));
        localStorage.setItem("currentMatch", JSON.stringify(data.nextMatch));
        localStorage.setItem('currentGameMode', 'tournament');
        
        console.log('Tournament created:', data);
        
        // Rediriger vers la page de jeu pour le premier match
        location.hash = "#/game";
      } catch (error) {
        console.error('Error creating tournament:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        alert(`Failed to create tournament: ${errorMessage}`);
      }
    }
    
    // Navigation par clavier : Entrée pour passer au champ suivant ou démarrer
    function setupKeyboardNavigation() {
      const inputs = document.querySelectorAll(".player-input") as NodeListOf<HTMLInputElement>;
      inputs.forEach((input, index) => {
        input.addEventListener("keypress", (e: KeyboardEvent) => {
          if (e.key === "Enter") {
            // Si c'est le dernier champ et tous sont remplis, démarrer
            if (index === inputs.length - 1) {
              const allFilled = Array.from(inputs).every(inp => inp.value.trim() !== '');
              if (allFilled) {
                startTournament();
              }
            } else {
              // Sinon, passer au champ suivant
              inputs[index + 1].focus();
            }
          }
        });
      });
    }
    
    // Event listeners
    document.getElementById("startTournamentBtn")?.addEventListener("click", startTournament);
    document.getElementById("backToMenuBtn")?.addEventListener("click", () => {
      localStorage.removeItem('currentGameMode');
      location.hash = "";
    });
    
    // Configurer la navigation au clavier
    setupKeyboardNavigation();
    
    // Focus sur le premier input
    const firstInput = document.querySelector(".player-input") as HTMLInputElement;
    firstInput?.focus();
    
  } else if (route === "#/game") {
    // PAGE DE JEU PONG
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

        currentGameClient.stop();
        currentGameClient = null;
      }
      
      // INITIALISATION DU CLIENT DE JEU

      currentGameClient = new GameClient(canvas);
      
      // Variables pour tracker les états du jeu
      let gameStarted = false;
      let isPaused = false;
      
      // GESTION DU BOUTON START
      document.getElementById("startBtn")?.addEventListener("click", async () => {
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
            console.error('Failed to start game:', error);
            alert('Failed to connect to game server. Please try again.');
          }
        }
      });
      
      // GESTION DU BOUTON PAUSE/RESUME (désactivé pour le moment car non supporté par le backend)
      const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
      if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.textContent = "Pause";
        pauseBtn.title = "Pause not available in online mode";
      }
      
      // BOUTON RETOUR AU MENU PRINCIPAL
      document.getElementById("backToMenuBtn")?.addEventListener("click", () => {
        // Nettoyer les données de jeu
        localStorage.removeItem('currentGameMode');
        location.hash = "";
      });
    }
  } else if (route === "#/victory") {
    // PAGE DE VICTOIRE
    // Récupérer les données de la partie depuis localStorage
    const winnerName = localStorage.getItem('winnerName') || 'Unknown Player';
    const finalScore = localStorage.getItem('finalScore') || '0 - 0';
    const gameMode = localStorage.getItem('gameMode') || 'classic';
    
    // Afficher les informations de victoire
    const winnerElement = document.getElementById('winnerName');
    const scoreElement = document.getElementById('finalScore');
    
    if (winnerElement) {
      winnerElement.textContent = winnerName;
    }
    
    if (scoreElement) {
      scoreElement.innerHTML = `Final Score: <span class="font-bold">${finalScore}</span>`;
    }
    
    // Gestion du bouton "Play Again"
    document.getElementById("playAgainBtn")?.addEventListener("click", () => {
      // Nettoyer les données de victoire
      localStorage.removeItem('winnerName');
      localStorage.removeItem('finalScore');
      
      // Rediriger vers le mode de jeu approprié
      if (gameMode === 'tournament') {
        location.hash = "#/tournament";
      } else {
        location.hash = "#/classic";
      }
    });
    
    // Gestion du bouton "Back to Menu"
    document.getElementById("backToMenuBtn")?.addEventListener("click", () => {
      // Nettoyer les données de victoire
      localStorage.removeItem('winnerName');
      localStorage.removeItem('finalScore');
      localStorage.removeItem('gameMode');
      localStorage.removeItem('currentGameMode'); // Nettoyer aussi le mode de jeu courant
      location.hash = "";
    });
  
  } else if (route === "#/tournament-transition") {
    // PAGE DE TRANSITION ENTRE MATCHS DE TOURNOI
    
    // Récupérer les données du match terminé et du suivant
    const lastMatchResult = JSON.parse(localStorage.getItem('lastMatchResult') || '{}');
    const nextMatchInfo = JSON.parse(localStorage.getItem('currentMatch') || '{}');
    
    // Afficher le résultat du match précédent
    const matchWinner = document.getElementById('matchWinner');
    const matchScore = document.getElementById('matchScore');
    if (matchWinner && lastMatchResult.winner) {
      matchWinner.innerHTML = `Winner: <span class="font-bold text-green-400">${lastMatchResult.winner}</span>`;
    }
    if (matchScore && lastMatchResult.scores) {
      matchScore.innerHTML = `Score: <span class="font-bold">${lastMatchResult.scores.winner} - ${lastMatchResult.scores.loser}</span>`;
    }
    
    // Afficher les informations du match suivant
    const nextMatchType = document.getElementById('nextMatchType');
    const nextMatchPlayers = document.getElementById('nextMatchPlayers');
    
    if (nextMatchInfo.type === 'finished') {
      // Le tournoi est terminé
      if (nextMatchType) {
        nextMatchType.textContent = '🏆 Tournament Complete!';
      }
      if (nextMatchPlayers) {
        nextMatchPlayers.innerHTML = `Champion: <span class="text-yellow-400 font-bold">${nextMatchInfo.winner}</span>`;
      }
      
      const continueBtn = document.getElementById('continueToNextMatchBtn');
      if (continueBtn) {
        continueBtn.textContent = '🏆 View Championship';
        continueBtn.addEventListener('click', () => {
          location.hash = '#/victory';
        });
      }
    } else {
      // Match suivant
      if (nextMatchType) {
        const matchTypeText = nextMatchInfo.type === 'final' ? '🏆 FINAL' : 
                             nextMatchInfo.type === 'semifinal' ? `🔥 Semi-Final ${nextMatchInfo.number}` : 
                             'Next Match';
        nextMatchType.textContent = matchTypeText;
      }
      if (nextMatchPlayers && nextMatchInfo.players) {
        nextMatchPlayers.innerHTML = `<span class="text-blue-400">${nextMatchInfo.players[0]}</span> vs <span class="text-red-400">${nextMatchInfo.players[1]}</span>`;
      }
      
      // Bouton pour continuer
      document.getElementById('continueToNextMatchBtn')?.addEventListener('click', () => {
        localStorage.removeItem('lastMatchResult'); // Nettoyer les données du match précédent
        location.hash = '#/game';
      });
    }
    
    // Bouton pour quitter le tournoi
    document.getElementById('quitTournamentBtn')?.addEventListener('click', () => {
      // Nettoyer toutes les données de tournoi
      localStorage.removeItem('tournamentId');
      localStorage.removeItem('tournamentData');
      localStorage.removeItem('currentMatch');
      localStorage.removeItem('currentGameMode');
      localStorage.removeItem('lastMatchResult');
      location.hash = '';
    });
  }
}

// INITIALISATION DU ROUTEUR SPA

// Lancer le rendu au chargement de la page
window.addEventListener("DOMContentLoaded", render);

// Lancer le rendu à chaque changement de hash (navigation)
window.addEventListener("hashchange", render);