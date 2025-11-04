import { getFriendshipStatus, sendFriendRequest, getFriendRequests } from '../friends/index.js';
import { getUserAvatarPath } from '../utils/helpers.js';

/**
 * Retourne le HTML de la page friends
 */
export function getFriendsHTML(): string {
  return `
  <div class="min-h-screen friends-page">
    <!-- Bouton retour en haut à gauche -->
    <div class="fixed top-8 left-8 z-10">
      <button id="backToHomeFromFriends" class="retro-btn flex items-center gap-2">
        ← Home
      </button>
    </div>
    
    <!-- Bouton demandes d'amis en haut à droite -->
    <div class="fixed top-8 right-8 z-10">
      <button id="friendRequestsBtn" class="retro-btn hover-blue flex items-center gap-2">
        <img class="btn-icon" src="/images/inbox.png" alt="Inbox">
        <span id="requestsCount">0</span> Requests
      </button>
    </div>
    
    <!-- Contenu principal -->
    <div class="container mx-auto px-4 py-20">
      <div class="flex flex-col items-center">
        <!-- Titre -->
        <h1 class="page-title-large page-title-blue friends-page-title mb-12">Find Friends</h1>
    
        <!-- Container principal -->
        <div class="w-full max-w-7xl px-2">
          <!-- Zone de chargement -->
          <div id="friendsLoading" class="text-center">
            <p class="text-gray-600 text-lg">Loading users...</p>
          </div>
          
          <!-- Liste des utilisateurs -->
          <div id="usersList" class="space-y-3 mt-5" style="display: none;">
            <!-- Les utilisateurs seront ajoutés ici dynamiquement -->
          </div>
          
          <!-- Message d'erreur -->
          <div id="friendsError" class="text-center" style="display: none;">
            <p class="text-red-600 text-lg">Error loading users</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  `;
}

/**
 * Attache les event listeners de la page friends
 */
