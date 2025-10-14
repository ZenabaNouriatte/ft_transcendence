// ROUTEUR SPA (SINGLE PAGE APPLICATION)

 // Ce fichier gère toute la navigation et l'interface utilisateur de l'application.
 // Il implémente un système de routage basé les hash (#) de l'URL pour créer
 // une Single Page Application (SPA) avec plusieurs "pages" :

// Pages disponibles:
// - "/" (ou "") : Page d'accueil avec choix du mode de jeu
// - "#/classic" : Page de saisie des noms pour le mode classique (2 joueurs)
// - "#/tournament" : Page de création de tournoi dynamique (3-10 joueurs)
// - "#/game" : Page de jeu Pong avec canvas et contrôles
// - "#/victory" : Page de victoire avec affichage du gagnant et score final

import { GameClient } from './gameClient.js';
console.log('[build] routeurSPA loaded @', new Date().toISOString());

function wsUrl(channel: 'chat' | 'game-remote', token: string) {
  return `wss://${location.host}/ws?channel=${channel}&token=${encodeURIComponent(token)}`;
}

// ===== Presence WS (singleton) =====
const Presence = (() => {
  let sock: WebSocket | null = null;
  let token: string | null = null;
  let reconnectTimer: number | null = null;

  function wsUrl(t: string) {
    // même host/port que la page -> OK derrière nginx
    return `wss://${location.host}/ws?channel=chat&token=${encodeURIComponent(t)}`;
  }

  function connect(t: string) {
    token = t;
    disconnect();
    if (!token) return;

    const u = wsUrl(token);
    sock = new WebSocket(u);

    sock.onopen = () => console.log('[presence]✅ WebSocket opened');
    sock.onmessage = (e) => console.log('[presence] msg:', e.data);
    sock.onclose = (e) => {
      console.log('[presence] ❌ WebSocket closed:', e.code, e.reason);
      sock = null;
      if (token && reconnectTimer === null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect(token!);
        }, 2000);
      }
    };
    sock.onerror = (e) => console.warn('[presence] ⚠️ WebSocket error:', e);
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sock && sock.readyState === WebSocket.OPEN) { 
      try { 
        sock.close(1000, 'bye'); 
        console.log('[presence] 🔌 Explicit disconnect');
      } catch {} 
    }
    sock = null;
  }

  function clear() {
    token = null;
    disconnect();
  }

  return { connect, disconnect, clear };
})();

window.addEventListener('beforeunload', () => {
  console.log('[presence] 🚪 Page closing, disconnecting WebSocket...');
  Presence.disconnect();
});

function bootPresenceFromStorage() {
  const t = localStorage.getItem('token');
  console.log('[bootPresence] token in storage =', !!t);
  if (t) Presence.connect(t);
  // Fermer proprement la WS quand l'onglet se ferme (ne touche pas au token)
  window.addEventListener('beforeunload', () => {
    try { Presence.disconnect(); } catch {}
  });
}

// put this near your Presence block, top of routeurSPA.ts
async function syncAuthFromBackend(): Promise<void> {
  var t = localStorage.getItem('token');
  if (!t) {
    // pas loggé : nettoie juste le nom local
    localStorage.removeItem('currentUsername');
    return;
  }

  try {
    var r = await fetch('/api/users/me', {
      headers: { 'Authorization': 'Bearer ' + t }
    });

    if (!r.ok) {
      // token invalide → purge
      localStorage.removeItem('token');
      localStorage.removeItem('currentUsername');
      return;
    }

    var data = await r.json();
    var user = data && data.user ? data.user : null;

    if (user && user.username) {
      localStorage.setItem('currentUsername', user.username);
    } else {
      localStorage.removeItem('currentUsername');
    }
  } catch (_e) {
    // en cas d'erreur réseau, on ne casse pas l'app
    console.warn('GET /api/users/me error');
  }
}



// Type pour une fonction qui retourne le HTML d'une page
type Route = () => string;

// Instance globale du client de jeu (null quand pas en jeu)
let currentGameClient: GameClient | null = null;

// Fonction pour obtenir l'avatar basé sur l'ID utilisateur (correspondance directe)
function getUserAvatarPath(userId: number): string {
  // ID direct: user 1 → image 1.JPG, user 2 → image 2.JPG, etc.
  // Si l'ID dépasse 15, on boucle (modulo)
  const imageNumber = userId > 15 ? ((userId - 1) % 15) + 1 : userId;
  return `/images/${imageNumber}.JPG`;
}

