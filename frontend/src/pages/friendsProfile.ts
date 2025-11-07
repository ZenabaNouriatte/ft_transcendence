import { getUserProfile } from '../user/index.js';
import { getUserAvatarPath } from '../utils/helpers.js';
import { getFriendshipStatus, sendFriendRequest } from '../friends/index.js';
import { blockUser, unblockUser, isUserBlocked, loadBlockedUsers } from '../blocking/index.js';
import * as DM from '../chat/dm.js';
import { isChatOpen } from '../chat/state.js';

/**
 * Retourne le HTML de la page profil d'un ami
 */
export function getFriendsProfileHTML(): string {
  const friendUsername = localStorage.getItem('viewingFriendUsername') || 'Unknown';
  
  return `
  <div class="min-h-screen">
    <!-- Bouton retour à Friends -->
    <div class="fixed top-8 left-8 z-10">
      <button id="backToFriendsBtn" class="retro-btn flex items-center gap-2">
        ← Friends
      </button>
    </div>
    
    <!-- Contenu principal -->
    <div class="container mx-auto px-4 py-20">
      <div class="flex flex-col items-center">
        <!-- Photo de profil avec bouton chat à droite -->
        <div class="relative mb-4">
          <div class="profile-photo">
            <img id="friendProfileAvatar" src="/images/1.JPG" alt="Profile Photo" 
                 style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
          </div>
          <!-- Bouton Chat positionné à droite de la photo -->
          <button id="sendMessageBtn" class="retro-btn-round-profile absolute" style="right: -100px; top: 50%; transform: translateY(-50%);" title="Chat">
            <img class="btn-icon-round" src="/images/chat-removebg-preview.png" alt="Chat">
          </button>
        </div>
        <h1 id="friendProfileUsername" class="page-title-large page-title-blue text-center mb-4">${friendUsername}</h1>
        
        <!-- Boutons Ajouter et Statut -->
        <div class="mb-4 flex gap-3 items-center">
          <button id="addFriendFromProfile" class="add-friend-btn">
            ADD
          </button>
          <div id="friendStatusIndicator" class="status-offline-btn">
            <img src="/images/offline.png" alt="status" class="status-icon">
            OFFLINE
          </div>
        </div>
        
        <!-- Statistiques -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-6xl mb-8">
          <!-- Statistiques globales -->
          <div class="form-box-blue">
            <h2 class="text-2xl mb-6 text-gray-800 text-center font-bold">Player Statistics</h2>
            <div id="friendUserStats" class="space-y-4 text-gray-700">
              <div class="flex justify-between">
                <span class="font-semibold">Games Played:</span>
                <span id="friendGamesPlayed">Loading...</span>
              </div>
              <div class="flex justify-between">
                <span class="font-semibold">Games Won:</span>
                <span id="friendGamesWon" class="text-green-600">Loading...</span>
              </div>
              <div class="flex justify-between">
                <span class="font-semibold">Games Lost:</span>
                <span id="friendGamesLost" class="text-red-600">Loading...</span>
              </div>
              <div class="flex justify-between">
                <span class="font-semibold">Win Rate:</span>
                <span id="friendWinRate" class="text-blue-600">Loading...</span>
              </div>
              <div class="flex justify-between">
                <span class="font-semibold">Tournaments Won:</span>
                <span id="friendTournamentsWon" class="text-yellow-600">Loading...</span>
              </div>
            </div>
          </div>
          
          <!-- Historique des matchs -->
          <div class="form-box-blue">
            <h2 class="text-2xl mb-6 text-gray-800 text-center font-bold">Match History</h2>
            <div id="friendMatchHistory" class="max-h-80 overflow-y-auto">
              <p class="text-center text-gray-600">Loading match history...</p>
            </div>
          </div>
        </div>
        
        <!-- Bouton Block centré sous les statistiques -->
        <div class="flex justify-center">
          <button id="blockUserBtn" class="block-user-btn">
            <span id="blockButtonText">BLOCK</span>
          </button>
        </div>
      </div>
    </div>
  </div>
  `;
}