export function attachFriendsEvents() {
  // Fonction pour charger et afficher tous les utilisateurs
  async function loadAllUsers() {
    try {
      const token = localStorage.getItem('token');
      const currentUsername = localStorage.getItem('currentUsername');
      
      if (!token) {
        location.hash = '#/login';
        return;
      }

      const response = await fetch('/api/users/all', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }

      const users = await response.json();
      
      // Masquer le loader et afficher la liste
      document.getElementById('friendsLoading')!.style.display = 'none';
      document.getElementById('usersList')!.style.display = 'block';
      
      const usersList = document.getElementById('usersList')!;
      
      // Filtrer l'utilisateur actuel
      const otherUsers = users.filter((user: any) => user.username !== currentUsername);
      
      if (otherUsers.length === 0) {
        usersList.innerHTML = `
          <div class="text-center py-8">
            <p class="text-gray-600 text-lg">No other users found.</p>
          </div>
        `;
        return;
      }
      
      // Générer le HTML pour chaque utilisateur
      const usersHTML = await Promise.all(otherUsers.map(async (user: any) => {
        // Utiliser getUserAvatarPath pour l'avatar par défaut ou uploadé
        const avatarPath = getUserAvatarPath(user.id, user.avatar);
        const status = await getFriendshipStatus(user.id);
        
        let buttonText = 'ADD';
        let buttonClass = 'add-friend-btn';
        let buttonDisabled = '';
        
        if (status === 'sent') {
          buttonText = 'SENT';
          buttonClass = 'add-friend-btn-sent';
          buttonDisabled = 'disabled';
        } else if (status === 'received') {
          buttonText = 'RECEIVED';
          buttonClass = 'add-friend-btn-received';
          buttonDisabled = 'disabled';
        } else if (status === 'friend') {
          buttonText = 'FRIEND';
          buttonClass = 'add-friend-btn-friend';
          buttonDisabled = 'disabled';
        }
        
        return `
          <div class="user-item-box" data-user-id="${user.id}" data-username="${user.username}" style="cursor: pointer;">
            <div class="user-info">
              <div class="user-mini-avatar" style="background-image: url('${avatarPath}');">
              </div>
              <span class="user-name">${user.username}</span>
            </div>
            <button class="${buttonClass}" data-user-id="${user.id}" data-username="${user.username}" data-status="${status}" ${buttonDisabled}>
              ${buttonText}
            </button>
          </div>
        `;
      }));
      
      usersList.innerHTML = usersHTML.join('');
      
      // Ajouter les gestionnaires d'événements pour les clics sur les boîtes utilisateurs
      const userBoxes = document.querySelectorAll('.user-item-box');
      userBoxes.forEach(box => {
        box.addEventListener('click', async (e) => {
          // Ne pas déclencher si on clique sur le bouton
          const target = e.target as HTMLElement;
          if (target.classList.contains('add-friend-btn') || 
              target.classList.contains('add-friend-btn-sent') || 
              target.classList.contains('add-friend-btn-friend')) {
            return;
          }
          
          const userId = (box as HTMLElement).dataset.userId;
          const username = (box as HTMLElement).dataset.username;
          
          // Stocker les infos de l'ami à visualiser
          localStorage.setItem('viewingFriendUserId', userId || '');
          localStorage.setItem('viewingFriendUsername', username || '');
          
          // Naviguer vers la page profil ami
          location.hash = '#/friends-profile';
        });
      });
      
      // Ajouter les gestionnaires d'événements pour les boutons "Ajouter"
      const addFriendButtons = document.querySelectorAll('.add-friend-btn');
      addFriendButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
          e.stopPropagation(); // Empêcher le clic de la boîte parente
          
          const target = e.target as HTMLButtonElement;
          const userId = parseInt(target.dataset.userId || '0');
          const username = target.dataset.username;
          
          if (!userId) return;
          
          // Désactiver temporairement le bouton
          target.disabled = true;
          target.textContent = 'SENDING...';
          
          try {
            const result = await sendFriendRequest(userId);
            
            if (result.success) {
              // Succès - mettre à jour l'interface
              target.textContent = 'SENT';
              target.className = 'add-friend-btn-sent';
              target.disabled = true;
              console.log(`Friend request sent to ${username}`);
            } else {
              // Erreur - afficher le message et remettre le bouton à l'état initial
              if (result.message) {
                alert(result.message);
              } else if (result.error) {
                alert(`Error: ${result.error}`);
              }
              
              target.disabled = false;
              target.textContent = 'ADD';
              
              if (result.error === 'friendship_exists') {
                // Une relation existe déjà, recharger le statut
                const status = await getFriendshipStatus(userId);
                if (status === 'sent') {
                  target.textContent = 'SENT';
                  target.className = 'add-friend-btn-sent';
                  target.disabled = true;
                } else if (status === 'received') {
                  target.textContent = 'RECEIVED';
                  target.className = 'add-friend-btn-received';
                  target.disabled = true;
                } else if (status === 'friend') {
                  target.textContent = 'FRIEND';
                  target.className = 'add-friend-btn-friend';
                  target.disabled = true;
                }
              } else {
                console.error('Error sending friend request:', result.error);
              }
            }
          } catch (error) {
            // Erreur réseau - remettre le bouton à l'état initial
            target.disabled = false;
            target.textContent = 'ADD';
            console.error('Network error sending friend request:', error);
          }
        });
      });

    } catch (error) {
      console.error('Error loading users:', error);
      document.getElementById('friendsLoading')!.style.display = 'none';
      document.getElementById('friendsError')!.style.display = 'block';
    }
  }
  
  // Charger les utilisateurs
  loadAllUsers();
  
  // Charger et afficher le nombre de demandes d'amis
  async function loadRequestsCount() {
    try {
      const requests = await getFriendRequests();
      const count = requests.length;
      const countElement = document.getElementById('requestsCount');
      if (countElement) {
        countElement.textContent = count.toString();
      }
    } catch (error) {
      console.error('Error loading requests count:', error);
    }
  }
  
  loadRequestsCount();
  
  // Gestion du bouton Friend Requests
  document.getElementById('friendRequestsBtn')?.addEventListener('click', () => {
    location.hash = '#/friend-requests';
  });
  
  // Gestion du bouton retour
  document.getElementById('backToHomeFromFriends')?.addEventListener('click', () => {
   
    location.hash = '';
  });
}
