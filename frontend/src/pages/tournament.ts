// PAGE TOURNAMENT

/**
 * Retourne le HTML de la page Tournament (copié depuis routes object)
 */
export function getTournamentHTML(): string {
  const currentUsername = localStorage.getItem('currentUsername');
  const isLoggedIn = currentUsername && currentUsername !== 'Guest';
  
  return `
  <div class="flex flex-col items-center">
    <h1 class="page-title-large page-title-orange">Tournament</h1>
    <div class="form-box-orange">
      <p class="form-description-orange">Enter players' usernames:</p>
      
      <!-- Liste des 4 joueurs fixes -->
      <div id="playersList" class="mb-6">
        <div class="player-entry mb-4 flex items-center gap-3">
          <span class="w-8 player-number-orange">1.</span>
          <input type="text" class="player-input styled-input flex-1 ${isLoggedIn ? 'logged-user-tournament' : ''}" 
                 placeholder="Player 1 username" maxlength="20" data-index="0"
                 value="${isLoggedIn ? currentUsername : ''}"
                 ${isLoggedIn ? 'readonly' : ''}>
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
  `;
}

/**
 * Attache les event listeners de la page Tournament (copié depuis render())
 */
export function attachTournamentEvents() {
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
    
    // Validation UX basique uniquement (le backend validera tout)
    if (players.length !== 4) {
      alert("Please enter all 4 player names!");
      return;
    }
    
    // Créer le tournoi via l'API backend (qui fera toutes les validations)
    try {
      // Récupérer le token s'il existe (pour que le backend puisse autoriser l'utilisateur connecté)
      const token = localStorage.getItem('token');
      const headers: HeadersInit = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch('/api/tournaments/local', {
        method: 'POST',
        headers,
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
      
      // Rediriger vers la page de jeu pour le premier match
      location.hash = "#/game";
    } catch (error) {
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
}
