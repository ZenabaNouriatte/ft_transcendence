// ROUTER SPA - Version modulaire
// Ce fichier orchestre la navigation et l'affichage des pages

import { 
  getHomeHTML, attachHomeEvents,
  getLoginHTML, attachLoginEvents,
  getSignUpHTML, attachSignUpEvents,
  getClassicHTML, attachClassicEvents,
  getTournamentHTML, attachTournamentEvents,
  getTournamentTransitionHTML, attachTournamentTransitionEvents,
  getVictoryHTML, attachVictoryEvents,
  getGameHTML, attachGameEvents, cleanupGameClient,
  getOnlineHTML, attachOnlineEvents, cleanupOnline,
  getProfileHTML, attachProfileEvents,
  getFriendsHTML, attachFriendsEvents,
  getFriendsProfileHTML, attachFriendsProfileEvents,
  getFriendRequestsHTML, attachFriendRequestsEvents
} from './pages/index.js';

import { syncAuthFromBackend } from './auth.js';
import { Presence } from './websocket.js';
import { handleChatMessage, loadChatMessagesFromStorage } from './chat/state.js';
import { updateChatDisplay, ensureChatOverlayExists } from './chat/ui.js';
import { isUserBlocked, loadBlockedUsers } from './blocking/index.js';
import * as Chat from './chat/index.js';

// Type pour les routes
type PageRenderer = {
  getHTML: () => string;
  attachEvents: () => void;
  cleanup?: () => void;
};

// Objet contenant toutes les routes
const routes: Record<string, PageRenderer> = {
  '': {
    getHTML: getHomeHTML,
    attachEvents: attachHomeEvents
  },
  '#/login': {
    getHTML: getLoginHTML,
    attachEvents: attachLoginEvents
  },
  '#/sign-up': {
    getHTML: getSignUpHTML,
    attachEvents: attachSignUpEvents
  },
  '#/classic': {
    getHTML: getClassicHTML,
    attachEvents: attachClassicEvents
  },
  '#/tournament': {
    getHTML: getTournamentHTML,
    attachEvents: attachTournamentEvents
  },
  '#/tournament-transition': {
    getHTML: getTournamentTransitionHTML,
    attachEvents: attachTournamentTransitionEvents
  },
  '#/victory': {
    getHTML: getVictoryHTML,
    attachEvents: attachVictoryEvents
  },
  '#/game': {
    getHTML: getGameHTML,
    attachEvents: attachGameEvents,
    cleanup: cleanupGameClient
  },
  '#/online': {
    getHTML: getOnlineHTML,
    attachEvents: attachOnlineEvents,
    cleanup: cleanupOnline
  },
  '#/profile': {
    getHTML: getProfileHTML,
    attachEvents: attachProfileEvents
  },
  '#/friends': {
    getHTML: getFriendsHTML,
    attachEvents: attachFriendsEvents
  },
  '#/friends-profile': {
    getHTML: getFriendsProfileHTML,
    attachEvents: attachFriendsProfileEvents
  },
  '#/friend-requests': {
    getHTML: getFriendRequestsHTML,
    attachEvents: attachFriendRequestsEvents
  }
};

// Variable pour garder trace de la page actuelle
let currentRoute: string = '';

/**
 * Fonction principale de rendu
 */
async function render() {
  const root = document.getElementById('app');
  if (!root) return;

  // Extraire la route sans les query parameters
  const fullHash = location.hash || '';
  const route = fullHash.split('?')[0]; // Prendre seulement la partie avant le ?
  
  console.log('[Router] Full hash:', fullHash);
  console.log('[Router] Route (without params):', route);

  // Nettoyer la page précédente si elle a une fonction cleanup
  if (currentRoute && routes[currentRoute]?.cleanup) {
    routes[currentRoute].cleanup!();
  }

  // Mettre à jour la route actuelle
  currentRoute = route;

  // Récupérer le renderer de la page
  const pageRenderer = routes[route];
  
  if (!pageRenderer) {
    // Route non trouvée, rediriger vers l'accueil
    location.hash = '';
    return;
  }

  // Afficher le HTML de la page
  root.innerHTML = pageRenderer.getHTML();

  // Injecter le chat overlay si l'utilisateur est connecté
  const currentUsername = localStorage.getItem('currentUsername');
  const isLoggedIn = currentUsername && currentUsername !== 'Guest';
  if (isLoggedIn) {
    ensureChatOverlayExists();
  }

  // Attacher les event listeners
  pageRenderer.attachEvents();
}

/**
 * Initialisation de l'application
 */
async function initializeApp() {
  try {
    // Synchroniser l'authentification avec le backend
    await syncAuthFromBackend();
  } catch (error) {
    console.error('[Router] Error during auth sync:', error);
  }

  // Charger les messages du chat depuis localStorage
  loadChatMessagesFromStorage();

  // Connecter le WebSocket si un token existe
  const token = localStorage.getItem('token');
  console.log('[Router] Token found:', !!token);
  if (token) {
    console.log('[Router] Connecting WebSocket...');
    Presence.connect(token);
    
    // Charger la liste des utilisateurs bloqués
    await loadBlockedUsers();
    
    // Créer le chat overlay immédiatement pour que les messages puissent s'afficher
    ensureChatOverlayExists();
    
    // Enregistrer le handler pour les messages de chat
    console.log('[Router] Registering chat.message handler...');
    Presence.on('chat.message', (data: any) => {
      console.log('[Router] Handler called!');
      handleChatMessage(data, isUserBlocked, updateChatDisplay);
    });
    console.log('[Router] Handler registered');
    
    // Enregistrer le handler pour les messages directs (DM)
    Presence.on('dm.message', (data: any) => {
      console.log('[Router] DM message received:', data);
      if (data.data) {
        Chat.DM.handleIncomingDm(data.data);
      }
    });
    
    // Enregistrer le handler pour les invitations de jeu
    Presence.on('game.invitation', (message: any) => {
      console.log('[Router] 🎮🎮🎮 Game invitation received, full message:', message);
      console.log('[Router] 🎮 message.data:', message.data);
      if (message.data) {
        Chat.DM.handleGameInvitation(message.data);
      } else {
        console.error('[Router] 🎮 ❌ No data in game invitation message!');
      }
    });
  } else {
    // Pas d'authentification, nettoyer l'UI locale
    console.log('[Router] No token, cleaning up');
    localStorage.removeItem('currentUsername');
  }

  // Premier rendu
  render();
}

// Écouter les événements de navigation
window.addEventListener('DOMContentLoaded', initializeApp);
window.addEventListener('hashchange', render);

// Exporter la fonction render pour utilisation externe si nécessaire
export { render };
