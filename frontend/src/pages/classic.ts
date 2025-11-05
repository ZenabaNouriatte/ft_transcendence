// PAGE MODE CLASSIC

/**
 * Retourne le HTML de la page Classic (copié exactement depuis routes object)
 */
export function getClassicHTML(): string {
  const currentUsername = localStorage.getItem('currentUsername');
  const isLoggedIn = currentUsername && currentUsername !== 'Guest';
  
  return `
  <div class="flex flex-col items-center">
    <h1 class="page-title-large page-title-green">Classic</h1>
    <div class="form-box-green">
      <p class="form-description-green">Enter players' usernames:</p>
      
      <!-- Formulaire des deux joueurs en grid responsive -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div>
          <label class="form-label"><span class="player-label-green">Player 1</span> (Left - W/S):</label>
          <input id="player1Input" class="styled-input ${isLoggedIn ? 'logged-user-classic' : ''}" 
                 placeholder="Player 1 username" maxlength="20" 
                 value="${isLoggedIn ? currentUsername : ''}"
                 ${isLoggedIn ? 'readonly' : ''}>
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
  `;
}

/**
 * Attache les event listeners de la page Classic (copié exactement depuis render())
 */
export function attachClassicEvents() {
  // PAGE MODE CLASSIC
  const player1Input = document.getElementById("player1Input") as HTMLInputElement;
  const player2Input = document.getElementById("player2Input") as HTMLInputElement;
  const playBtn = document.getElementById("playBtn");
  
  // Focus automatique sur le premier input pour une meilleure UX
  player1Input?.focus();
  
  // Fonction pour démarrer le jeu après validation des noms
  const startGame = async () => {
    const player1Name = player1Input?.value.trim();
    const player2Name = player2Input?.value.trim();
    
    // Validation UX basique uniquement (le backend validera tout)
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
    
    if (player1Name.toLowerCase() === player2Name.toLowerCase()) {
      alert("Players must have different names!");
      player2Input?.focus();
      return;
    }
    
    // Créer le jeu via l'API backend (qui fera toutes les validations)
    try {
      // Récupérer le token s'il existe
      const token = localStorage.getItem('token');
      const isAuthenticated = !!token;
      
      // Choisir la route appropriée selon l'authentification
      const endpoint = isAuthenticated ? '/api/games' : '/api/games/local';
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      // Construire le body selon la route
      const body = isAuthenticated 
        ? JSON.stringify({ player2_username: player2Name })
        : JSON.stringify({ player1: player1Name, player2: player2Name, type: 'pong' });
      
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || error.error || 'Failed to create game');
      }
      
      const data = await response.json();
      const gameId = data.gameId || data.id;
      
      // Stocker les informations du jeu dans localStorage
      localStorage.setItem('player1Name', player1Name);
      localStorage.setItem('player2Name', player2Name);
      localStorage.setItem('currentGameId', gameId ? gameId.toString() : '');
      
      // Marquer explicitement qu'on est en mode classique
      localStorage.setItem('currentGameMode', 'classic');
      localStorage.removeItem('tournamentPlayers'); // Nettoyer les données de tournoi précédentes
      
      location.hash = "#/game";
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      alert(errorMessage);
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
    // Nettoyer les données de jeu
    localStorage.removeItem('currentGameMode');
    location.hash = "";
  });
}
