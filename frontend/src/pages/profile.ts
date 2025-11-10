// PAGE DU PROFIL UTILISATEUR

import { getCurrentUserId } from '../auth.js';
import { getUserProfile } from '../user/index.js';
import { getUserAvatarPath } from '../utils/helpers.js';
import { Presence } from '../websocket.js';
import { clearChatMessages } from '../chat/index.js';

// Retourne le HTML de la page de profil
export function getProfileHTML(): string {
  const currentUsername = localStorage.getItem('currentUsername') || 'Player';
  return `
  <div class="min-h-screen">

    <!-- Boutons navigation en haut à gauche -->
    <div class="fixed top-8 left-8 z-10 flex flex-col items-start gap-3">
      <button id="backToHomeBtn" class="retro-btn flex items-center gap-2 w-fit">
        ← Home
      </button>
      <button id="findFriendsFromProfile" class="retro-btn hover-blue w-fit">
        <img class="btn-icon" src="/images/search.png" alt="Search">Find Friends
      </button>
    </div>
    
    <!-- Contenu principal -->
    <div class="container mx-auto px-4 py-20">
      <div class="flex flex-col items-center">
        <!-- Photo de profil avec image dynamique -->
        <div class="profile-photo mb-4">
          <img id="profileAvatar" src="/images/1.JPG" alt="Profile Photo" 
               style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
        </div>
        <h1 id="profileUsername" class="page-title-large page-title-blue text-center mb-8">${currentUsername}</h1>
        
        <!-- Statistiques -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-6xl">
          <!-- Statistiques globales -->
          <div class="form-box-blue">
            <h2 class="text-2xl mb-6 text-gray-800 text-center font-bold">Player Statistics</h2>
            <div id="userStats" class="space-y-4 text-gray-700">
              <div class="flex justify-between">
                <span class="font-semibold">Games Played:</span>
                <span id="gamesPlayed">Loading...</span>
              </div>
              <div class="flex justify-between">
                <span class="font-semibold">Games Won:</span>
                <span id="gamesWon" class="text-green-600">Loading...</span>
              </div>
              <div class="flex justify-between">
                <span class="font-semibold">Games Lost:</span>
                <span id="gamesLost" class="text-red-600">Loading...</span>
              </div>
              <div class="flex justify-between">
                <span class="font-semibold">Win Rate:</span>
                <span id="winRate" class="text-blue-600">Loading...</span>
              </div>
              <div class="flex justify-between">
                <span class="font-semibold">Tournaments Won:</span>
                <span id="tournamentsWon" class="text-yellow-600">Loading...</span>
              </div>
            </div>
          </div>
          
          <!-- Historique des matchs -->
          <div class="form-box-blue">
            <h2 class="text-2xl mb-6 text-gray-800 text-center font-bold">Match History</h2>
            <div id="matchHistory" class="max-h-80 overflow-y-auto">
              <p class="text-center text-gray-600">Loading match history...</p>
            </div>
          </div>
        </div>
        
        <!-- Boutons actions -->
        <div class="mt-8 flex gap-4">
          <button id="editProfileBtn" class="retro-btn">
            Edit Profile
          </button>
          <button id="logoutBtn" class="retro-btn">
            Logout
          </button>
        </div>
      </div>
    </div>
    
    <!-- MODAL DE MODIFICATION DU PROFIL -->
    <div id="editProfileModal" class="profile-modal" style="display: none;">
      <div class="profile-modal-content">
        <div class="profile-modal-header">
          <h2 class="page-title-medium page-title-blue">Edit Profile</h2>
          <button id="closeModalBtn" class="close-modal-btn">&times;</button>
        </div>
        
        <form id="editProfileForm" class="profile-form">
          <!-- Avatar Upload Section -->
          <div class="form-group">
            <label class="form-label">Profile Picture</label>
            <div class="avatar-upload-container">
              <div class="avatar-preview-wrapper">
                <img id="avatarPreview" class="avatar-preview" src="" alt="Avatar preview">
                <div class="avatar-overlay">Click to change</div>
              </div>
              <input type="file" id="avatarInput" accept="image/png,image/jpeg,image/jpg,image/gif" style="display: none;">
              <button type="button" id="removeAvatarBtn" class="retro-btn-small hover-red mt-2" style="display: none;">
                Remove
              </button>
              <p class="text-xs text-gray-600 mt-2">Formats: JPG, PNG, GIF (max 5MB)</p>
            </div>
          </div>
          
          <div class="form-group">
            <label class="form-label">New Username (optional)</label>
            <input type="text" id="newUsername" class="styled-input" placeholder="Leave empty to keep current">
          </div>
          
          <div class="form-group">
            <label class="form-label">New Email (optional)</label>
            <input type="email" id="newEmail" class="styled-input" placeholder="Leave empty to keep current">
          </div>
          
          <div class="form-group">
            <label class="form-label">New Password (optional)</label>
            <input type="password" id="newPassword" class="styled-input" placeholder="Min. 8 characters">
          </div>
          
          <div class="form-group">
            <label class="form-label">Confirm New Password</label>
            <input type="password" id="confirmPassword" class="styled-input" placeholder="Confirm new password">
          </div>
          
          <div id="editProfileError" class="error-message" style="display: none;"></div>
          <div id="editProfileSuccess" class="success-message" style="display: none;"></div>
          
          <div class="modal-buttons">
            <button type="submit" class="retro-btn hover-green">Save Changes</button>
            <button type="button" id="cancelModalBtn" class="retro-btn hover-red">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </div>
  `;
}

