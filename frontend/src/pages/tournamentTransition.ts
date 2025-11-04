// PAGE TOURNAMENT TRANSITION

/**
 * Retourne le HTML de la page Tournament Transition (copié depuis routes object)
 */
export function getTournamentTransitionHTML(): string {
  return `
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
  `;
}

/**
 * Attache les event listeners de la page Tournament Transition (copié depuis render())
 */
export function attachTournamentTransitionEvents() {
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
      const matchTypeText = nextMatchInfo.type === 'final' ? 'FINAL' : 
                           nextMatchInfo.type === 'semifinal' ? `Semi-Final ${nextMatchInfo.number}` : 
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
