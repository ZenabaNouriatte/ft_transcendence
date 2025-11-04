// API JEU

/**
 * Crée une nouvelle partie
 */
export async function createGame(player1Username: string, player2Username: string, tournamentId?: number): Promise<number | null> {
  const token = localStorage.getItem('token');
  if (!token) {
    console.log('Pas de token, création du jeu en mode invité');
    return null;
  }

  try {
    console.log(`🎮 [CreateGame] Création d'un jeu: ${player1Username} vs ${player2Username}`);
    console.log(`🎮 [CreateGame] Tournament ID: ${tournamentId}`);
    
    const gameData = {
      player2_username: player2Username,
      tournament_id: tournamentId
    };
    console.log(`🎮 [CreateGame] Sending data:`, gameData);
    
    // Utiliser l'API games officielle pour sauvegarder en base de données
    const response = await fetch('/api/games', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        // Rechercher l'ID du player2 par son nom d'utilisateur
        player2_username: player2Username,
        tournament_id: tournamentId
      })
    });

    console.log(`Réponse API games: ${response.status}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erreur API games: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log('Jeu créé avec succès:', data);
    return data.gameId || data.id;
  } catch (error) {
    console.error('Erreur lors de la création du jeu:', error);
    return null;
  }
}

/**
 * Finalise un jeu avec les scores
 */
export async function finishGame(gameId: number, player1Score: number, player2Score: number): Promise<boolean> {
  console.log(`🏁 finishGame called: gameId=${gameId}, scores=${player1Score}-${player2Score}`);
  
  const token = localStorage.getItem('token');
  if (!token) {
    console.error('❌ finishGame: No token found');
    return false;
  }

  try {
    // Récupérer les infos du jeu pour déterminer le gagnant
    console.log(`🔍 Getting game ${gameId} state...`);
    const gameResponse = await fetch(`/api/games/${gameId}/state`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!gameResponse.ok) {
      console.error(`❌ Failed to get game state: ${gameResponse.status}`);
      return false;
    }
    
    const gameData = await gameResponse.json();
    console.log('🎮 Game data:', gameData);
    
    const winnerId = player1Score > player2Score ? gameData.player1_id : gameData.player2_id;
    console.log(`🏆 Winner ID: ${winnerId} (${player1Score > player2Score ? 'Player 1' : 'Player 2'})`);

    console.log(`💾 Finishing game ${gameId}...`);
    const response = await fetch(`/api/games/${gameId}/finish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        winner_id: winnerId,
        player1_score: player1Score,
        player2_score: player2Score
      })
    });

    if (response.ok) {
      console.log('✅ Game finished successfully!');
    } else {
      console.error(`❌ Failed to finish game: ${response.status}`);
    }
    
    return response.ok;
  } catch (error) {
    console.error('❌ Error finishing game:', error);
    return false;
  }
}

// Rendre la fonction accessible globalement (nécessaire pour gameClient.ts)
(window as any).finishGame = finishGame;
