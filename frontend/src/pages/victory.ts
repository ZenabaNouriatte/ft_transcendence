// PAGE DE VICTOIRE

/**
 * Retourne le HTML de la page Victory (copié depuis routes object)
 */
export function getVictoryHTML(): string {
  return `
  <div class="flex flex-col items-center">
    <div class="victory-box max-w-4xl w-full text-center mb-8">
      <h1 class="page-title-winner">VICTORY</h1>
      <h2 id="winnerName" class="page-title-winner">Winner Name</h2>
      <div id="finalScore" class="page-title-score">
        Final Score: <span class="font-bold">0 - 0</span>
      </div>
      <div class="flex gap-8 justify-center">
        <button id="playAgainBtn" class="retro-btn-victory hover-classic">
          <img class="btn-icon" src="/images/victory-page.png" alt="Play">Play Again
        </button>
      </div>
    </div>
    <div class="mt-4 flex justify-center">
      <button id="backToMenuBtn" class="retro-btn-small hover-classic">
        Back to Menu
      </button>
    </div>
  </div>
  `;
}

/**
 * Attache les event listeners de la page Victory (copié depuis render())
 */
export function attachVictoryEvents() {
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
    } else if (gameMode === 'online') {
      location.hash = "#/online";
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
}
