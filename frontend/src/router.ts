// ROUTER SPA - Version modulaire
// Ce fichier orchestre la navigation et l'affichage des pages

// Importe pour chaque page son HTML et ses event listeners
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

// Importe les fonctionnalités qui fonctionnent sur toutes les pages
import { syncAuthFromBackend } from './auth.js';
import { Presence } from './websocket.js';
import { handleChatMessage, loadChatMessagesFromStorage } from './chat/state.js';
import { updateChatDisplay, ensureChatOverlayExists } from './chat/ui.js';
import { isUserBlocked, loadBlockedUsers } from './blocking/index.js';
import * as Chat from './chat/index.js';

// Définition des types de l'objet nécessaire à chaque route
type PageRenderer = {
  getHTML: () => string;
  attachEvents: () => void;
  cleanup?: () => void;
};

// CREATION DES ROUTES
// Avec le HTML, les events, et le cleanup si nécessaire
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

// Variable pour sauvegarder la route actuellement affichée, afin de pouvoir appeler cleanup() si nécessaire
let currentRoute: string = '';

// FONCTION PRINCIPALE DE RENDU
// Responsable d'afficher la page correcte selon la route
async function render() {
  // Récupère le conteneur principal de l'application
  const root = document.getElementById('app');
  if (!root) return;

  // Extrait la route de l'URL
  const fullHash = location.hash || '';
  const route = fullHash.split('?')[0]; // Prendre seulement la partie avant le ?
  
  console.log('[Router] Full hash:', fullHash);

  // Nettoie la page précédente si elle a une fonction cleanup
  if (currentRoute && routes[currentRoute]?.cleanup) {
    routes[currentRoute].cleanup!();
  }

  // Met à jour la route actuelle
  currentRoute = route;

  // Récupère le pageRenderer de la page
  const pageRenderer = routes[route];
  
  // Route non trouvée, rediriger vers l'accueil
  if (!pageRenderer) {
    location.hash = '';
    return;
  }

  // Remplace tout le contenu du conteneur de l'app par le HTML de la nouvelle page.
  root.innerHTML = pageRenderer.getHTML();

  // Affiche le chat overlay si l'utilisateur est connecté
  const currentUsername = localStorage.getItem('currentUsername');
  const isLoggedIn = currentUsername && currentUsername !== 'Guest';
  if (isLoggedIn) {
    ensureChatOverlayExists();
  }

  // Attacher les événements spécifiques à la page
  pageRenderer.attachEvents();
}

// DÉMARRAGE DE L'APPLICATION
async function initializeApp() {
  // Vérifie l'authentification de l'utilisateur avec le backend
  try {
    await syncAuthFromBackend();
  } catch (error) {
    console.error('[Router] Error during auth sync:', error);
  }

  // Charge les anciens messages du chat depuis localStorage
  loadChatMessagesFromStorage();

  // Connecte le WebSocket si un token existe pour être connecté en temps réel
  const token = localStorage.getItem('token');
  console.log('[Router] Token found:', !!token);

  // COMMUNICATION CHAT EN TEMPS RÉEL VIA WEBSOCKET
  if (token) {
    // Connecte le WebSocket
    Presence.connect(token);
    
    // Charge la liste des utilisateurs bloqués
    await loadBlockedUsers();
    
    // Crée le chat overlay immédiatement pour que les messages puissent s'afficher
    ensureChatOverlayExists();

    // Initialisation du handler qui gère les messages entrants du chat global
    Presence.on('chat.message', (data: any) => {
      handleChatMessage(data, isUserBlocked, updateChatDisplay);
    });

    // Initialisation du handler qui gère les messages entrants des DM
    Presence.on('dm.message', (data: any) => {
      if (data.data) {
        Chat.DM.handleIncomingDm(data.data);
      }
    });

    // Initialisation du handler qui gère les invitations de jeu entrantes
    Presence.on('game.invitation', (message: any) => {
      if (message.data) {
        Chat.DM.handleGameInvitation(message.data);
      } else {
        console.error('[Router] No data in game invitation message!');
      }
    });
  } else {
    // Pas d'authentification, nettoyer l'UI locale
    localStorage.removeItem('currentUsername');
  }

  // Affiche la page initiale
  render();
}

// ÉCOUTER LES ÉVÉNEMENTS DE NAVIGATION
// Une fois que le navigateur a chargé le HTML, le style et les images il envoie l'événement DOMContentLoaded et on peut initialiser l'app
window.addEventListener('DOMContentLoaded', initializeApp);
// A chaque changement de hash, on appelle render pour afficher la nouvelle page
window.addEventListener('hashchange', render);

// Exporter la fonction render pour utilisation externe si nécessaire
export { render };