// Attache les event listeners de la page de profil
export function attachProfileEvents() {
  // Récupérer le nom d'utilisateur courant depuis le localStorage
  const username = localStorage.getItem('currentUsername') || 'Player';
  
  // Afficher le nom d'utilisateur dans le profil
  const profileUsername = document.getElementById('profileUsername');
  if (profileUsername) {
    profileUsername.textContent = username;
  }

  // Récuperer les données de l'utilisateur
  async function loadUserAvatar() {
    try {
      const userId = await getCurrentUserId();
      const profileData = await getUserProfile(userId);
      const avatarImg = document.getElementById('profileAvatar') as HTMLImageElement;
      
      // Utiliser getUserAvatarPath avec l'avatar path de l'utilisateur
      if (avatarImg) {
        const avatarPath = getUserAvatarPath(userId, profileData?.user?.avatar);
        avatarImg.src = avatarPath;
      }
    } catch (error) {
      // Erreur silencieuse pour l'avatar
      console.error('Erreur chargement avatar:', error);
    }
  }

  // Charger l'avatar
  loadUserAvatar();
  
  // Charger les statistiques utilisateur et l'historique des matchs
  async function loadUserData() {
    try {
      // Récupérer l'ID de l'utilisateur courant
      const userId = await getCurrentUserId();
      const profile = await getUserProfile(userId);
      
      // Mettre à jour les statistiques
      if (profile && profile.stats) {
        const stats = profile.stats;
        const winRate = stats.games_played > 0 ? ((stats.games_won / stats.games_played) * 100).toFixed(1) : '0';
        
        // Remplir les statistiques avec les données récupérées
        document.getElementById('gamesPlayed')!.textContent = stats.games_played.toString();
        document.getElementById('gamesWon')!.textContent = stats.games_won.toString();
        document.getElementById('gamesLost')!.textContent = stats.games_lost.toString();
        document.getElementById('winRate')!.textContent = `${winRate}%`;
        document.getElementById('tournamentsWon')!.textContent = stats.tournaments_won.toString();
      } else {
        // Afficher des valeurs par défaut si pas de stats
        document.getElementById('gamesPlayed')!.textContent = '0';
        document.getElementById('gamesWon')!.textContent = '0';
        document.getElementById('gamesLost')!.textContent = '0';
        document.getElementById('winRate')!.textContent = '0%';
        document.getElementById('tournamentsWon')!.textContent = '0';
      }

      // Charger l'historique des matchs
      const historyContainer = document.getElementById('matchHistory')!;
      
      // Vérifier si l'historique existe et n'est pas vide
      if (profile && profile.history && profile.history.length > 0) {
        const matches = profile.history;
        
        const historyHTML = matches.map((match: any) => {
          // Vérifier si l'utilisateur actuel a gagné en tenant compte du type de gagnant
          const isWinner = (match.winner_type === 'user' && match.winner_id === userId) ||
                         (match.winner_type === 'local' && match.winner_id !== userId && 
                          ((match.player1_id === userId && match.player1_type === 'user') || 
                           (match.player2_id === userId && match.player2_type === 'user')));
          
          // Correction : si winner_type est 'local', alors l'utilisateur authentifié a perdu
          const actualIsWinner = match.winner_type === 'user' && match.winner_id === userId;
          
          // Utiliser les noms d'utilisateur récupérés par la requête
          const opponent = match.player1_id === userId ? 
            (match.player2_username || `User ${match.player2_id}`) : 
            (match.player1_username || `User ${match.player1_id}`);
          const userScore = match.player1_id === userId ? match.player1_score : match.player2_score;
          const opponentScore = match.player1_id === userId ? match.player2_score : match.player1_score;
          const date = new Date(match.finished_at || match.created_at).toLocaleDateString();
          
          // Affichage unifié pour tous les matchs (classiques et tournois)
          const tournamentInfo = match.tournament_id ? ` 🏆 ${match.tournament_name || 'Tournament'}` : '';
          
          return `
            <div class="border-b pb-2 mb-2 last:border-b-0">
              <div class="flex justify-between items-center">
                <div class="flex-1">
                  <span class="font-semibold text-gray-800">${username} vs ${opponent}${tournamentInfo}</span>
                  <div class="text-sm text-gray-600">
                    Score: <span class="font-mono">${userScore} - ${opponentScore}</span> | ${date}
                  </div>
                </div>
                <div class="text-lg font-bold ${actualIsWinner ? 'text-green-600' : 'text-red-600'}">
                  ${actualIsWinner ? 'WIN' : 'LOSS'}
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
      // Afficher des valeurs par défaut en cas d'erreur
      document.getElementById('gamesPlayed')!.textContent = '0';
      document.getElementById('gamesWon')!.textContent = '0';
      document.getElementById('gamesLost')!.textContent = '0';
      document.getElementById('winRate')!.textContent = '0%';
      document.getElementById('tournamentsWon')!.textContent = '0';
      document.getElementById('matchHistory')!.innerHTML = '<p class="text-center text-red-600">Error loading user data</p>';
    }
  }
  
  // Charger les données
  loadUserData();
  
  // Gestion du bouton retour à l'accueil
  document.getElementById('backToHomeBtn')?.addEventListener('click', () => {
    // Si on est déjà sur l'accueil, forcer le refresh
    if (location.hash === '' || location.hash === '#') {
      // render(); // On suppose que render est disponible
      location.reload();
    } else {
      location.hash = '';
    }
  });
  
  // Gestion du bouton Find Friends depuis le profil
  document.getElementById('findFriendsFromProfile')?.addEventListener('click', () => {
    location.hash = '#/friends';
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
      
      // 5. Vider les messages du chat
      clearChatMessages();
      
      // 6. Rediriger vers l'accueil
      location.hash = '';
      
      // Force le re-render pour mettre à jour l'interface
      setTimeout(() => location.reload(), 10);
      
      // Afficher un message de confirmation
      alert('You have been logged out successfully!');
    } catch (error) {
      console.error('Logout error:', error);
      // En cas d'erreur, nettoyer quand même localement
      Presence.clear();
      localStorage.removeItem('token');
      localStorage.removeItem('currentUsername');
      clearChatMessages();
      location.hash = '';
      setTimeout(() => location.reload(), 10);
    }
  });
  
  // Gestion du modal de modification du profil
  const editProfileBtn = document.getElementById('editProfileBtn');
  const editProfileModal = document.getElementById('editProfileModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const editProfileForm = document.getElementById('editProfileForm') as HTMLFormElement;
  const editProfileError = document.getElementById('editProfileError');
  const editProfileSuccess = document.getElementById('editProfileSuccess');
  
  // Éléments pour l'avatar
  const avatarInput = document.getElementById('avatarInput') as HTMLInputElement;
  const avatarPreview = document.getElementById('avatarPreview') as HTMLImageElement;
  const removeAvatarBtn = document.getElementById('removeAvatarBtn');
  const avatarPreviewWrapper = document.querySelector('.avatar-preview-wrapper') as HTMLElement;
  let selectedAvatarFile: File | null = null;
  let removeAvatar = false;
  
  // Ouvrir le modal
  editProfileBtn?.addEventListener('click', async () => {
    if (editProfileModal) {
      editProfileModal.style.display = 'flex';
      // Réinitialiser le formulaire
      editProfileForm?.reset();
      if (editProfileError) editProfileError.style.display = 'none';
      if (editProfileSuccess) editProfileSuccess.style.display = 'none';
      
      // Charger l'avatar actuel depuis l'API
      selectedAvatarFile = null;
      removeAvatar = false;
      
      const userId = await getCurrentUserId();
      const profileData = await getUserProfile(userId);
      const currentAvatarPath = getUserAvatarPath(userId, profileData?.user?.avatar);
      
      if (avatarPreview) {
        avatarPreview.src = currentAvatarPath;
      }
      
      // Afficher "Remove" seulement si l'utilisateur a un avatar uploadé
      if (removeAvatarBtn) {
        const hasUploadedAvatar = profileData?.user?.avatar && profileData.user.avatar.startsWith('/uploads/');
        removeAvatarBtn.style.display = hasUploadedAvatar ? 'inline-block' : 'none';
      }
    }
  });
  
  // Gestion du clic sur l'aperçu de l'avatar (pour choisir une nouvelle image)
  avatarPreviewWrapper?.addEventListener('click', () => {
    avatarInput?.click();
  });
  
  // Gestion du changement de fichier
  avatarInput?.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    
    // Vérifier la taille (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      if (editProfileError) {
        editProfileError.textContent = 'Image too large. Maximum size is 5MB.';
        editProfileError.style.display = 'block';
      }
      return;
    }
    
    // Vérifier le type
    if (!file.type.match(/^image\/(png|jpeg|jpg|gif)$/)) {
      if (editProfileError) {
        editProfileError.textContent = 'Invalid file type. Use JPG, PNG, or GIF.';
        editProfileError.style.display = 'block';
      }
      return;
    }
    
    selectedAvatarFile = file;
    removeAvatar = false;
    
    // Prévisualiser l'image
    const reader = new FileReader();
    reader.onload = (event) => {
      if (avatarPreview && event.target?.result) {
        avatarPreview.src = event.target.result as string;
      }
    };
    reader.readAsDataURL(file);
    
    // Afficher le bouton "Remove"
    if (removeAvatarBtn) removeAvatarBtn.style.display = 'inline-block';
    if (editProfileError) editProfileError.style.display = 'none';
  });
  
  // Gestion du bouton "Remove"
  removeAvatarBtn?.addEventListener('click', async () => {
    selectedAvatarFile = null;
    removeAvatar = true;
    
    // Afficher l'avatar par défaut /images/X.JPG dans le modal
    const userId = await getCurrentUserId();
    const defaultAvatarPath = getUserAvatarPath(userId, null); // null = pas d'avatar uploadé
    
    if (avatarPreview) {
      avatarPreview.src = defaultAvatarPath;
    }
    
    if (removeAvatarBtn) removeAvatarBtn.style.display = 'none';
    if (avatarInput) avatarInput.value = '';
  });
  
  // Fermer le modal (bouton X)
  closeModalBtn?.addEventListener('click', () => {
    if (editProfileModal) editProfileModal.style.display = 'none';
  });
  
  // Fermer le modal (bouton Cancel)
  cancelModalBtn?.addEventListener('click', () => {
    if (editProfileModal) editProfileModal.style.display = 'none';
  });
  
  // Fermer le modal en cliquant sur le fond
  editProfileModal?.addEventListener('click', (e) => {
    if (e.target === editProfileModal) {
      editProfileModal.style.display = 'none';
    }
  });
  
  // SOUMISSION DU FORMULAIRE DE MODIFICATION DU PROFIL
  editProfileForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!editProfileError || !editProfileSuccess) return;
    
    editProfileError.style.display = 'none';
    editProfileSuccess.style.display = 'none';
    
    const newUsername = (document.getElementById('newUsername') as HTMLInputElement).value.trim();
    const newEmail = (document.getElementById('newEmail') as HTMLInputElement).value.trim();
    const newPassword = (document.getElementById('newPassword') as HTMLInputElement).value;
    const confirmPassword = (document.getElementById('confirmPassword') as HTMLInputElement).value;
    
    // Validation UX basique uniquement (le backend validera tout)
    if (newPassword && newPassword !== confirmPassword) {
      editProfileError.textContent = 'Passwords do not match';
      editProfileError.style.display = 'block';
      return;
    }
    
    if (!newUsername && !newEmail && !newPassword && !selectedAvatarFile && !removeAvatar) {
      editProfileError.textContent = 'Please fill at least one field to update';
      editProfileError.style.display = 'block';
      return;
    }
    
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        location.hash = '#/login';
        return;
      }
      
      console.log('[DEBUG] Preparing FormData...');
      // Utiliser FormData pour envoyer le fichier
      const formData = new FormData();
      if (newUsername) formData.append('username', newUsername);
      if (newEmail) formData.append('email', newEmail);
      if (newPassword) formData.append('password', newPassword);
      if (selectedAvatarFile) {
        console.log('[DEBUG] Appending avatar file:', selectedAvatarFile.name);
        formData.append('avatar', selectedAvatarFile);
      } else if (removeAvatar) {
        console.log('[DEBUG] Removing avatar');
        formData.append('removeAvatar', 'true');
      }
      
      console.log('[DEBUG] Sending request to /api/users/profile...');
      const response = await fetch('/api/users/profile', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          // NE PAS définir Content-Type, le navigateur le fera automatiquement avec boundary
        },
        body: formData
      });
      
      console.log('[DEBUG] Response status:', response.status);
      const data = await response.json();
      console.log('[DEBUG] Response data:', data);
      
      if (response.ok) {
        console.log('[DEBUG] Update successful!');
        editProfileSuccess.textContent = 'Profile updated successfully!';
        editProfileSuccess.style.display = 'block';
        
        // Mettre à jour le username affiché si changé
        if (newUsername && data.user) {
          localStorage.setItem('currentUsername', data.user.username);
          const profileUsername = document.getElementById('profileUsername');
          if (profileUsername) {
            profileUsername.textContent = data.user.username;
          }
        }
        
        // Mettre à jour l'avatar affiché si changé
        if (data.user && data.user.avatar) {
          const profilePhoto = document.querySelector('.profile-photo') as HTMLElement;
          if (profilePhoto) {
            profilePhoto.style.backgroundImage = `url('${data.user.avatar}')`;
          }
        }
        
        // Réinitialiser les variables d'avatar
        selectedAvatarFile = null;
        removeAvatar = false;
        if (removeAvatarBtn) removeAvatarBtn.style.display = 'none';
        
        // Réinitialiser le formulaire mais garder le modal ouvert
        editProfileForm?.reset();
        
        // Recharger la page de profil après 1 seconde
        setTimeout(() => {
          location.reload();
        }, 1000);
      } else {
        // Gestion des erreurs
        let errorMessage = 'Update failed';
        if (data.error === 'username_too_short') {
          errorMessage = 'Username must be at least 3 characters';
        } else if (data.error === 'invalid_email') {
          errorMessage = 'Invalid email format';
        } else if (data.error === 'username_taken') {
          errorMessage = 'Username already taken';
        } else if (data.error === 'email_taken') {
          errorMessage = 'Email already in use';
        } else if (data.error === 'password_too_short') {
          errorMessage = 'Password must be at least 8 characters';
        } else if (data.error === 'password_needs_letter_and_number') {
          errorMessage = 'Password must contain letters and numbers';
        }
        
        editProfileError.textContent = errorMessage;
        editProfileError.style.display = 'block';
      }
    } catch (error) {
      console.error('[ERROR] Profile update failed:', error);
      editProfileError.textContent = 'Network error. Please try again.';
      editProfileError.style.display = 'block';
    }
  });
}