// Fonction pour récupérer l'ID utilisateur via API
async function getCurrentUserId(): Promise<number> {
  const t = localStorage.getItem('token');
  if (!t) return 1; // invité

  try {
    const r = await fetch('/api/users/me', {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (!r.ok) {
      // optional: also clear stale name
      localStorage.removeItem('currentUsername');
      return 1;
    }
    const { user } = await r.json();
    if (user?.id && user?.username) {
      localStorage.setItem('currentUsername', user.username); // keep name fresh
      return user.id;
    }
    localStorage.removeItem('currentUsername');
    return 1;
  } catch (e) {
    console.warn('getCurrentUserId:', e);
    localStorage.removeItem('currentUsername');
    return 1;
  }
}



// Référence à l'écouteur de clavier pour pouvoir le nettoyer
let gameKeyListener: ((event: KeyboardEvent) => void) | null = null;


// DÉFINITION DES ROUTES ET TEMPLATES HTML
// Chaque route correspond à une "page" de l'application.
const routes: Record<string, Route> = {
  
  // PAGE D'ACCUEIL
  "": () => {
    // Vérifier si un utilisateur est connecté
    const currentUsername = localStorage.getItem('currentUsername');
    const isLoggedIn = currentUsername && currentUsername !== 'Guest';
    
    // Debug pour voir l'état de connexion
    console.log('Home page render - Username:', currentUsername, 'IsLoggedIn:', isLoggedIn);
    
    // Générer les boutons d'authentification selon l'état de connexion
    const authButtons = isLoggedIn 
      ? `<!-- Bouton utilisateur connecté en haut à droite -->
         <div class="fixed top-8 right-8 z-10">
           <button id="userProfileBtn" class="retro-btn hover-blue flex items-center gap-2">
             <div id="userMiniAvatar" class="mini-avatar" style="background-image: url('/images/1.JPG')"></div>
             ${currentUsername}
           </button>
         </div>`
      : `<!-- Boutons Login/Sign Up en haut à droite de la fenêtre -->
         <div class="fixed top-8 right-8 flex gap-3 z-10">
           <button id="loginBtn" class="retro-btn">
             Login
           </button>
           <button id="signUpBtn" class="retro-btn">
             Sign Up
           </button>
         </div>`;

    return `
    <div class="min-h-screen">
      ${authButtons}
      
      <!-- Contenu principal centré -->
      <div class="flex flex-col items-center justify-center min-h-screen">
        <img src="/images/titre.png" alt="Pong Game Logo" class="main-logo">
        <div class="game-selection-box">
          <p class="game-selection-text">Pick your game style</p>
          <div class="game-buttons-container">
            <button id="classicBtn" class="retro-btn hover-green">
              <img class="btn-icon" src="/images/classic.png" alt="Classic">CLASSIC
            </button>
            <button id="remoteBtn" class="retro-btn hover-blue">
              <img class="btn-icon" src="/images/titre2.png" alt="Remote">REMOTE
            </button>
            <button id="tournamentBtn" class="retro-btn hover-orange">
              <img class="btn-icon" src="/images/tournament.png" alt="Tournament">TOURNAMENT
            </button>
          </div>
        </div>
      </div>
    </div>
    `;
  },
  // PAGE MODE CLASSIC
  // Formulaire de saisie des noms des deux joueurs
  "#/classic": () => `
    <div class="flex flex-col items-center">
      <h1 class="page-title-large page-title-green">Classic</h1>
      <div class="form-box-green">
        <p class="form-description-green">Enter players' usernames:</p>
        
        <!-- Formulaire des deux joueurs en grid responsive -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label class="form-label"><span class="player-label-green">Player 1</span> (Left - W/S):</label>
            <input id="player1Input" class="styled-input" 
                   placeholder="Player 1 username" maxlength="20">
          </div>
          
          <div>
            <label class="form-label"><span class="player-label-green">Player 2</span> (Right - I/K):</label>
            <input id="player2Input" class="styled-input" 
                   placeholder="Player 2 username" maxlength="20">
          </div>
        </div>
        
        <button id="playBtn" class="retro-btn hover-green w-full">
          <img class="btn-icon" src="/images/classic.png" alt="Play">START GAME
        </button>
      </div>
      <div class="mt-6">
        <button id="backBtn" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `,
  // PAGE TOURNAMENT - Saisie de 4 joueurs pour un tournoi
  "#/tournament": () => `
    <div class="flex flex-col items-center">
      <h1 class="page-title-large page-title-orange">Tournament</h1>
      <div class="form-box-orange">
        <p class="form-description-orange">Enter players' usernames:</p>
        
        <!-- Liste des 4 joueurs fixes -->
        <div id="playersList" class="mb-6">
          <div class="player-entry mb-4 flex items-center gap-3">
            <span class="w-8 player-number-orange">1.</span>
            <input type="text" class="player-input styled-input flex-1" placeholder="Player 1 username" maxlength="20" data-index="0">
          </div>
          <div class="player-entry mb-4 flex items-center gap-3">
            <span class="w-8 player-number-orange">2.</span>
            <input type="text" class="player-input styled-input flex-1" placeholder="Player 2 username" maxlength="20" data-index="1">
          </div>
          <div class="player-entry mb-4 flex items-center gap-3">
            <span class="w-8 player-number-orange">3.</span>
            <input type="text" class="player-input styled-input flex-1" placeholder="Player 3 username" maxlength="20" data-index="2">
          </div>
          <div class="player-entry mb-4 flex items-center gap-3">
            <span class="w-8 player-number-orange">4.</span>
            <input type="text" class="player-input styled-input flex-1" placeholder="Player 4 username" maxlength="20" data-index="3">
          </div>
        </div>
        
        <button id="startTournamentBtn" class="retro-btn hover-orange w-full">
          <img class="btn-icon" src="/images/tournament.png" alt="Tournament">Start Tournament
        </button>
      </div>
      <div class="mt-6">
        <button id="backToMenuBtn" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `,
  "#/remote": () => {
    const currentUsername = localStorage.getItem('currentUsername');
    const isLoggedIn = currentUsername && currentUsername !== 'Guest';

    if (!isLoggedIn) {
      setTimeout(() => { location.hash = "#/login"; }, 100);
      return '<div class="flex items-center justify-center min-h-screen"><p class="text-xl">Redirecting to login...</p></div>';
    }

    return `
      <div class="flex flex-col items-center">
        <h1 class="page-title-large page-title-blue">Remote Play</h1>
        <div class="form-box-blue max-w-2xl">
          <p class="form-description-blue mb-6">Play against another player on a different computer</p>
          
          <!-- Créer une partie -->
          <div class="mb-6 p-4 bg-blue-50 rounded-lg">
            <h3 class="text-lg font-bold mb-2 text-blue-800">Host a Game</h3>
            <p class="text-sm text-gray-600 mb-3">Create a game and wait for an opponent to join</p>
            <button id="createRemoteBtn" class="retro-btn hover-blue w-full">
              Create Game & Wait
            </button>
            <div id="waitingMessage" class="hidden mt-3 p-3 bg-yellow-100 border border-yellow-300 rounded text-center">
              <p class="font-bold">⏳ Waiting for opponent...</p>
              <p class="text-sm text-gray-600">Game ID: <span id="gameIdDisplay" class="font-mono">-</span></p>
            </div>
          </div>

          <!-- Rejoindre une partie -->
          <div class="p-4 bg-green-50 rounded-lg">
            <h3 class="text-lg font-bold mb-2 text-green-800">Join a Game</h3>
            <p class="text-sm text-gray-600 mb-3">Select a game from the list below</p>
            <button id="refreshListBtn" class="retro-btn-small hover-green mb-3">
              🔄 Refresh List
            </button>
            <div id="gamesList" class="space-y-2 min-h-[100px]">
              <p class="text-gray-500 text-center">Click refresh to load available games</p>
            </div>
          </div>
        </div>
        
        <div class="mt-6">
          <button id="backToMenuRemote" class="retro-btn-small hover-blue">
            Back to Menu
          </button>
        </div>
      </div>
    `;
  },
  // PAGE DE TRANSITION ENTRE MATCHS DE TOURNOI
  "#/tournament-transition": () => `
    <div class="flex flex-col items-center">
      <h1 class="page-title-large page-title-orange">Tournament Progress</h1>
      <div class="form-box-orange">
        <div id="matchResult" class="mb-6">
          <div id="matchWinner" class="text-xl mb-2 text-center form-description-orange">Winner: <span class="font-bold">-</span></div>
          <div id="matchScore" class="text-lg mb-4 text-center player-number-orange">Score: <span class="font-bold">-</span></div>
        </div>
        
        <div class="border-t border-orange-300 pt-6 mb-6">
          <div id="nextMatchInfo">
            <div id="nextMatchType" class="text-xl mb-2 text-center form-description-orange">-</div>
            <div id="nextMatchPlayers" class="text-lg text-center player-number-orange">- vs -</div>
          </div>
        </div>
        
        <button id="continueToNextMatchBtn" class="retro-btn hover-orange w-full mb-4">
          Continue to Next Match
        </button>
      </div>
      <div class="mt-6">
        <button id="quitTournamentBtn" class="retro-btn-small hover-red">
          Quit Tournament
        </button>
      </div>
    </div>
  `,
  // PAGE DE VICTOIRE
  "#/victory": () => `
    <div class="flex flex-col items-center">
      <div class="bg-yellow-300 bg-opacity-70 p-12 rounded-3xl shadow-2xl max-w-4xl w-full text-center mb-8">
        <h1 class="page-title-winner" style="color: #000;">VICTORY</h1>
        <h2 id="winnerName" class="page-title-winner" style="color: #000;">Winner Name</h2>
        <div id="finalScore" class="page-title-score" style="color: #000;">
          Final Score: <span class="font-bold">0 - 0</span>
        </div>
        <div class="flex gap-8 justify-center">
          <button id="playAgainBtn" class="retro-btn hover-classic">
            <img class="btn-icon" src="/images/classic.png" alt="Play">Play Again
          </button>
          <button id="backToMenuBtn" class="retro-btn hover-classic">
            Back to Menu
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
  `,
  // PAGE INSCRIPTION
  "#/sign-up": () => `
    <div class="flex flex-col items-center justify-center min-h-screen">
      <h1 class="page-title-large page-title-brown">Sign Up</h1>
      <div class="form-box-auth">
        <form id="signUpForm" class="space-y-4">
          <div>
            <label for="username" class="auth-label">Username</label>
            <input type="text" id="username" name="username" required
              class="styled-input"
              placeholder="Enter your username">
          </div>
          
          <div>
            <label for="email" class="auth-label">Email</label>
            <input type="email" id="email" name="email" required
              class="styled-input"
              placeholder="Enter your email">
          </div>
          
          <div>
            <label for="password" class="auth-label">Password</label>
            <input type="password" id="password" name="password" required
              class="styled-input"
              placeholder="Enter your password">
          </div>
          
          <button type="submit" id="signUpSubmit"
            class="retro-btn w-full">
            Create Account
          </button>
        </form>
        
        <div class="mt-6 text-center auth-navigation-container">
          <span class="auth-navigation-text">Already have an account? </span>
          <a href="#/login" class="auth-navigation-link">Login here</a>
        </div>
      </div>
      
      <div class="mt-6 text-center">
        <button id="backToMenuSignup" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `,
  // PAGE CONNEXION
  "#/login": () => `
    <div class="flex flex-col items-center justify-center min-h-screen">
      <h1 class="page-title-large page-title-brown">Login</h1>
      <div class="form-box-auth">
        <form id="loginForm" class="space-y-4">
          <div>
            <label for="loginUsername" class="auth-label">Username</label>
            <input type="text" id="loginUsername" name="username" required
              class="styled-input"
              placeholder="Enter your username">
          </div>
          
          <div>
            <label for="loginPassword" class="auth-label">Password</label>
            <input type="password" id="loginPassword" name="password" required
              class="styled-input"
              placeholder="Enter your password">
          </div>
          
          <button type="submit" id="loginSubmit"
            class="retro-btn w-full">
            Login
          </button>
        </form>
        
        <div class="mt-6 text-center auth-navigation-container">
          <span class="auth-navigation-text">Don't have an account? </span>
          <a href="#/sign-up" class="auth-navigation-link">Sign up here</a>
        </div>
      </div>
      
      <div class="mt-6 text-center">
        <button id="backToMenuLogin" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `,
  // PAGE PROFIL
  "#/profile": () => {
    const currentUsername = localStorage.getItem('currentUsername') || 'Player';
    
    // Rendu initial avec image placeholder (sera mise à jour via JS)
    return `
    <div class="min-h-screen">
      <!-- Bouton retour à l'accueil en haut à gauche -->
      <div class="fixed top-8 left-8 z-10">
        <button id="backToHomeBtn" class="retro-btn flex items-center gap-2">
          ← Home
        </button>
      </div>
      
      <!-- Contenu principal centré -->
      <div class="flex flex-col items-center justify-center min-h-screen">
        <!-- Photo de profil avec image dynamique -->
        <div class="profile-photo">
          <img id="profileAvatar" src="/images/1.JPG" alt="Profile Photo" 
               style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
        </div>
        <h1 id="profileUsername" class="page-title-winner page-title-blue text-center">${currentUsername}</h1>
        <div class="form-box-blue">
          <h2 class="text-2xl mb-6 text-gray-800 text-center">Profile Information</h2>
          <!-- Informations du profil à développer -->
          <div class="space-y-4 text-gray-700">
            <p class="text-center text-gray-600">Je suis sur le coup hihi patience ! :3</p>
          </div>
          
          <!-- Bouton de déconnexion -->
          <div class="mt-6 pt-4 border-t border-gray-300">
            <button id="logoutBtn" class="retro-btn w-full">
              Logout
            </button>
          </div>
        </div>
      </div>
    </div>
    `;
  },
  // PAGE AMIS
  "#/friends": () => `
    <div class="flex flex-col items-center justify-center min-h-screen">
      <h1 class="text-3xl mb-8">Friends</h1>
      <div class="bg-white bg-opacity-90 p-8 rounded shadow-lg w-full max-w-md">
        <!-- Liste des amis à venir -->
      </div>
    </div>
  `,
  // PAGE PROFIL D'UN AMI
  "#/friends-profile": () => `
    <div class="flex flex-col items-center justify-center min-h-screen">
      <h1 class="text-3xl mb-8">Friend's Profile</h1>
      <div class="bg-white bg-opacity-90 p-8 rounded shadow-lg w-full max-w-md">
        <!-- Profil d'un ami à venir -->
      </div>
    </div> 
  `,
  "#/game-remote": () => `
  <div class="flex flex-col items-center">
    <div id="playerNamesRemote" class="mb-6 text-gray-300 flex items-center justify-between" style="width: 800px; position: relative;">
      <div class="flex flex-col items-center" style="width: 200px;">
        <span id="pLeftName" class="text-xl font-bold text-white">Left</span>
        <span class="text-sm text-gray-400">(W/S)</span>
      </div>
      <span class="text-lg text-gray-500 font-medium absolute left-1/2 transform -translate-x-1/2">VS</span>
      <div class="flex flex-col items-center" style="width: 200px;">
        <span id="pRightName" class="text-xl font-bold text-white">Right</span>
        <span class="text-sm text-gray-400">(↑/↓)</span>
      </div>
    </div>

    <canvas id="remoteCanvas" class="mb-4"></canvas>

    <div class="flex gap-4">
      <button id="backFromRemote" class="retro-btn-small hover-blue">Back to Menu</button>
    </div>
  </div>
`
};

// FONCTION PRINCIPALE DE RENDU
function render() {
  const root = document.getElementById("app");
  if (!root) return;

  const route = location.hash || "";

  // Nettoyer le jeu précédent si on quitte la page de jeu
  if (currentGameClient && route !== "#/game") {
    currentGameClient.stop();
    currentGameClient = null;
  }

  // Nettoyer l'écouteur de clavier si on quitte la page de jeu
  if (gameKeyListener && route !== "#/game") {
    document.removeEventListener("keydown", gameKeyListener);
    gameKeyListener = null;
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

    document.getElementById("remoteBtn")?.addEventListener("click", () => {
      location.hash = "#/remote";
    });

    
    // Vérifier si un utilisateur est connecté pour adapter les événements
    const currentUsername = localStorage.getItem('currentUsername');
    const isLoggedIn = currentUsername && currentUsername !== 'Guest';
    
    console.log('Home page events - Username:', currentUsername, 'IsLoggedIn:', isLoggedIn);
    
    if (isLoggedIn) {
      // Utilisateur connecté : bouton profil
      document.getElementById("userProfileBtn")?.addEventListener("click", () => {
        location.hash = "#/profile";
      });

      // Charger l'avatar de l'utilisateur dans le mini bouton
      async function loadUserMiniAvatar() {
        try {
          const userId = await getCurrentUserId();
          const avatarPath = getUserAvatarPath(userId);
          const miniAvatar = document.getElementById('userMiniAvatar') as HTMLElement;
          
          if (miniAvatar) {
            miniAvatar.style.backgroundImage = `url('${avatarPath}')`;
            console.log(`Mini avatar chargé: User ID ${userId} → ${avatarPath}`);
          }
        } catch (error) {
          console.error('Erreur lors du chargement du mini avatar:', error);
        }
      }

      // Charger le mini avatar
      loadUserMiniAvatar();
    } else {
      // Utilisateur non connecté : boutons login/signup
      document.getElementById("loginBtn")?.addEventListener("click", () => {
        location.hash = "#/login";
      });
      
      document.getElementById("signUpBtn")?.addEventListener("click", () => {
        location.hash = "#/sign-up";
      });
    }
    
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
            console.error('Failed to start game:', error);
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
    } else if (route === "#/remote") {
  // --- PAGE REMOTE PLAY ---
  const currentUsername = localStorage.getItem('currentUsername');
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');

  if (!currentUsername || !token) {
    location.hash = "#/login";
    return;
  }

  let ws: WebSocket | null = null;
  let currentGameId: string | null = null;

  // DOM helpers
  function byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el as T;
  }

  // Connecter le WebSocket
  function connectWebSocket(): WebSocket {
    if (ws && ws.readyState === WebSocket.OPEN) return ws;

    const HOST = location.hostname;
    const wsUrl = `wss://${HOST}:8443/ws?channel=game-remote&token=${encodeURIComponent(token!)}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[Remote] WebSocket connected');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log('[Remote] Received:', msg);

        switch (msg.type) {
          case 'game.created': {
            // ✅ HOST : Rester sur #/remote en attente
            currentGameId = msg.data?.gameId || msg.gameId || null;
            if (currentGameId) {
              byId<HTMLSpanElement>('gameIdDisplay').textContent = currentGameId;
              byId<HTMLDivElement>('waitingMessage').classList.remove('hidden');
              console.log('[Remote] Game created, waiting for opponent...');
            }
            break;
          }

          case 'game.joined': {
            // ✅ CHALLENGER : Confirmation du join (pas de redirect ici)
            console.log('[Remote] Successfully joined game');
            break;
          }

          case 'game_started': {
            // ✅ LES DEUX : Rediriger vers le jeu maintenant
            const gid = msg.data?.gameId || msg.gameId || currentGameId || '';
            if (!gid) {
              console.error('[Remote] game_started without gameId');
              break;
            }
            
            localStorage.setItem('remoteGameId', gid);
            localStorage.setItem('currentGameMode', 'remote');
            
            console.log('[Remote] Game starting! Redirecting to game...');
            
            // Fermer cette WS (une nouvelle sera créée sur #/game-remote)
            try { 
              if (ws) {
                ws.close(1000, 'game_starting'); 
                ws = null;
              }
            } catch {}
            
            // Petit délai pour éviter race condition
            setTimeout(() => {
              location.hash = '#/game-remote';
            }, 100);
            break;
          }

          case 'game.waiting_list': {
            displayGamesList(msg.data?.rooms || []);
            break;
          }

          case 'error': {
            console.error('[Remote] Error:', msg.data?.message);
            alert('Error: ' + (msg.data?.message || 'Unknown error'));
            break;
          }

          default:
            console.log('[Remote] Unhandled message type:', msg.type);
            break;
        }
      } catch (err) {
        console.error('[Remote] Failed to parse message:', err);
      }
    };
    return ws;

  }  // Afficher la liste des parties disponibles
  function displayGamesList(rooms: Array<{ gameId: string; hostUsername: string; createdAt: number }>) {
    const listEl = byId<HTMLDivElement>('gamesList');

    if (!rooms.length) {
      listEl.innerHTML = '<p class="text-gray-500 text-center">No games available. Create one!</p>';
      return;
    }

    listEl.innerHTML = rooms.map(room => `
      <div class="flex items-center justify-between p-3 bg-white rounded border border-green-300">
        <div>
          <p class="font-bold text-green-800">${room.hostUsername}'s game</p>
          <p class="text-xs text-gray-500">Created ${new Date(room.createdAt).toLocaleTimeString()}</p>
        </div>
        <button class="joinGameBtn retro-btn-small hover-green" data-game-id="${room.gameId}">
          Join
        </button>
      </div>
    `).join('');

    // Attacher les événements de clic
    document.querySelectorAll<HTMLButtonElement>('.joinGameBtn').forEach(btn => {
      btn.addEventListener('click', () => {
        const gid = btn.dataset.gameId!;
        joinRemoteGame(gid);
      });
    });
  }

  // Créer une partie remote
  function createRemoteGame() {
    const sock = connectWebSocket();
    sock.send(JSON.stringify({
      type: 'game.create_remote',
      data: { username: currentUsername },
      requestId: Date.now().toString()
    }));
    byId<HTMLButtonElement>('createRemoteBtn').setAttribute('disabled', 'true');
  }

  // Rejoindre une partie remote
  function joinRemoteGame(gameId: string) {
    const sock = connectWebSocket();
    sock.send(JSON.stringify({
      type: 'game.join_remote',
      data: { gameId, username: currentUsername },
      requestId: Date.now().toString()
    }));
  }

  // Rafraîchir la liste des rooms
  function refreshList() {
    const sock = connectWebSocket();
    sock.send(JSON.stringify({
      type: 'game.list_waiting',
      requestId: Date.now().toString()
    }));
  }

  // Wire UI
  const createBtn = document.getElementById('createRemoteBtn');
  if (createBtn) createBtn.addEventListener('click', createRemoteGame);

  const refreshBtn = document.getElementById('refreshListBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', refreshList);

  const backBtn = document.getElementById('backToMenuRemote');
  if (backBtn) backBtn.addEventListener('click', () => {
    try { ws?.close(); } catch {}
    location.hash = '';
  });

  // Connecte la WS immédiatement
  connectWebSocket();

  // ✅ AJOUTER CE CLEANUP
  window.addEventListener('hashchange', () => {
    if (location.hash !== '#/remote') {
      console.log('[Remote] Leaving lobby, closing WS');
      try { 
        if (ws) {
          ws.close(1000, 'leaving_lobby');
          ws = null;
        }
      } catch {}
    }
  }, { once: true });
  } else if (route === "#/game-remote") {
  const canvas = document.getElementById("remoteCanvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const token = sessionStorage.getItem('token') || localStorage.getItem('token');
  const gameId = localStorage.getItem('remoteGameId');
  const host = location.hostname;
  const wsUrl = `wss://${host}:8443/ws?channel=game-remote&token=${encodeURIComponent(token || "")}`;

  if (!token || !gameId) {
    alert("Missing token or gameId. Go back to Remote lobby.");
    location.hash = "#/remote";
    return;
  }

  let W = 800, H = 400;
  canvas.width = W; canvas.height = H;

  let ws: WebSocket | null = null;
  let myPaddle: 'left' | 'right' | null = null;
  let leftName = 'Left', rightName = 'Right';
  let pressedUp = false, pressedDown = false;
  let lastSent: 'up' | 'down' | 'stop' = 'stop';

  const setNames = () => {
    const l = document.getElementById('pLeftName'); if (l) l.textContent = leftName;
    const r = document.getElementById('pRightName'); if (r) r.textContent = rightName;
  };
  setNames();

  function draw(state: any) {
    if (!state) return;
    
    W = state.width || 800; 
    H = state.height || 400;
    
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    
    // Filet central
    ctx.globalAlpha = 0.2; 
    ctx.fillStyle = "#fff";
    for (let y=0; y<H; y+=20) ctx.fillRect(W/2-1, y, 2, 10);
    ctx.globalAlpha = 1;
    
    // Scores
    ctx.fillStyle = "#fff"; 
    ctx.font = "bold 24px monospace"; 
    ctx.textAlign = "center";
    ctx.fillText(`${state.score1 ?? 0}`, W*0.25, 40);
    ctx.fillText(`${state.score2 ?? 0}`, W*0.75, 40);
    
    // Paddles
    const padH = 100, padW = 15;
    ctx.fillRect(10, Math.max(0, Math.min(H-padH, state.p1 || 0)), padW, padH);
    ctx.fillRect(W-25, Math.max(0, Math.min(H-padH, state.p2 || 0)), padW, padH);
    
    // Balle
    ctx.beginPath(); 
    ctx.arc(state.ball?.x || W/2, state.ball?.y || H/2, 10, 0, Math.PI*2); 
    ctx.fill();
  }

  function maybeSendInput() {
    if (!ws || ws.readyState !== ws.OPEN || !myPaddle) return;
    let want: 'up' | 'down' | 'stop' = 'stop';
    if (pressedUp && !pressedDown) want = 'up';
    else if (pressedDown && !pressedUp) want = 'down';
    if (want !== lastSent) {
      ws.send(JSON.stringify({ 
        type: "game.paddle_move", 
        data: { gameId, direction: want }, 
        requestId: Date.now().toString() 
      }));
      lastSent = want;
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') { 
      pressedUp = true; 
      maybeSendInput(); 
    }
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') { 
      pressedDown = true; 
      maybeSendInput(); 
    }
  }
  
  function onKeyUp(e: KeyboardEvent) {
    if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') { 
      pressedUp = false; 
      maybeSendInput(); 
    }
    if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') { 
      pressedDown = false; 
      maybeSendInput(); 
    }
  }

  async function myUserId(): Promise<string | null> {
    try {
      const r = await fetch('/api/users/me', { 
        headers: { Authorization: `Bearer ${token}` } 
      });
      if (!r.ok) return null;
      const js = await r.json(); 
      return js?.user?.id ? String(js.user.id) : null;
    } catch { 
      return null; 
    }
  }

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('[remote] ✅ WS open, sending attach...');
      ws!.send(JSON.stringify({
        type: 'game.attach',
        data: { gameId },
        requestId: Date.now().toString()
      }));
    };

    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        console.log('[remote] 📩 Received:', msg.type);
        
        switch (msg.type) {
          case 'game_started': {
            const me = await myUserId();
            const players = msg.data?.players || [];
            const left = players.find((p: any) => p.paddle === 'left');
            const right = players.find((p: any) => p.paddle === 'right');
            
            if (left?.username) leftName = left.username;
            if (right?.username) rightName = right.username;
            setNames();
            
            if (me) {
              const mine = players.find((p: any) => String(p.id) === me);
              if (mine) myPaddle = mine.paddle;
            }
            break;
          }
          
          case 'game_state': {
            const st = msg.data?.gameState || msg.gameState || msg.data;
            if (st?.ball) {
              draw(st);
            }
            break;
          }
          
          case 'game_ended': {
            alert(`Game ended. Winner: ${msg.data?.winner ?? 'Unknown'}`);
            location.hash = "";
            break;
          }
          
          case 'ok': {
            if (msg.data?.attached) {
              console.log('[remote] ✅ Attached to game', msg.data);
              // Optional: show names from snapshot if you added it on server
              if (msg.data?.room?.players) {
                const p = msg.data.room.players;
                const left  = p.find((x:any) => x.paddle === 'left');
                const right = p.find((x:any) => x.paddle === 'right');
                if (left?.username)  leftName  = left.username;
                if (right?.username) rightName = right.username;
                setNames();
              }
            } else {
              console.log('[remote] 👋 hello', msg.data);
            }
            break;
          }
          
          case 'error': {
            console.warn('[remote] ❌ Error:', msg.data?.message);
            alert('Error: ' + msg.data?.message);
            break;
          }
        }
      } catch (e) {
        console.error('[remote] 💥 Handler error:', e);
      }
    };

    ws.onerror = (e) => console.error('[remote] ❌ WS error', e);
    ws.onclose = () => { 
      console.log('[remote] 🔌 WS closed');
      ws = null;
    };
  }

  document.getElementById("backFromRemote")?.addEventListener("click", () => {
    try { ws?.close(1000, 'user_exit'); } catch {}
    location.hash = '';
  });

  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  
  window.addEventListener("hashchange", () => {
    document.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("keyup", onKeyUp);
    try { ws?.close(1000, 'page_change'); } catch {}
  }, { once: true });

  // ✅ CLEANUP : Fermer WS quand on quitte la page
  const cleanupHandler = () => {
    if (location.hash !== '#/game-remote') {
      console.log('[Remote Game] Leaving page, cleaning up...');
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      try { 
        if (ws) {
          ws.close(1000, 'leaving_game'); 
          ws = null;
        }
      } catch {}
    }
  };
  
  window.addEventListener("hashchange", cleanupHandler, { once: true });
  window.addEventListener("beforeunload", () => {
    try { ws?.close(1000, 'page_close'); } catch {}
  });

  connect();
} else if (route === "#/sign-up") {
    // --- PAGE D'INSCRIPTION ---
    
    // Gestion du formulaire d'inscription
    const signUpForm = document.getElementById('signUpForm') as HTMLFormElement;
    
    signUpForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Récuperer les donnees du formulaire
      const formData = new FormData(signUpForm);
      const username = formData.get('username') as string;
      const email = formData.get('email') as string;
      const password = formData.get('password') as string;
      
      try {
        const response = await fetch('/api/users/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, email, password }),
        });
        
        const data = await response.json();
        
        if (response.ok) {
          // Succès login
          console.log('Registration successful:', data);

          // Stocke le JWT et ouvre le WS de présence
          if (data.token) {
            localStorage.setItem('token', data.token);
            sessionStorage.setItem('token', data.token);
            Presence.connect(data.token);
          } else {
            console.warn('No token returned on register:', data);
          }

          const name = data.user?.username || username;
          localStorage.setItem('currentUsername', username);
          location.hash = '#/profile';
        } else {
          // Erreur
          console.error('Login failed:', data);
          alert('Login failed: ' + (data.error || 'Invalid username or password'));
        }

      } catch (error) {
        console.error('Network error:', error);
        alert('Network error. Please try again.');
      }
    });
    
    // Gestion du bouton "Back to Menu"
    document.getElementById("backToMenuSignup")?.addEventListener("click", () => {
      location.hash = '';
    });
  } else if (route === "#/login") {
    // --- PAGE DE CONNEXION ---
    
    // Gestion du formulaire de connexion
    const loginForm = document.getElementById('loginForm') as HTMLFormElement;
    
    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Récuperer les donnees du formulaire
      const formData = new FormData(loginForm);
      const username = formData.get('username') as string;
      const password = formData.get('password') as string;
      
      try {
        const response = await fetch('/api/users/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });
        
        const data = await response.json();
        
        if (response.ok) {
          // Succes
          console.log('Login successful:', data);
          if (data.token) {
            localStorage.setItem('token', data.token);
            sessionStorage.setItem('token', data.token);
            Presence.connect(data.token);
          } else {
            console.warn('No token returned on login:', data);
          }

          localStorage.setItem('currentUsername', username);
          location.hash = '#/profile';
        } else {
          // Erreur
          console.error('Login failed:', data);
          alert('Login failed: ' + (data.error || 'Invalid username or password'));
        }
      } catch (error) {
        console.error('Network error:', error);
        alert('Network error. Please try again.');
      }
    });
    // Gestion du bouton "Back to Menu"
    document.getElementById("backToMenuLogin")?.addEventListener("click", () => {
      location.hash = '';
    });
  } else if (route === "#/profile") {
    // --- PAGE DE PROFIL ---
    
    // Récupérer le nom d'utilisateur (pour l'instant depuis localStorage, plus tard depuis l'API)
    const username = localStorage.getItem('currentUsername') || 'Guest';
    
    // Afficher le nom d'utilisateur
    const profileUsername = document.getElementById('profileUsername');
    if (profileUsername) {
      profileUsername.textContent = username;
    }

    // Charger l'avatar depuis l'API
    async function loadUserAvatar() {
      try {
        const userId = await getCurrentUserId();
        const avatarPath = getUserAvatarPath(userId);
        const avatarImg = document.getElementById('profileAvatar') as HTMLImageElement;
        
        if (avatarImg) {
          avatarImg.src = avatarPath;
          console.log(`Avatar chargé: User ID ${userId} → ${avatarPath}`);
        }
      } catch (error) {
        console.error('Erreur lors du chargement de l\'avatar:', error);
      }
    }

    // Charger l'avatar
    loadUserAvatar();
    
    // Gestion du bouton retour à l'accueil
    document.getElementById('backToHomeBtn')?.addEventListener('click', () => {
      // Si on est déjà sur l'accueil, forcer le refresh
      if (location.hash === '' || location.hash === '#') {
        render();
      } else {
        location.hash = '';
      }
    });
    
    // Gestion du bouton de déconnexion
    document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    // 1) marquer offline côté backend (si aucune WS n'est ouverte, ça force l'état)
    const t = localStorage.getItem('token');
    if (t) {
      await fetch('/api/users/logout', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + t,
          'Content-Type': 'application/json'
        }
      }).catch(() => {});
    }
      try {
        // 1. Appeler la route de logout pour marquer offline immédiatement
        const token = localStorage.getItem('token');
        if (token) {
          await fetch('/api/users/logout', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            }
          }).catch(() => {}); // Ignore les erreurs réseau
        }

        // 2. Fermer proprement la WS
        Presence.disconnect();
        
        // 3. Attendre un peu pour que la WS se ferme côté serveur
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 4. Nettoyer les données locales
        Presence.clear();
        localStorage.removeItem('token');
        localStorage.removeItem('currentUsername');
        
        // 5. Rediriger vers l'accueil
        location.hash = '';
        
        // Force le re-render pour mettre à jour l'interface
        setTimeout(() => render(), 10);
        
        // Afficher un message de confirmation
        alert('You have been logged out successfully!');
      } catch (error) {
        console.error('Logout error:', error);
        // En cas d'erreur, nettoyer quand même localement
        Presence.clear();
        localStorage.removeItem('token');
        localStorage.removeItem('currentUsername');
        location.hash = '';
        setTimeout(() => render(), 10);
      }
    });
  }
}

// INITIALISATION DU ROUTEUR SPA

// Lancer le rendu au chargement de la page
// Auto-connect si un token existe déjà (après reload)
// Auto-connect si un token existe déjà ET rendre la page
// Au lieu de: syncAuthFromBackend().finally(() => render());
window.addEventListener('DOMContentLoaded', () => {
  (async () => {
    try {
      // met à jour/efface token + username en fonction du backend
      await syncAuthFromBackend();
    } catch (e) {
      console.warn('syncAuthFromBackend failed', e);
    }

    // Connecte le WS seulement si le token est encore présent après la sync
    const t = localStorage.getItem('token');
    if (t) {
      Presence.connect(t);
    } else {
      // aucune auth côté backend → nettoie l'UI locale
      localStorage.removeItem('currentUsername');
    }

    render();
  })();
});

// Render sur navigation hash
window.addEventListener('hashchange', render);