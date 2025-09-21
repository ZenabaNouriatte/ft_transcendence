// ROUTEUR SPA (SINGLE PAGE APPLICATION)

 // Ce fichier gère toute la navigation et l'interface utilisateur de l'application.
 // Il implémente un système de routage basé sur les hash (#) de l'URL pour créer
 // une Single Page Application (SPA) avec plusieurs "pages" :

// Pages disponibles:
// - "/" (ou "") : Page d'accueil avec choix du mode de jeu
// - "#/classic" : Page de saisie des noms pour le mode classique (2 joueurs)
// - "#/tournament" : Page tournament (en construction)
// - "#/game" : Page de jeu Pong avec canvas et contrôles

import { PongGame } from './pong.js';

// Type pour une fonction qui retourne le HTML d'une page
type Route = () => string;

// Instance globale du jeu Pong (null quand pas en jeu)
let currentGame: PongGame | null = null;


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
  // PAGE TOURNAMENT
  "#/tournament": () => `
    <div class="flex flex-col items-center">
      <h1 class="text-3xl mb-8">Tournament Mode</h1>
      <div class="bg-purple-900 p-6 rounded-lg shadow-lg max-w-md">
        <p class="mb-4 text-purple-300 text-center">🚧 Coming Soon! 🚧</p>
        <p class="text-sm text-purple-200 mb-6 text-center">
          Je suis sûr le coup hihi. Bon weekend !
        </p>
        <button id="backToMenuBtn" class="w-full px-4 py-3 bg-gray-500 text-white rounded hover:bg-gray-400">
          ← Back to menu
        </button>
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
  if (currentGame && route !== "#/game") {
    currentGame.stop();
    currentGame = null;
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
      
      if (player1Name && player1Name.length > 0 && player2Name && player2Name.length > 0) {
        // Stocker les noms des deux joueurs dans localStorage
        localStorage.setItem('player1Name', player1Name);
        localStorage.setItem('player2Name', player2Name);
        location.hash = "#/game";
      } else {
        alert("Please enter both players names!");
        if (!player1Name) {
          player1Input?.focus();
        } else {
          player2Input?.focus();
        }
      }
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
      location.hash = "";
    });
    
  } else if (route === "#/tournament") {
    // PAGE TOURNAMENT
    document.getElementById("backToMenuBtn")?.addEventListener("click", () => {
      location.hash = "";
    });
    
  } else if (route === "#/game") {
    // PAGE DE JEU PONG
    const canvas = document.getElementById("pongCanvas") as HTMLCanvasElement;
    
    // Récupération des noms des joueurs depuis localStorage
    const player1Name = localStorage.getItem('player1Name') || 'Player 1';
    const player2Name = localStorage.getItem('player2Name') || 'Player 2';
    
    // Affichage des noms des joueurs dans l'interface
    const player1Display = document.getElementById('player1Display');
    const player2Display = document.getElementById('player2Display');
    
    if (player1Display) player1Display.textContent = player1Name;
    if (player2Display) player2Display.textContent = player2Name;
    
    if (canvas) {
      // INITIALISATION DU JEU
      currentGame = new PongGame(canvas);
      // Le jeu se met en pause immédiatement (balle centrée et immobile)
      currentGame.stop();
      
      // Variables pour tracker les états du jeu
      let gameStarted = false;
      let isPaused = false;
      
      // GESTION DU BOUTON START
      document.getElementById("startBtn")?.addEventListener("click", () => {
        if (currentGame && !gameStarted) {
          currentGame.start();
          gameStarted = true;
          
          // Masquer la section start et afficher les contrôles
          const startSection = document.getElementById("startSection");
          const gameControls = document.getElementById("gameControls");
          
          if (startSection) startSection.style.display = "none";
          if (gameControls) {
            gameControls.classList.remove("hidden");
            gameControls.classList.add("flex");
          }
        }
      });
      
      // GESTION DU BOUTON PAUSE/RESUME
      document.getElementById("pauseBtn")?.addEventListener("click", () => {
        if (currentGame && gameStarted) {
          const btn = document.getElementById("pauseBtn") as HTMLButtonElement;
          
          if (!isPaused) {
            // Mettre en pause
            currentGame.stop();
            btn.textContent = "Resume";
            isPaused = true;
          } else {
            // Reprendre le jeu
            currentGame.start();
            btn.textContent = "Pause";
            isPaused = false;
          }
        }
      });
      
      // BOUTON RETOUR AU MENU PRINCIPAL
      document.getElementById("backToMenuBtn")?.addEventListener("click", () => {
        location.hash = "";
      });
    }
  }
}

// INITIALISATION DU ROUTEUR SPA

// Lancer le rendu au chargement de la page
window.addEventListener("DOMContentLoaded", render);

// Lancer le rendu à chaque changement de hash (navigation)
window.addEventListener("hashchange", render);