/**
 * Attache les event listeners de la page profil d'un ami
 */
export function attachFriendsProfileEvents() {
  // Récupérer les infos de l'ami à afficher
  const friendUserId = localStorage.getItem('viewingFriendUserId');
  const friendUsername = localStorage.getItem('viewingFriendUsername');
  
  if (!friendUserId || !friendUsername) {
    location.hash = '#/friends';
    return;
  }
  
  const friendUserIdNum = parseInt(friendUserId);
  
  // Mettre à jour le nom d'utilisateur dans la page
  const friendProfileUsername = document.getElementById('friendProfileUsername');
  if (friendProfileUsername) {
    friendProfileUsername.textContent = friendUsername;
  }
  
  // Charger l'avatar de l'ami depuis l'API
  async function loadFriendAvatar() {
    const friendAvatarImg = document.getElementById('friendProfileAvatar') as HTMLImageElement;
    if (friendAvatarImg) {
      const profileData = await getUserProfile(friendUserIdNum);
      const avatarPath = getUserAvatarPath(friendUserIdNum, profileData?.user?.avatar);
      friendAvatarImg.src = avatarPath;
    }
  }
  
  loadFriendAvatar();
  
  // Fonction pour charger les données de l'ami
  async function loadFriendData() {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        location.hash = '#/login';
        return;
      }

      // Charger le profil de l'ami
      const profile = await getUserProfile(friendUserIdNum);
      
      // Mettre à jour l'indicateur de statut
      const statusIndicator = document.getElementById('friendStatusIndicator');
      if (statusIndicator && profile && profile.user) {
        const status = profile.user.status || 'offline';
        statusIndicator.className = `status-${status}-btn`;
        statusIndicator.innerHTML = `<img src="/images/${status}.png" alt="status" class="status-icon">${status.toUpperCase()}`;
      }
      
      // Mettre à jour les statistiques
      if (profile && profile.stats) {
        document.getElementById('friendGamesPlayed')!.textContent = profile.stats.games_played || '0';
        document.getElementById('friendGamesWon')!.textContent = profile.stats.games_won || '0';
        document.getElementById('friendGamesLost')!.textContent = profile.stats.games_lost || '0';
        
        const gamesPlayed = profile.stats.games_played || 0;
        const gamesWon = profile.stats.games_won || 0;
        const winRate = gamesPlayed > 0 ? ((gamesWon / gamesPlayed) * 100).toFixed(1) : '0';
        document.getElementById('friendWinRate')!.textContent = `${winRate}%`;
        
        document.getElementById('friendTournamentsWon')!.textContent = profile.stats.tournaments_won || '0';
      } else {
        document.getElementById('friendGamesPlayed')!.textContent = '0';
        document.getElementById('friendGamesWon')!.textContent = '0';
        document.getElementById('friendGamesLost')!.textContent = '0';
        document.getElementById('friendWinRate')!.textContent = '0%';
        document.getElementById('friendTournamentsWon')!.textContent = '0';
      }

      // Charger l'historique des matchs de l'ami
      const historyContainer = document.getElementById('friendMatchHistory')!;
      
      if (profile && profile.history && profile.history.length > 0) {
        const matches = profile.history;
        
        const historyHTML = matches.map((match: any) => {
          const isWinner = match.winner_type === 'user' && match.winner_id === friendUserIdNum;
          const opponent = match.player1_id === friendUserIdNum ? 
            (match.player2_username || `User ${match.player2_id}`) : 
            (match.player1_username || `User ${match.player1_id}`);
          const userScore = match.player1_id === friendUserIdNum ? match.player1_score : match.player2_score;
          const opponentScore = match.player1_id === friendUserIdNum ? match.player2_score : match.player1_score;
          const date = new Date(match.finished_at || match.created_at).toLocaleDateString();
          
          const tournamentInfo = match.tournament_id ? ` 🏆 ${match.tournament_name || 'Tournament'}` : '';
          
          return `
            <div class="border-b pb-2 mb-2 last:border-b-0">
              <div class="flex justify-between items-center">
                <div class="flex-1">
                  <span class="font-semibold text-gray-800">${friendUsername} vs ${opponent}${tournamentInfo}</span>
                  <div class="text-sm text-gray-600">
                    Score: <span class="font-mono">${userScore} - ${opponentScore}</span> | ${date}
                  </div>
                </div>
                <div class="text-lg font-bold ${isWinner ? 'text-green-600' : 'text-red-600'}">
                  ${isWinner ? 'WIN' : 'LOSS'}
                </div>
              </div>
            </div>
          `;
        }).join('');
        
        historyContainer.innerHTML = historyHTML;
      } else {
        historyContainer.innerHTML = '<p class="text-center text-gray-600">No matches played yet</p>';
      }
    } catch (error) {
      console.error('Error loading friend data:', error);
      document.getElementById('friendGamesPlayed')!.textContent = '0';
      document.getElementById('friendGamesWon')!.textContent = '0';
      document.getElementById('friendGamesLost')!.textContent = '0';
      document.getElementById('friendWinRate')!.textContent = '0%';
      document.getElementById('friendTournamentsWon')!.textContent = '0';
      document.getElementById('friendMatchHistory')!.innerHTML = '<p class="text-center text-red-600">Error loading data</p>';
    }
  }
  
  // Charger les données de l'ami
  loadFriendData();
  
  // Fonction pour charger le statut du bouton ami
  async function loadFriendButtonStatus() {
    try {
      const status = await getFriendshipStatus(friendUserIdNum);
      const button = document.getElementById('addFriendFromProfile') as HTMLButtonElement;
      
      if (status === 'sent') {
        button.textContent = 'SENT';
        button.className = 'add-friend-btn-sent';
        button.disabled = true;
      } else if (status === 'received') {
        button.textContent = 'RECEIVED';
        button.className = 'add-friend-btn-received';
        button.disabled = true;
      } else if (status === 'friend') {
        button.textContent = 'FRIEND';
        button.className = 'add-friend-btn-friend';
        button.disabled = true;
      } else {
        // status === 'none' ou null
        button.textContent = 'ADD';
        button.className = 'add-friend-btn';
        button.disabled = false;
      }
    } catch (error) {
      console.error('Error loading friend button status:', error);
    }
  }
  
  // Charger le statut du bouton
  loadFriendButtonStatus();
  
  // Gestion du bouton retour vers Friends
  document.getElementById('backToFriendsBtn')?.addEventListener('click', () => {
    location.hash = '#/friends';
  });
  
  // Gestion du bouton Ajouter
  document.getElementById('addFriendFromProfile')?.addEventListener('click', async () => {
    const button = document.getElementById('addFriendFromProfile') as HTMLButtonElement;
    
    // Vérifier d'abord le statut actuel  
    const currentStatus = await getFriendshipStatus(friendUserIdNum);
    if (currentStatus === 'sent' || currentStatus === 'received' || currentStatus === 'friend') {
      return; // Ne rien faire si déjà ami ou demande envoyée/reçue
    }
    
    // Désactiver temporairement le bouton
    button.disabled = true;
    button.textContent = 'SENDING...';
    
    try {
      const result = await sendFriendRequest(friendUserIdNum);
      
      if (result.success) {
        // Succès - mettre à jour l'interface
        button.textContent = 'SENT';
        button.className = 'add-friend-btn-sent';
        button.disabled = true;
        console.log(`Friend request sent to ${friendUsername}`);
      } else {
        // Erreur - afficher le message et recharger le statut correct
        if (result.message) {
          alert(result.message);
        } else if (result.error) {
          alert(`Error: ${result.error}`);
        }
        await loadFriendButtonStatus();
        console.error('Error sending friend request:', result.error);
      }
    } catch (error) {
      // Erreur réseau - recharger le statut correct
      await loadFriendButtonStatus();
      console.error('Network error sending friend request:', error);
    }
  });

  // Gestion du bouton Send Message
  document.getElementById('sendMessageBtn')?.addEventListener('click', () => {
    console.log('[DM] Send Message button clicked');
    console.log('[DM] DM module:', DM);
    console.log('[DM] friendUserIdNum:', friendUserIdNum);
    
    // Ouvrir le chat et basculer vers l'onglet Messages
    const chatOverlay = document.getElementById('chatOverlay');
    if (chatOverlay) {
      chatOverlay.style.display = 'flex';
      console.log('[DM] Chat overlay opened');
    } else {
      console.error('[DM] Chat overlay not found!');
    }
    
    // Basculer vers l'onglet DM
    if (DM && DM.switchToDmTab) {
      console.log('[DM] Switching to DM tab');
      DM.switchToDmTab();
    } else {
      console.error('[DM] DM.switchToDmTab not available!');
    }
    
    // Ouvrir la conversation avec cet utilisateur
    if (DM && DM.openDmConversation) {
      console.log('[DM] Opening conversation with user:', friendUserIdNum);
      DM.openDmConversation(friendUserIdNum);
    } else {
      console.error('[DM] DM.openDmConversation not available!');
    }
  });

  
  // Gestion du bouton Block/Unblock
  document.getElementById('blockUserBtn')?.addEventListener('click', async () => {
    const button = document.getElementById('blockUserBtn') as HTMLButtonElement;
    const buttonText = document.getElementById('blockButtonText') as HTMLSpanElement;
    
    // Vérifier si l'utilisateur est déjà bloqué
    const isBlocked = isUserBlocked(friendUserIdNum);
    
    if (isBlocked) {
      // Débloquer l'utilisateur
      if (confirm(`Are you sure you want to unblock ${friendUsername}?`)) {
        button.disabled = true;
        buttonText.textContent = 'UNBLOCKING...';
        
        const success = await unblockUser(friendUserIdNum);
        
        if (success) {
          buttonText.textContent = 'BLOCK';
          button.className = 'block-user-btn';
          console.log(`${friendUsername} has been unblocked`);
          
          // Recharger le statut du bouton ADD
          await loadFriendButtonStatus();
        } else {
          buttonText.textContent = 'UNBLOCK';
          console.error('Error unblocking user');
        }
        
        button.disabled = false;
      }
    } else {
      // Bloquer l'utilisateur
      if (confirm(`Are you sure you want to block ${friendUsername}? They won't be able to send you friend requests and you won't see their chat messages.`)) {
        button.disabled = true;
        buttonText.textContent = 'BLOCKING...';
        
        const success = await blockUser(friendUserIdNum);
        
        if (success) {
          buttonText.textContent = 'UNBLOCK';
          button.className = 'unblock-user-btn';
          console.log(`${friendUsername} has been blocked`);
          
          // Recharger le statut du bouton ADD (ils ne sont plus amis)
          await loadFriendButtonStatus();
        } else {
          buttonText.textContent = 'BLOCK';
          console.error('Error blocking user');
        }
        
        button.disabled = false;
      }
    }
  });
  
  // Charger l'état initial du bouton Block
  async function initializeBlockButton() {
    // D'abord recharger la liste des utilisateurs bloqués depuis le serveur
    await loadBlockedUsers();
    
    const isBlockedInitial = isUserBlocked(friendUserIdNum);
    const blockButton = document.getElementById('blockUserBtn') as HTMLButtonElement;
    const blockButtonText = document.getElementById('blockButtonText') as HTMLSpanElement;
    
    if (isBlockedInitial) {
      blockButtonText.textContent = 'UNBLOCK';
      blockButton.className = 'unblock-user-btn';
    }
  }
  
  initializeBlockButton();
}
