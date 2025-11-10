// PAGE D'ACCUEIL

import { toggleChat, ensureChatOverlayExists, attachChatEventListeners, getChatOverlayHTML } from '../chat/index.js';
import { getCurrentUserId } from '../auth.js';
import { getUserProfile } from '../user/index.js';
import { getUserAvatarPath } from '../utils/helpers.js';

// Retourne le HTML de la page d'accueil
export function getHomeHTML(): string {
  // Vérifier si un utilisateur est connecté
  const currentUsername = localStorage.getItem('currentUsername');
  const token = localStorage.getItem('token');
  const isLoggedIn = currentUsername && currentUsername !== 'Guest';
  
  // Générer les boutons d'authentification selon l'état de connexion
  const authButtons = isLoggedIn 
    ? `<!-- Boutons utilisateur connecté en haut à droite -->
       <div class="fixed top-8 right-8 z-10 flex gap-3">
         <button id="chatBtn" class="retro-btn-round" title="Chat">
           <img class="btn-icon-round" src="/images/chat-removebg-preview.png" alt="Chat">
         </button>
         <button id="findFriendsBtn" class="retro-btn-round">
           <img class="btn-icon-round" src="/images/search.png" alt="Search">
         </button>
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
          <button id="tournamentBtn" class="retro-btn-wide hover-orange">
            <img class="btn-icon" src="/images/tournament.png" alt="Tournament">TOURNAMENT
          </button>
          <button id="onlineBtn" class="retro-btn hover-purple">
            <img class="btn-icon" src="/images/remote.png" alt="Online">ONLINE
          </button>
        </div>
      </div>
    </div>
    
    ${getChatOverlayHTML()}
  </div>
  `;
}

// Attache les event listeners de la page d'accueil
export function attachHomeEvents() {
  const currentUsername = localStorage.getItem('currentUsername');
  const isLoggedIn = currentUsername && currentUsername !== 'Guest';
  
  // Injecter le chat overlay si l'utilisateur est connecté
  if (isLoggedIn) {
    ensureChatOverlayExists();
  }

  // Gestion des boutons de choix du mode de jeu
  document.getElementById("classicBtn")?.addEventListener("click", () => {
    location.hash = "#/classic";
  });
  document.getElementById("onlineBtn")?.addEventListener("click", () => {
    location.hash = "#/online";
  });
  document.getElementById("tournamentBtn")?.addEventListener("click", () => {
    location.hash = "#/tournament";
  });
  
  // Gestions des boutons en fonction de l'état de connexion
  if (isLoggedIn) {
    // Ouvre le modale de chat
    document.getElementById("chatBtn")?.addEventListener("click", () => {
      toggleChat();
    });
    
    // Dirige vers le profil utilisateur
    document.getElementById("userProfileBtn")?.addEventListener("click", () => {
      location.hash = "#/profile";
    });
    
    // Dirige vers la recherche d'amis
    document.getElementById("findFriendsBtn")?.addEventListener("click", () => {
      location.hash = "#/friends";
    });

    // Charger l'avatar de l'utilisateur dans le mini bouton
    async function loadUserMiniAvatar() {
      try {
        const userId = await getCurrentUserId();
        const profileData = await getUserProfile(userId);
        const miniAvatar = document.getElementById('userMiniAvatar') as HTMLElement;
        
        if (miniAvatar) {
          const avatarPath = getUserAvatarPath(userId, profileData?.user?.avatar);
          miniAvatar.style.backgroundImage = `url('${avatarPath}')`;
        }
      } catch (error) {
        // Erreur silencieuse pour le mini avatar
      }
    }

    // Charger le mini avatar
    loadUserMiniAvatar();
  } else {
    // Dirige vers la page de login
    document.getElementById("loginBtn")?.addEventListener("click", () => {
      location.hash = "#/login";
    });
    // Dirige vers la page de sign up
    document.getElementById("signUpBtn")?.addEventListener("click", () => {
      location.hash = "#/sign-up";
    });
  }
  
  // Event listeners du Chat (toujours actifs si user connecté)
  if (isLoggedIn && document.getElementById('chatOverlay')) {
    attachChatEventListeners();
  }
}
