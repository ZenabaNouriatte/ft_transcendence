import { getFriendRequests, acceptFriendRequest, declineFriendRequest } from '../friends/index.js';
import { getUserAvatarPath } from '../utils/helpers.js';

/**
 * Retourne le HTML de la page demandes d'amis
 */
export function getFriendRequestsHTML(): string {
  return `
  <div class="min-h-screen friends-requests-page">
    <!-- Bouton retour à Friends -->
    <div class="fixed top-8 left-8 z-10">
      <button id="backToFriendsFromRequests" class="retro-btn flex items-center gap-2">
        ← Friends
      </button>
    </div>
    
    <!-- Contenu principal -->
    <div class="container mx-auto px-4 py-20">
      <div class="flex flex-col items-center">
        <!-- Titre -->
        <h1 class="page-title-large page-title-blue friends-requests-page-title mb-12">Friend Requests</h1>
    
        <!-- Container principal -->
        <div class="w-full max-w-7xl px-2">
          <!-- Zone de chargement -->
          <div id="requestsLoading" class="text-center">
            <p class="text-gray-600 text-lg">Loading requests...</p>
          </div>
          
          <!-- Liste des demandes -->
          <div id="requestsList" class="space-y-3 mt-5" style="display: none;">
            <!-- Les demandes seront ajoutées ici dynamiquement -->
          </div>
          
          <!-- Message d'erreur -->
          <div id="requestsError" class="text-center" style="display: none;">
            <p class="text-red-600 text-lg">Error loading requests</p>
          </div>
          
          <!-- Message aucune demande -->
          <div id="noRequests" class="text-center" style="display: none;">
            <p class="text-gray-600 text-lg">No pending friend requests</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  `;
}

/**
 * Attache les event listeners de la page demandes d'amis
 */
export function attachFriendRequestsEvents() {
  // Fonction pour charger et afficher les demandes d'amis
  async function loadFriendRequests() {
    try {
      const requests = await getFriendRequests();
      
      // Masquer le loader
      document.getElementById('requestsLoading')!.style.display = 'none';
      
      if (requests.length === 0) {
        document.getElementById('noRequests')!.style.display = 'block';
        return;
      }
      
      // Afficher la liste
      document.getElementById('requestsList')!.style.display = 'block';
      
      const requestsList = document.getElementById('requestsList')!;
      
      // Générer le HTML pour chaque demande
      const requestsHTML = requests.map((request: any) => {
        const avatarPath = getUserAvatarPath(request.user_id, request.avatar);
        const date = new Date(request.created_at).toLocaleDateString();
        
        return `
          <div class="user-item-box">
            <div class="user-info">
              <div class="user-mini-avatar" style="background-image: url('${avatarPath}');">
              </div>
              <div>
                <span class="user-name">${request.username}</span>
                <div class="text-sm text-gray-600">Sent: ${date}</div>
              </div>
            </div>
            <div class="flex gap-2">
              <button class="accept-request-btn" data-request-id="${request.id}" data-username="${request.username}">
                ✓ ACCEPT
              </button>
              <button class="decline-request-btn" data-request-id="${request.id}">
                ✗ DECLINE
              </button>
            </div>
          </div>
        `;
      }).join('');
      
      requestsList.innerHTML = requestsHTML;
      
      // Ajouter les gestionnaires d'événements pour les boutons Accept/Decline
      const acceptButtons = document.querySelectorAll('.accept-request-btn');
      acceptButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
          const target = e.target as HTMLButtonElement;
          const requestId = parseInt(target.dataset.requestId || '0');
          const username = target.dataset.username;
          
          if (!requestId) return;
          
          // Désactiver temporairement le bouton
          target.disabled = true;
          target.textContent = 'ACCEPTING...';
          
          try {
            const success = await acceptFriendRequest(requestId);
            
            if (success) {
              // Supprimer la demande de la liste
              const requestBox = target.closest('.user-item-box');
              if (requestBox) {
                requestBox.remove();
              }
              
              // Vérifier s'il reste des demandes
              const remainingRequests = document.querySelectorAll('.user-item-box');
              if (remainingRequests.length === 0) {
                document.getElementById('requestsList')!.style.display = 'none';
                document.getElementById('noRequests')!.style.display = 'block';
              }
              
              console.log(`Friend request from ${username} accepted`);
            } else {
              // Erreur - remettre le bouton à l'état initial
              target.disabled = false;
              target.textContent = '✓ ACCEPT';
              console.error('Error accepting friend request');
            }
          } catch (error) {
            // Erreur réseau - remettre le bouton à l'état initial
            target.disabled = false;
            target.textContent = '✓ ACCEPT';
            console.error('Network error accepting friend request:', error);
          }
        });
      });
      
      const declineButtons = document.querySelectorAll('.decline-request-btn');
      declineButtons.forEach(button => {
        button.addEventListener('click', async (e) => {
          const target = e.target as HTMLButtonElement;
          const requestId = parseInt(target.dataset.requestId || '0');
          
          if (!requestId) return;
          
          // Appeler l'API pour décliner la demande
          const success = await declineFriendRequest(requestId);
          
          if (success) {
            // Supprimer visuellement la demande
            const requestBox = target.closest('.user-item-box');
            if (requestBox) {
              requestBox.remove();
            }
            
            // Vérifier s'il reste des demandes
            const remainingRequests = document.querySelectorAll('.user-item-box');
            if (remainingRequests.length === 0) {
              document.getElementById('requestsList')!.style.display = 'none';
              document.getElementById('noRequests')!.style.display = 'block';
            }
            
            console.log(`Friend request declined (ID: ${requestId})`);
          } else {
            console.error('Failed to decline friend request');
            alert('Failed to decline friend request. Please try again.');
          }
        });
      });
      
    } catch (error) {
      console.error('Error loading friend requests:', error);
      document.getElementById('requestsLoading')!.style.display = 'none';
      document.getElementById('requestsError')!.style.display = 'block';
    }
  }
  
  // Charger les demandes d'amis
  loadFriendRequests();
  
  // Gestion du bouton retour
  document.getElementById('backToFriendsFromRequests')?.addEventListener('click', () => {
    location.hash = '#/friends';
  });
}
