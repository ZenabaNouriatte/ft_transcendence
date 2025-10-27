// ROUTEUR SPA (SINGLE PAGE APPLICATION)

 // Ce fichier gère toute la navigation et l'interface utilisateur de l'application.
 // Il implémente un système de routage basé sur les hash (#) de l'URL pour créer
 // une Single Page Application (SPA) avec plusieurs "pages" :

// Pages disponibles:
// - "/" (ou "") : Page d'accueil avec choix du mode de jeu
// - "#/classic" : Page de saisie des noms pour le mode classique (2 joueurs)
// - "#/tournament" : Page de création de tournoi dynamique (3-10 joueurs)
// - "#/game" : Page de jeu Pong avec canvas et contrôles
// - "#/victory" : Page de victoire avec affichage du gagnant et score final

import { GameClient } from './gameClient.js';
import * as DM from './dm.js';
console.log('[build] routeurSPA loaded @', new Date().toISOString());

// ===== Variables globales du Chat =====
let isChatOpen = false;
let chatMessages: Array<{userId: number, username: string, avatar: string | null, message: string, timestamp: Date}> = [];

// Charger les messages depuis localStorage au démarrage
function loadChatMessagesFromStorage() {
  try {
    const stored = localStorage.getItem('chatMessages');
    if (stored) {
      const parsed = JSON.parse(stored);
      // Convertir les timestamps de string à Date
      chatMessages = parsed.map((msg: any) => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));
      console.log('[CHAT] Loaded', chatMessages.length, 'messages from localStorage');
    }
  } catch (error) {
    console.error('[CHAT] Error loading messages from localStorage:', error);
    chatMessages = [];
  }
}

// Sauvegarder les messages dans localStorage
function saveChatMessagesToStorage() {
  try {
    // Garder seulement les 100 derniers messages pour ne pas surcharger localStorage
    const messagesToSave = chatMessages.slice(-100);
    localStorage.setItem('chatMessages', JSON.stringify(messagesToSave));
  } catch (error) {
    console.error('[CHAT] Error saving messages to localStorage:', error);
  }
}

// Charger les messages au démarrage
loadChatMessagesFromStorage();

// ===== Presence WS (singleton) =====
const Presence = (() => {
  let sock: WebSocket | null = null;
  let token: string | null = null;
  let reconnectTimer: number | null = null;

  function wsUrl(t: string) {
    // même host/port que la page -> OK derrière nginx
    return `wss://${location.host}/ws?channel=chat&token=${encodeURIComponent(t)}`;
  }

  function connect(t: string) {
    token = t;
    disconnect();
    if (!token) return;

    const u = wsUrl(token);
    sock = new WebSocket(u);

    sock.onopen = () => console.log('[presence]✅ WebSocket opened');
    sock.onmessage = (e) => {
      console.log('[WS] Message received:', e.data);
      
      // Ignorer les messages non-JSON comme "hello: connected"
      if (!e.data.startsWith('{')) {
        return;
      }
      
      try {
        const data = JSON.parse(e.data);
        console.log('[WS] Parsed data type:', data.type);
        
        if (data.type === 'chat.message') {
          console.log('[CHAT] Message reçu:', data);
          // Nouveau message de chat reçu
          const newMessage = {
            userId: data.userId || 0,
            username: data.username || 'Anonyme',
            avatar: data.avatar || null,
            message: data.message || '',
            timestamp: new Date()
          };
          
          // Ne pas afficher les messages des utilisateurs bloqués
          if (!isUserBlocked(newMessage.userId)) {
            chatMessages.push(newMessage);
            saveChatMessagesToStorage(); // Sauvegarder dans localStorage
            console.log('[CHAT] Total messages:', chatMessages.length);
            updateChatDisplay();
          } else {
            console.log('[CHAT] Message from blocked user ignored:', newMessage.username);
          }
        } else if (data.type === 'dm.message' && data.data) {
          console.log('[DM] Message direct reçu:', data);
          // Message direct reçu
          DM.handleIncomingDm(data.data);
        } else if (data.type === 'dm.sent') {
          console.log('[DM] Message envoyé confirmé:', data);
          // Confirmation que notre message a été envoyé
        }
      } catch (error) {
        console.warn('[chat] Erreur parsing message:', error);
      }
    };
    sock.onclose = (e) => {
      console.log('[presence] ❌ WebSocket closed:', e.code, e.reason);
      sock = null;
      if (token && reconnectTimer === null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect(token!);
        }, 2000);
      }
    };
    sock.onerror = (e) => console.warn('[presence] ⚠️ WebSocket error:', e);
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sock && sock.readyState === WebSocket.OPEN) { 
      try { 
        sock.close(1000, 'bye'); 
        console.log('[presence] 🔌 Explicit disconnect');
      } catch {} 
    }
    sock = null;
  }

  function clear() {
    token = null;
    disconnect();
  }

  function send(message: any) {
    console.log('[Presence] send called, sock state:', sock?.readyState);
    console.log('[Presence] WebSocket.OPEN constant:', WebSocket.OPEN);
    if (sock && sock.readyState === WebSocket.OPEN) {
      console.log('[Presence] Sending message:', JSON.stringify(message));
      sock.send(JSON.stringify(message));
    } else {
      console.error('[presence] Cannot send message: WebSocket not connected. State:', sock?.readyState);
    }
  }

  return { connect, disconnect, clear, send };
})();

window.addEventListener('beforeunload', () => {
  console.log('[presence] 🚪 Page closing, disconnecting WebSocket...');
  Presence.disconnect();
});

// ===== Système de Chat =====
function updateChatDisplay() {
  console.log('[CHAT] updateChatDisplay called');
  const chatMessagesContainer = document.getElementById('chatMessages');
  console.log('[CHAT] Container found:', !!chatMessagesContainer);
  console.log('[CHAT] Messages to display:', chatMessages.length);
  
  if (!chatMessagesContainer) {
    console.error('[CHAT] Container #chatMessages not found!');
    return;
  }

  const html = chatMessages
    .slice(-50) // Garde seulement les 50 derniers messages
    .map(msg => {
      // Obtenir le chemin de l'avatar de l'utilisateur (personnalisé ou par défaut)
      const avatarPath = getUserAvatarPath(msg.userId, msg.avatar);
      
      // Formater l'heure sans les secondes (HH:MM)
      const timeString = msg.timestamp.toLocaleTimeString('fr-FR', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      return `
        <div class="chat-message" style="display: flex; align-items: center; gap: 4px; padding: 8px 12px;">
          <div class="chat-avatar" style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid #ff8c00; overflow: hidden; flex-shrink: 0; background-image: url('${avatarPath}'); background-size: cover; background-position: center;"></div>
          <div style="flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px;">
            <span class="chat-username" style="cursor: pointer; font-weight: bold; color: #ff8c00; text-decoration: none; transition: all 0.2s; flex-shrink: 0;" 
                  onmouseover="this.style.opacity='0.7'; this.style.textDecoration='underline';" 
                  onmouseout="this.style.opacity='1'; this.style.textDecoration='none';"
                  onclick="localStorage.setItem('viewingFriendUserId', '${msg.userId}'); localStorage.setItem('viewingFriendUsername', '${escapeHtml(msg.username)}'); location.hash = '#/friends-profile';">${escapeHtml(msg.username)}:</span>
            <span class="chat-text" style="flex: 1; min-width: 0; word-break: break-word;">${escapeHtml(msg.message)}</span>
            <span class="chat-time" style="font-size: 0.85em; color: #888; flex-shrink: 0; margin-right: 8px;">${timeString}</span>
          </div>
        </div>
      `;
    }).join('');
  
  console.log('[CHAT] Generated HTML length:', html.length);
  chatMessagesContainer.innerHTML = html;
  
  // Scroll automatique vers le bas
  chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
}

function sendChatMessage(message: string) {
  console.log('[CHAT] sendChatMessage called with:', message);
  if (!message.trim()) {
    console.log('[CHAT] Message empty, not sending');
    return;
  }
  
  const payload = {
    type: 'chat.message',
    data: {
      message: message.trim()
    }
  };
  console.log('[CHAT] Sending payload:', payload);
  Presence.send(payload);
}

function toggleChat() {
  isChatOpen = !isChatOpen;
  const chatOverlay = document.getElementById('chatOverlay');
  if (chatOverlay) {
    chatOverlay.style.display = isChatOpen ? 'flex' : 'none';
    // Afficher les messages quand on ouvre le chat
    if (isChatOpen) {
      updateChatDisplay();
    }
  }
}

// Injecter le chat overlay dans le DOM s'il n'existe pas déjà
function ensureChatOverlayExists() {
  if (!document.getElementById('chatOverlay')) {
    const chatContainer = document.createElement('div');
    chatContainer.innerHTML = getChatOverlayHTML();
    document.body.appendChild(chatContainer.firstElementChild as HTMLElement);
    console.log('[CHAT] Chat overlay injected into DOM');
    // Attacher les event listeners après injection
    attachChatEventListeners();
  }
}

// Fonction pour attacher les event listeners du chat
function attachChatEventListeners() {
  console.log('[CHAT] Attaching event listeners');
  
  document.getElementById("closeChatBtn")?.addEventListener("click", () => {
    toggleChat();
  });
  
  document.getElementById("sendChatBtn")?.addEventListener("click", () => {
    const input = document.getElementById("chatInput") as HTMLInputElement;
    if (input && input.value.trim()) {
      sendChatMessage(input.value);
      input.value = '';
    }
  });

  document.getElementById("chatInput")?.addEventListener("keypress", (e) => {
    if (e.key === 'Enter') {
      const input = e.target as HTMLInputElement;
      if (input && input.value.trim()) {
        sendChatMessage(input.value);
        input.value = '';
      }
    }
  });

  document.getElementById("chatTabGlobal")?.addEventListener("click", () => {
    DM.switchToGlobalTab();
  });

  document.getElementById("chatTabMessages")?.addEventListener("click", () => {
    DM.switchToDmTab();
  });

  document.getElementById("dmBackBtn")?.addEventListener("click", () => {
    DM.closeDmConversation();
  });

  document.getElementById("sendDmBtn")?.addEventListener("click", () => {
    const input = document.getElementById("dmInput") as HTMLInputElement;
    const activeDmUserId = DM.getActiveDmUserId();
    if (input && input.value.trim() && activeDmUserId) {
      DM.sendDirectMessage(activeDmUserId, input.value);
      input.value = '';
    }
  });

  document.getElementById("dmInput")?.addEventListener("keypress", (e) => {
    if (e.key === 'Enter') {
      const input = e.target as HTMLInputElement;
      const activeDmUserId = DM.getActiveDmUserId();
      if (input && input.value.trim() && activeDmUserId) {
        DM.sendDirectMessage(activeDmUserId, input.value);
        input.value = '';
      }
    }
  });
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getChatOverlayHTML(): string {
  return `
    <!-- Chat Overlay -->
    <div id="chatOverlay" class="fixed inset-0 bg-black bg-opacity-50 z-50" style="display: none;">
      <div class="fixed right-4 top-4 bottom-4 w-[500px] rounded-lg flex flex-col chat-window-container" style="max-height: calc(100vh - 32px);">
        <!-- Header with Tabs -->
        <div class="chat-header flex-shrink-0">
          <div class="flex border-b border-orange-500">
            <button id="chatTabGlobal" class="flex-1 px-4 py-3 font-bold text-white chat-tab-active">
              Global
            </button>
            <button id="chatTabMessages" class="flex-1 px-4 py-3 font-bold text-gray-400 hover:text-white transition-colors">
              Messages <span id="dmUnreadBadge" class="hidden ml-1 px-2 py-0.5 text-xs bg-red-500 text-white rounded-full">0</span>
            </button>
          </div>
          <button id="closeChatBtn" class="absolute top-2 right-2 text-white hover:text-red-200 text-2xl font-bold">&times;</button>
        </div>
        
        <!-- Global Chat View -->
        <div id="globalChatView" class="flex-1 flex flex-col min-h-0">
          <!-- Messages Container -->
          <div id="chatMessages" class="flex-1 p-4 overflow-y-auto space-y-2 chat-messages-bg min-h-0">
            <!-- Messages will be added here dynamically -->
          </div>
          
          <!-- Input Area -->
          <div class="p-4 chat-input-area flex-shrink-0">
            <div class="flex gap-2 items-center justify-center">
              <input 
                id="chatInput" 
                type="text" 
                placeholder="Tapez votre message..." 
                class="flex-1 px-3 py-2 rounded focus:outline-none chat-input-field"
                maxlength="500"
              >
              <button id="sendChatBtn" class="px-6 py-2 rounded font-bold chat-send-btn whitespace-nowrap">
                Envoyer
              </button>
            </div>
          </div>
        </div>

        <!-- Direct Messages View -->
        <div id="dmView" class="flex-1 flex-col hidden min-h-0">
          <!-- Conversations List -->
          <div id="dmConversationsList" class="flex-1 overflow-y-auto min-h-0" style="background-color: rgba(241, 226, 191, 0.15);">
            <div class="p-4 text-center text-gray-400">
              Chargement des conversations...
            </div>
          </div>

          <!-- Active Conversation -->
          <div id="dmActiveConversation" class="hidden h-full">
            <div class="flex flex-col h-full">
            <!-- Conversation Header -->
            <div class="p-3 border-b border-orange-500 flex items-center gap-3 flex-shrink-0" style="background-color: rgba(241, 226, 191, 0.15);">
              <button id="dmBackBtn" class="text-white hover:text-orange-400 text-xl font-bold">←</button>
              <img id="dmActiveUserAvatar" src="" alt="" class="w-8 h-8 rounded-full border-2 border-orange-500">
              <div class="flex-1">
                <div id="dmActiveUserName" class="font-bold text-white"></div>
                <div id="dmActiveUserStatus" class="text-xs text-gray-400"></div>
              </div>
            </div>

            <!-- Messages Container -->
            <div id="dmMessages" class="flex-1 overflow-y-auto space-y-2 min-h-0 p-4" style="background-color: rgba(241, 226, 191, 0.15);">
              <!-- DM messages will be added here -->
            </div>

            <!-- Input Area -->
            <div class="p-4 chat-input-area flex-shrink-0">
              <div class="flex gap-2 items-center justify-center">
                <input 
                  id="dmInput" 
                  type="text" 
                  placeholder="Tapez votre message direct..." 
                  class="flex-1 px-3 py-2 rounded focus:outline-none chat-input-field"
                  maxlength="500"
                >
                <button id="sendDmBtn" class="px-6 py-2 rounded font-bold chat-send-btn whitespace-nowrap">
                  Envoyer
                </button>
              </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function bootPresenceFromStorage() {
  const t = localStorage.getItem('token');
  if (t) {
    Presence.connect(t);
    // Charger la liste des utilisateurs bloqués
    loadBlockedUsers();
  }
  // Fermer proprement la WS quand l’onglet se ferme (ne touche pas au token)
  window.addEventListener('beforeunload', () => {
    try { Presence.disconnect(); } catch {}
  });
}

// put this near your Presence block, top of routeurSPA.ts
async function syncAuthFromBackend(): Promise<void> {
  var t = localStorage.getItem('token');
  if (!t) {
    // pas loggé : nettoie juste le nom local
    localStorage.removeItem('currentUsername');
    return;
  }

  try {
    var r = await fetch('/api/users/me', {
      headers: { 'Authorization': 'Bearer ' + t }
    });

    if (!r.ok) {
      // token invalide → purge
      localStorage.removeItem('token');
      localStorage.removeItem('currentUsername');
      return;
    }

    var data = await r.json();
    var user = data && data.user ? data.user : null;

    if (user && user.username) {
      localStorage.setItem('currentUsername', user.username);
    } else {
      localStorage.removeItem('currentUsername');
    }
  } catch (_e) {
    // en cas d'erreur réseau, on ne casse pas l'app
  }
}

// Type pour une fonction qui retourne le HTML d'une page
type Route = () => string;

// Instance globale du client de jeu (null quand pas en jeu)
let currentGameClient: GameClient | null = null;

// Fonction pour obtenir l'avatar basé sur l'ID utilisateur (correspondance directe)
function getUserAvatarPath(userId: number, userAvatar?: string | null): string {
  // Si l'utilisateur a uploadé un avatar personnalisé, l'utiliser
  if (userAvatar && userAvatar.startsWith('/uploads/')) {
    return userAvatar;
  }
  
  // Sinon, utiliser l'image par défaut basée sur l'ID
  // ID direct: user 1 → image 1.JPG, user 2 → image 2.JPG, etc.
  // Si l'ID dépasse 15, on boucle (modulo)
  const imageNumber = userId > 15 ? ((userId - 1) % 15) + 1 : userId;
  return `/images/${imageNumber}.JPG`;
}

// Fonction pour récupérer l'ID utilisateur via API
async function getCurrentUserId(): Promise<number> {
  const t = localStorage.getItem('token');
  
  if (!t) {
    return 1; // invité par défaut
  }

  try {
    const r = await fetch('/api/users/me', {
      headers: { Authorization: `Bearer ${t}` },
    });
    
    if (!r.ok) {
      // Token invalide, le nettoyer
      localStorage.removeItem('token');
      localStorage.removeItem('currentUsername');
      throw new Error(`HTTP error! status: ${r.status}`);
    }
    
    const data = await r.json();
    
    const { user } = data;
    if (user?.id && user?.username) {
      localStorage.setItem('currentUsername', user.username); // keep name fresh
      return user.id;
    }
    localStorage.removeItem('currentUsername');
    return 1;
  } catch (e) {
    return 1;
  }
}

// Fonction pour créer un jeu en base de données
async function createGame(player1Username: string, player2Username: string, tournamentId?: number): Promise<number | null> {
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

// Fonction pour finaliser un jeu avec les scores
async function finishGame(gameId: number, player1Score: number, player2Score: number): Promise<boolean> {
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

// Rendre la fonction accessible globalement
(window as any).finishGame = finishGame;

// Fonction pour récupérer le profil complet d'un utilisateur (stats + historique)
async function getUserProfile(userId: number): Promise<any> {
  const token = localStorage.getItem('token');
  if (!token) {
    console.log('Pas de token pour récupérer le profil');
    return null;
  }

  try {
    console.log(`Récupération du profil pour l'utilisateur ${userId}`);
    
    const response = await fetch(`/api/users/${userId}/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log(`Réponse API profil: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erreur API profil: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log('Données profil reçues:', data);
    return data;
  } catch (error) {
    console.error('Erreur lors de la récupération du profil:', error);
    return null;
  }
}

// ===== FUNCTIONS AMIS =====
async function sendFriendRequest(targetId: number): Promise<{success: boolean, status?: string, error?: string, message?: string}> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/request', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetId })
    });

    const data = await response.json();
    if (response.ok) {
      return { success: true, status: data.status };
    } else {
      return { success: false, error: data.error, message: data.message };
    }
  } catch (error) {
    return { success: false, error: 'network_error' };
  }
}

async function getFriendshipStatus(targetId: number): Promise<string> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/friends/status/${targetId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.status;
    }
  } catch (error) {
    console.error('Error getting friendship status:', error);
  }
  return 'none';
}

async function getFriendRequests(): Promise<any[]> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/requests', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.requests || [];
    }
  } catch (error) {
    console.error('Error getting friend requests:', error);
  }
  return [];
}

async function acceptFriendRequest(requestId: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/accept', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requestId })
    });

    return response.ok;
  } catch (error) {
    return false;
  }
}

async function declineFriendRequest(requestId: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/decline', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requestId })
    });

    return response.ok;
  } catch (error) {
    return false;
  }
}

// ===== FONCTIONS DE BLOCAGE =====
let blockedUserIds: number[] = [];

async function loadBlockedUsers(): Promise<void> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/blocked', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      blockedUserIds = data.blockedUsers || [];
      console.log('[BLOCK] Loaded blocked users:', blockedUserIds);
    }
  } catch (error) {
    console.error('Error loading blocked users:', error);
  }
}

async function blockUser(targetId: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/block', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetId })
    });

    if (response.ok) {
      blockedUserIds.push(targetId);
      console.log('[BLOCK] User blocked:', targetId);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error blocking user:', error);
    return false;
  }
}

async function unblockUser(targetId: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/unblock', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetId })
    });

    if (response.ok) {
      blockedUserIds = blockedUserIds.filter(id => id !== targetId);
      console.log('[BLOCK] User unblocked:', targetId);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error unblocking user:', error);
    return false;
  }
}

function isUserBlocked(userId: number): boolean {
  return blockedUserIds.indexOf(userId) !== -1;
}

// Référence à l'écouteur de clavier pour pouvoir le nettoyer
let gameKeyListener: ((event: KeyboardEvent) => void) | null = null;


// DÉFINITION DES ROUTES ET TEMPLATES HTML
// Chaque route correspond à une "page" de l'application.
const routes: Record<string, Route> = {
  
  // PAGE D'ACCUEIL
  "": () => {
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
  },
  
  // PAGE MODE MULTIJOUEUR REMOTE
  // Interface WebSocket pour jouer en ligne
  "#/online": () => `
    <div class="flex flex-col items-center">
      <h1 class="page-title-large page-title-purple">Online Game</h1>
      <div class="form-box-purple">
        <div id="connectionStatus" class="mb-6 text-center">
          <span id="statusText" class="text-lg font-bold text-red-400">🔴 Disconnected</span>
        </div>
        
        <div class="mb-6">
          <label class="form-label">Create custom room name:</label>
          <input id="customRoomNameInput" class="styled-input w-full" 
                 placeholder="Enter custom room name (ex: 'MyGame')" maxlength="20">
        </div>
        
        <div class="mb-6">
          <label class="form-label">Or join existing room:</label>
          <input id="roomIdInput" class="styled-input w-full font-mono text-sm" 
                 placeholder="Enter room ID to join existing room" maxlength="50">
          <p class="text-sm text-gray-600 mt-2">Leave both empty to create a room with short auto-generated ID</p>
        </div>
        
        <div class="flex gap-4 mb-6">
        <button id="createRoomBtn" class="retro-btn hover-purple flex-1">
        Create Room
        </button>
        <button id="connectBtn" class="retro-btn hover-green flex-1">
          Join Room
        </button>
        </div>
        
        <!-- Players list (hidden until connected) -->
        <div id="playersInfo" class="hidden mb-6 p-4 rounded-lg" style="background-color: rgba(168, 136, 199, 0.2); border: 2px solid #a888c7;">
        <h3 class="text-lg font-bold mb-2" style="color: #a888c7;">Players:</h3>
        <div id="playersList" class="text-gray-700">
        No players connected
        </div>
        <div id="readyStatus" class="mt-4 p-3 rounded-lg hidden" style="background-color: rgba(168, 136, 199, 0.15); border: 2px solid #a888c7;">
        <h4 class="text-md font-bold mb-2 text-center" style="color: #a888c7;">Ready Status:</h4>
        <div class="text-sm text-center">
        <span style="color: #f0c35a; font-weight: bold;">Both players must be ready to start the game</span>
        </div>
        </div>
        </div>
        
        <!-- Game controls (hidden until connected) -->
        <div id="onlineGameControls" class="hidden mb-6">
          <div class="flex gap-4">
            <button id="readyBtn" class="retro-btn hover-orange flex-1">
              ✋ Ready Up!
            </button>
            <button id="startOnlineBtn" class="retro-btn hover-green flex-1 hidden" disabled>
              Launch Game
            </button>
          </div>
        </div>
        
        <!-- Players list (hidden until connected) -->
        <div id="playersInfo" class="hidden mb-6 p-4 bg-gray-800 rounded-lg">
          <h3 class="text-lg font-bold mb-2">Players:</h3>
          <div id="playersList" class="text-gray-300">
            No players connected
          </div>
          <div id="readyStatus" class="mt-4 p-3 bg-gray-700 rounded-lg hidden">
            <h4 class="text-md font-bold mb-2 text-center">Ready Status:</h4>
            <div class="text-sm text-center">
              <span class="text-orange-400">Both players must be ready to start the game</span>
            </div>
          </div>
        </div>
        
        <!-- Game canvas (hidden until game starts) -->
        <div id="onlineGameArea" class="hidden text-center">
          <canvas id="onlineCanvas" width="800" height="400" 
                  class="mb-4 border-2 border-blue-500 bg-black rounded-lg"></canvas>
          <div class="text-sm text-gray-400 mb-4">
            <strong>Controls:</strong> W/S or ↑/↓ to move • All players can control<br>
            <strong>Fullscreen:</strong> Double-click canvas or press F11
          </div>
          
          <!-- Boutons de contrôle du jeu online -->
          <div class="flex gap-4 justify-center mb-4">
            <button id="pauseOnlineBtn" class="retro-btn-small hover-blue">
              Pause
            </button>
            <button id="backFromOnlineGameBtn" class="retro-btn-small hover-blue">
              Back to Menu
            </button>
          </div>
        </div>
      </div>
      
      <!-- Bouton retour en dehors de la box -->
      <div class="mt-6">
        <button id="backFromOnlineBtn" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `,
  
  // PAGE MODE CLASSIC
  // Formulaire de saisie des noms des deux joueurs
  "#/classic": () => {
    const currentUsername = localStorage.getItem('currentUsername');
    const isLoggedIn = currentUsername && currentUsername !== 'Guest';
    
    return `
    <div class="flex flex-col items-center">
      <h1 class="page-title-large page-title-green">Classic</h1>
      <div class="form-box-green">
        <p class="form-description-green">Enter players' usernames:</p>
        
        <!-- Formulaire des deux joueurs en grid responsive -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label class="form-label"><span class="player-label-green">Player 1</span> (Left - W/S):</label>
            <input id="player1Input" class="styled-input ${isLoggedIn ? 'logged-user-classic' : ''}" 
                   placeholder="Player 1 username" maxlength="20" 
                   value="${isLoggedIn ? currentUsername : ''}"
                   ${isLoggedIn ? 'readonly' : ''}>
          </div>
          
          <div>
            <label class="form-label"><span class="player-label-green">Player 2</span> (Right - I/K):</label>
            <input id="player2Input" class="styled-input" 
                   placeholder="Player 2 username" maxlength="20">
          </div>
        </div>
        
        <button id="playBtn" class="retro-btn hover-green w-full">
          <img class="btn-icon" src="/images/classic.png" alt="Play">START GAME
        </button>
      </div>
      <div class="mt-6">
        <button id="backBtn" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
    `;
  },
  // PAGE TOURNAMENT - Saisie de 4 joueurs pour un tournoi
  "#/tournament": () => {
    const currentUsername = localStorage.getItem('currentUsername');
    const isLoggedIn = currentUsername && currentUsername !== 'Guest';
    
    return `
    <div class="flex flex-col items-center">
      <h1 class="page-title-large page-title-orange">Tournament</h1>
      <div class="form-box-orange">
        <p class="form-description-orange">Enter players' usernames:</p>
        
        <!-- Liste des 4 joueurs fixes -->
        <div id="playersList" class="mb-6">
          <div class="player-entry mb-4 flex items-center gap-3">
            <span class="w-8 player-number-orange">1.</span>
            <input type="text" class="player-input styled-input flex-1 ${isLoggedIn ? 'logged-user-tournament' : ''}" 
                   placeholder="Player 1 username" maxlength="20" data-index="0"
                   value="${isLoggedIn ? currentUsername : ''}"
                   ${isLoggedIn ? 'readonly' : ''}>
          </div>
          <div class="player-entry mb-4 flex items-center gap-3">
            <span class="w-8 player-number-orange">2.</span>
            <input type="text" class="player-input styled-input flex-1" placeholder="Player 2 username" maxlength="20" data-index="1">
          </div>
          <div class="player-entry mb-4 flex items-center gap-3">
            <span class="w-8 player-number-orange">3.</span>
            <input type="text" class="player-input styled-input flex-1" placeholder="Player 3 username" maxlength="20" data-index="2">
          </div>
          <div class="player-entry mb-4 flex items-center gap-3">
            <span class="w-8 player-number-orange">4.</span>
            <input type="text" class="player-input styled-input flex-1" placeholder="Player 4 username" maxlength="20" data-index="3">
          </div>
        </div>
        
        <button id="startTournamentBtn" class="retro-btn hover-orange w-full">
          <img class="btn-icon" src="/images/tournament.png" alt="Tournament">Start Tournament
        </button>
      </div>
      <div class="mt-6">
        <button id="backToMenuBtn" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
    `;
  },
  // PAGE DE TRANSITION ENTRE MATCHS DE TOURNOI
  "#/tournament-transition": () => `
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
  `,
  // PAGE DE VICTOIRE
  "#/victory": () => `
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
  `,
  // PAGE DE JEU PONG
  "#/game": () => `
    <div class="flex flex-col items-center">
      <!-- Affichage des noms des joueurs avec contrôles -->
      <!-- Largeur fixe 800px pour correspondre exactement à la largeur du canvas -->
      <div id="playerNames" class="mb-6 text-gray-800 flex items-center justify-between" style="width: 800px; position: relative;">
        <div class="flex flex-col items-center" style="width: 200px;">
          <span id="player1Display" class="text-xl font-bold text-black">Player 1</span>
          <span class="text-sm text-blue-900">(W/S or ↑/↓)</span>
        </div>
        <!-- "VS" centré absolument -->
        <span class="text-lg text-blue-900 font-medium absolute left-1/2 transform -translate-x-1/2">VS</span>
        <div class="flex flex-col items-center" style="width: 200px;">
          <span id="player2Display" class="text-xl font-bold text-black">Player 2</span>
          <span class="text-sm text-blue-900">(I/K)</span>
        </div>
      </div>
      
      <!-- Canvas de jeu (800x400) -->
      <canvas id="pongCanvas" class="mb-4"></canvas>
      
      <!-- Bouton Start (visible au début) -->
      <div id="startSection" class="flex gap-4 mb-4">
        <button id="startBtn" class="retro-btn">
          <img class="btn-icon" src="/images/classic.png" alt="Play">START GAME
        </button>
      </div>
      
      <!-- Boutons de contrôle du jeu (cachés au début, visibles une fois le jeu démarré) -->
      <div id="gameControls" class="hidden gap-4">
        <button id="pauseBtn" class="retro-btn-small hover-blue">
          Pause
        </button>
        <button id="backToMenuBtn" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `,
  // PAGE INSCRIPTION
  "#/sign-up": () => `
    <div class="flex flex-col items-center justify-center min-h-screen">
      <h1 class="page-title-large page-title-brown">Sign Up</h1>
      <div class="form-box-auth">
        <form id="signUpForm" class="space-y-4">
          <div>
            <label for="username" class="auth-label">Username</label>
            <input type="text" id="username" name="username" required
              class="styled-input"
              placeholder="Enter your username">
          </div>
          
          <div>
            <label for="email" class="auth-label">Email</label>
            <input type="email" id="email" name="email" required
              class="styled-input"
              placeholder="Enter your email">
          </div>
          
          <div>
            <label for="password" class="auth-label">Password</label>
            <input type="password" id="password" name="password" required
              class="styled-input"
              placeholder="Enter your password">
          </div>
          
          <button type="submit" id="signUpSubmit"
            class="retro-btn w-full">
            Create Account
          </button>
        </form>
        
        <div class="mt-6 text-center auth-navigation-container">
          <span class="auth-navigation-text">Already have an account? </span>
          <a href="#/login" class="auth-navigation-link">Login here</a>
        </div>
      </div>
      
      <div class="mt-6 text-center">
        <button id="backToMenuSignup" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `,
  // PAGE CONNEXION
  "#/login": () => `
    <div class="flex flex-col items-center justify-center min-h-screen">
      <h1 class="page-title-large page-title-brown">Login</h1>
      <div class="form-box-auth">
        <form id="loginForm" class="space-y-4">
          <div>
            <label for="loginUsername" class="auth-label">Username</label>
            <input type="text" id="loginUsername" name="username" required
              class="styled-input"
              placeholder="Enter your username">
          </div>
          
          <div>
            <label for="loginPassword" class="auth-label">Password</label>
            <input type="password" id="loginPassword" name="password" required
              class="styled-input"
              placeholder="Enter your password">
          </div>
          
          <button type="submit" id="loginSubmit"
            class="retro-btn w-full">
            Login
          </button>
        </form>
        
        <div class="mt-6 text-center auth-navigation-container">
          <span class="auth-navigation-text">Don't have an account? </span>
          <a href="#/sign-up" class="auth-navigation-link">Sign up here</a>
        </div>
      </div>
      
      <div class="mt-6 text-center">
        <button id="backToMenuLogin" class="retro-btn-small hover-blue">
          Back to Menu
        </button>
      </div>
    </div>
  `,
  // PAGE PROFIL
  "#/profile": () => {
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
      
      <!-- Modal de modification du profil -->
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
  },
  // PAGE AMIS
  "#/friends": () => `
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
  `,
  // PAGE PROFIL D'UN AMI
  "#/friends-profile": () => {
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
          <!-- Photo de profil avec image dynamique -->
          <div class="profile-photo mb-4">
            <img id="friendProfileAvatar" src="/images/1.JPG" alt="Profile Photo" 
                 style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;">
          </div>
          <h1 id="friendProfileUsername" class="page-title-large page-title-blue text-center mb-4">${friendUsername}</h1>
          
          <!-- Boutons Ajouter et Statut -->
          <div class="mb-4 flex gap-3 items-center">
            <button id="addFriendFromProfile" class="add-friend-btn">
              ADD
            </button>
            <button id="sendMessageBtn" class="message-round-btn" title="Envoyer un message">
              💬
            </button>
            <div id="friendStatusIndicator" class="status-offline-btn">
              <img src="/images/offline.png" alt="status" class="status-icon">
              OFFLINE
            </div>
          </div>
          
          <!-- Bouton Block centré -->
          <div class="mb-8 flex justify-center">
            <button id="blockUserBtn" class="block-user-btn">
              <span id="blockButtonText">BLOCK</span>
            </button>
          </div>
          
          <!-- Statistiques -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full max-w-6xl">
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
                  <span id="friendTournamentsWon" class="text-purple-600">Loading...</span>
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
        </div>
      </div>
    </div>
    `;
  },
  // PAGE DEMANDES D'AMIS
  "#/friend-requests": () => `
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
  `
};

// FONCTION PRINCIPALE DE RENDU
async function render() {
  const root = document.getElementById("app");
  if (!root) return;

  const route = location.hash || "";

  // Nettoyer le jeu précédent si on quitte la page de jeu
  if (currentGameClient && route !== "#/game") {
    await currentGameClient.stop(); // ✅ Maintenant asynchrone pour annuler la partie côté backend
    currentGameClient = null;
  }

  // Nettoyer l'écouteur de clavier si on quitte la page de jeu
  if (gameKeyListener && route !== "#/game") {
    document.removeEventListener("keydown", gameKeyListener);
    gameKeyListener = null;
  }

  // AFFICHAGE DE LA PAGE
  root.innerHTML = routes[route]();

  // Injecter le chat overlay si l'utilisateur est connecté et qu'il n'existe pas déjà
  const currentUsername = localStorage.getItem('currentUsername');
  const isLoggedIn = currentUsername && currentUsername !== 'Guest';
  if (isLoggedIn) {
    ensureChatOverlayExists();
  }

  // GESTION DES ÉVÉNEMENTS PAR PAGE
  if (route === "") {
    // --- PAGE D'ACCUEIL ---
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
    
    // Note: isLoggedIn already declared above, no need to redeclare
    
    if (isLoggedIn) {
      // Bouton Chat
      document.getElementById("chatBtn")?.addEventListener("click", () => {
        toggleChat();
      });
      
      // Utilisateur connecté : bouton profil
      document.getElementById("userProfileBtn")?.addEventListener("click", () => {
        location.hash = "#/profile";
      });
      
      // Bouton Find Friends
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
      // Utilisateur non connecté : boutons login/signup
      document.getElementById("loginBtn")?.addEventListener("click", () => {
        location.hash = "#/login";
      });
      
      document.getElementById("signUpBtn")?.addEventListener("click", () => {
        location.hash = "#/sign-up";
      });
    }
    
    // Event listeners du Chat (toujours actifs si user connecté)
    // Attachés via attachChatEventListeners() ou directement si chat déjà dans DOM
    if (isLoggedIn && document.getElementById('chatOverlay')) {
      attachChatEventListeners();
    }
    
  } else if (route === "#/classic") {
    // PAGE MODE CLASSIC
    const player1Input = document.getElementById("player1Input") as HTMLInputElement;
    const player2Input = document.getElementById("player2Input") as HTMLInputElement;
    const playBtn = document.getElementById("playBtn");
    
    // Focus automatique sur le premier input pour une meilleure UX
    player1Input?.focus();
    
    // Fonction pour démarrer le jeu après validation des noms
    const startGame = async () => {
      const player1Name = player1Input?.value.trim();
      const player2Name = player2Input?.value.trim();
      
      // Validation : noms non vides
      if (!player1Name || player1Name.length === 0) {
        alert("Please enter Player 1's name!");
        player1Input?.focus();
        return;
      }
      
      if (!player2Name || player2Name.length === 0) {
        alert("Please enter Player 2's name!");
        player2Input?.focus();
        return;
      }
      
      // Validation : noms uniques
      if (player1Name.toLowerCase() === player2Name.toLowerCase()) {
        alert("Players must have different names!");
        player2Input?.focus();
        return;
      }
      
      // ✅ Vérifier que les pseudos ne sont pas réservés (avant la redirection)
      const currentUsername = localStorage.getItem('currentUsername');
      const playersToCheck = [player1Name, player2Name].filter(name => 
        // Exclure l'utilisateur actuellement connecté
        !currentUsername || name.toLowerCase() !== currentUsername.toLowerCase()
      );
      
      // Vérifier chaque pseudo (sauf celui de l'utilisateur connecté)
      for (const playerName of playersToCheck) {
        try {
          const checkResponse = await fetch(`/api/users/search?q=${encodeURIComponent(playerName)}&limit=1`);
          if (checkResponse.ok) {
            const data = await checkResponse.json();
            // Vérifier si un utilisateur avec ce pseudo exact existe
            const exactMatch = data.users?.find((u: any) => 
              u.username.toLowerCase() === playerName.toLowerCase()
            );
            if (exactMatch) {
              alert(`Le pseudo "${playerName}" est réservé par un utilisateur authentifié. Veuillez en choisir un autre.`);
              return;
            }
          }
        } catch (error) {
          console.error('Error checking username:', error);
        }
      }
      
      // Créer le jeu en base de données
      const gameId = await createGame(player1Name, player2Name);
      
      // Stocker les informations du jeu dans localStorage
      localStorage.setItem('player1Name', player1Name);
      localStorage.setItem('player2Name', player2Name);
      localStorage.setItem('currentGameId', gameId ? gameId.toString() : '');
      
      // Marquer explicitement qu'on est en mode classique
      localStorage.setItem('currentGameMode', 'classic');
      localStorage.removeItem('tournamentPlayers'); // Nettoyer les données de tournoi précédentes
      
      location.hash = "#/game";
    };
    
    // Event listeners pour les interactions
    playBtn?.addEventListener("click", startGame);
    
    // Navigation par clavier : Entrée pour passer au champ suivant ou commencer
    player1Input?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        player2Input?.focus();
      }
    });
    
    player2Input?.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        startGame();
      }
    });
    
    // Bouton retour vers le menu principal
    document.getElementById("backBtn")?.addEventListener("click", () => {
      // Nettoyer les données de jeu
      localStorage.removeItem('currentGameMode');
      location.hash = "";
    });
    
  } else if (route === "#/online") {
    // --- PAGE ONLINE ---
    
    // Variables pour la gestion WebSocket
    let onlineWS: WebSocket | null = null;
    let currentRoomId: string | null = null;
    let isConnected = false;
    let playersInRoom: any[] = [];
    let currentUserId: string | null = null;
    let currentPlayerNumber: number | null = null;
    let currentUserName: string | null = null;
    
    // Variables pour le système Ready
    let playersReady: { [userId: string]: boolean } = {};
    let isCurrentPlayerReady = false;
    
    // Variables pour le contrôle du jeu
    let isPaused = false;
    let isGameStarted = false;
    
    // Éléments du DOM
    const statusText = document.getElementById("statusText") as HTMLElement;
    const customRoomNameInput = document.getElementById("customRoomNameInput") as HTMLInputElement;
    const roomIdInput = document.getElementById("roomIdInput") as HTMLInputElement;
    const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
    const createRoomBtn = document.getElementById("createRoomBtn") as HTMLButtonElement;
    const backBtn = document.getElementById("backFromOnlineGameBtn") as HTMLButtonElement;
    const gameControls = document.getElementById("onlineGameControls") as HTMLElement;
    const playersInfo = document.getElementById("playersInfo") as HTMLElement;
    const playersList = document.getElementById("playersList") as HTMLElement;
    const gameArea = document.getElementById("onlineGameArea") as HTMLElement;
    const canvas = document.getElementById("onlineCanvas") as HTMLCanvasElement;
    const readyBtn = document.getElementById("readyBtn") as HTMLButtonElement;
    const startBtn = document.getElementById("startOnlineBtn") as HTMLButtonElement;
    const readyStatus = document.getElementById("readyStatus") as HTMLElement;
    
    // Fonction pour mettre à jour le statut
    function updateStatus(message: string, color: string) {
      if (statusText) {
        statusText.textContent = message;
        statusText.className = `text-lg font-bold ${color}`;
      }
    }
    
    // Fonction pour mettre à jour l'affichage du statut Ready
    function updateReadyStatus() {
      if (!readyStatus) return;
      
      const totalPlayers = playersInRoom.length;
      const readyCount = Object.keys(playersReady).filter((userId: string) => playersReady[userId]).length;
      
      if (totalPlayers < 2) {
        readyStatus.classList.add('hidden');
        return;
      }
      
      readyStatus.classList.remove('hidden');
      const statusDiv = readyStatus.querySelector('.text-sm.text-center');
      
      if (readyCount === totalPlayers && totalPlayers === 2) {
        // Tous les joueurs sont prêts - activer le bouton Start
        if (statusDiv) statusDiv.innerHTML = '<span class="text-green-400">🟢 Both players ready! Game can start!</span>';
        if (startBtn) {
          startBtn.classList.remove('hidden');
          startBtn.disabled = false;
          startBtn.classList.add('animate-pulse');
        }
      } else {
        // En attente d'autres joueurs
        if (statusDiv) statusDiv.innerHTML = `<span class="text-orange-400">Ready: ${readyCount}/${totalPlayers} players</span>`;
        if (startBtn) {
          startBtn.classList.add('hidden');
          startBtn.disabled = true;
          startBtn.classList.remove('animate-pulse');
        }
      }
      
      // Mettre à jour le texte du bouton Ready
      if (readyBtn) {
        if (isCurrentPlayerReady) {
          readyBtn.textContent = '✅ Ready!';
          readyBtn.classList.remove('hover-orange');
          readyBtn.classList.add('hover-green');
        } else {
          readyBtn.textContent = '✋ Ready Up!';
          readyBtn.classList.remove('hover-green');
          readyBtn.classList.add('hover-orange');
        }
      }
    }
    
    // Fonction pour extraire l'userId du token JWT
    function getUserIdFromToken(): string | null {
      const token = localStorage.getItem('token');
      if (!token) return null;
      
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.userId?.toString() || null;
      } catch (error) {
        console.error('Erreur lors du parsing du token:', error);
        return null;
      }
    }
    
    // Fonction pour extraire le nom d'utilisateur du token JWT
    function getUserNameFromToken(): string | null {
      const token = localStorage.getItem('token');
      if (!token) return null;
      
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.username || payload.name || payload.user || null;
      } catch (error) {
        console.error('Erreur lors du parsing du token pour le nom d\'utilisateur:', error);
        return null;
      }
    }
    
    // Fonction simple pour obtenir un nom plus lisible que "User3"
    function getSimpleDisplayName(userId: string): string {
      // Convertir User ID en nom plus sympa
      const userNum = parseInt(userId);
      const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
      if (!isNaN(userNum) && userNum >= 1 && userNum <= names.length) {
        return names[userNum - 1];
      }
      return `Player${userId}`;
    }
    
    // Fonction pour récupérer le nom d'utilisateur actuel via API
    async function fetchCurrentUserName(): Promise<string | null> {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/users/me`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const userData = await response.json();
          // La structure est {user: {username: "..."}, stats: {...}}
          return userData.user?.username || userData.username || null;
        }
      } catch (error) {
        console.error('Erreur lors de la récupération de l\'utilisateur actuel:', error);
      }
      
      return null;
    }
    
    // Fonction pour générer un ID de room court et lisible
    function generateShortRoomId(customName?: string): string {
      if (customName && customName.trim().length > 0) {
        // Nettoyer le nom personnalisé (enlever espaces, caractères spéciaux)
        const cleanName = customName.trim().replace(/[^a-zA-Z0-9]/g, '').substring(0, 15);
        if (cleanName.length > 0) {
          return cleanName;
        }
      }
      
      // Générer un ID court automatique (6 caractères alphanumériques)
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
      let result = '';
      for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }
    
    // Fonction pour connecter au WebSocket
    async function connectToGame(roomId?: string, isCreatingRoom: boolean = false) {
      const token = localStorage.getItem('token');
      if (!token) {
        updateStatus('🔴 Authentication required - Redirecting to login...', 'text-red-400');
        console.error('[Online] Aucun token d\'authentification trouvé - redirection vers login');
        
        // Rediriger vers la page de login après 2 secondes
        setTimeout(() => {
          window.location.hash = '#login';
          window.location.reload();
        }, 2000);
        return;
      }
      
      // Extraire l'ID utilisateur du token et récupérer le nom
      currentUserId = getUserIdFromToken();
      currentUserName = await fetchCurrentUserName() || getUserNameFromToken();
      
      updateStatus('🟡 Connecting...', 'text-yellow-400');
      
      // Construire l'URL WebSocket
      const wsUrl = `wss://${location.host}/ws?channel=game-remote&token=${encodeURIComponent(token)}`;

      
      try {
        onlineWS = new WebSocket(wsUrl);
        
        onlineWS.onopen = () => {
          isConnected = true;
          updateStatus('🟢 Connected', 'text-green-400');
          
          // Attendre un peu que la connexion soit stable avant d'envoyer des messages
          setTimeout(() => {
            if (roomId && !isCreatingRoom) {
              // Rejoindre room existante
              sendMessage({ type: 'game.join', data: { gameId: roomId } });
              currentRoomId = roomId;
            } else if (roomId && isCreatingRoom) {
              // Créer nouvelle room avec un ID personnalisé
              sendMessage({ type: 'game.create', data: { gameId: roomId } });
            } else {
              // Créer nouvelle room avec ID automatique
              sendMessage({ type: 'game.create', data: {} });
            }
          }, 500); // Attendre 500ms
          
          // Afficher les contrôles
          if (gameControls) gameControls.classList.remove('hidden');
          if (playersInfo) playersInfo.classList.remove('hidden');
        };
        
        onlineWS.onmessage = (event) => {
          // Ignorer les messages non-JSON comme "hello: connected"
          if (typeof event.data === 'string' && !event.data.startsWith('{')) {
            return;
          }
          
          try {
            const message = JSON.parse(event.data);
            handleGameMessage(message);
          } catch (error) {
            console.error('Erreur lors du parsing du message WebSocket:', error);
          }
        };
        

        
        onlineWS.onerror = (error) => {
          console.error('[Online] Erreur WebSocket:', error);
          updateStatus('🔴 Connection error', 'text-red-400');
        };
        
        onlineWS.onclose = (event) => {
          isConnected = false;
          updateStatus('🔴 Disconnected', 'text-red-400');
          
          // Cacher les contrôles
          if (gameControls) gameControls.classList.add('hidden');
          if (playersInfo) playersInfo.classList.add('hidden');
          if (gameArea) gameArea.classList.add('hidden');
        };
        
      } catch (error) {
        console.error('Erreur lors de la création WebSocket:', error);
        updateStatus('🔴 Connection failed', 'text-red-400');
      }
    }
    
    // Fonction pour envoyer des messages WebSocket
    function sendMessage(message: any) {
      if (onlineWS && onlineWS.readyState === WebSocket.OPEN) {
        onlineWS.send(JSON.stringify(message));
      } else {
        updateStatus('🔴 Not connected', 'text-red-400');
      }
    }
    
    // Fonction pour gérer les messages reçus
    function handleGameMessage(message: any) {
      switch (message.type) {
        case 'game.created':
          currentRoomId = message.data.gameId;
          updateStatus(`🟢 Room created: ${currentRoomId}`, 'text-green-400');
          if (roomIdInput && currentRoomId) roomIdInput.value = currentRoomId;
          break;
          
        case 'game.joined':
          currentRoomId = message.data.gameId;
          updateStatus(`🟢 Joined room: ${currentRoomId}`, 'text-green-400');
          break;
          
        case 'game.started':
          updateStatus('🚀 Jeu démarré!', 'text-blue-400');
          isGameStarted = true;
          isPaused = false; // Réinitialiser l'état de pause
          
          // Réactiver le bouton pause
          const pauseBtnStart = document.getElementById('pauseOnlineBtn') as HTMLButtonElement;
          if (pauseBtnStart) {
            pauseBtnStart.disabled = false;
            pauseBtnStart.textContent = 'Pause';
            pauseBtnStart.style.opacity = '1';
          }
          
          // Masquer les contrôles de room et afficher la zone de jeu
          if (gameControls) gameControls.classList.add('hidden');
          if (playersInfo) playersInfo.classList.add('hidden');
          if (gameArea) gameArea.classList.remove('hidden');
          initializeGameCanvas();
          break;
          
        case 'game_state':
          // Mettre à jour l'état du jeu sur le canvas
          if (message.data && message.data.state) {
            renderGameState(message.data.state);
          }
          
          // Mettre à jour la liste des joueurs si disponible
          if (message.data && message.data.players) {
            updatePlayersList(message.data);
            
            // Déterminer le numéro de joueur actuel
            if (currentUserId) {
              const currentPlayer = message.data.players.find((p: any) => p.id === currentUserId);
              if (currentPlayer) {
                // Mapping inversé pour corriger les contrôles
                const newPlayerNumber = currentPlayer.paddle === 'left' ? 2 : 1;
                if (currentPlayerNumber !== newPlayerNumber) {
                  currentPlayerNumber = newPlayerNumber;
                }
              }
            }
          }
          break;
          
        case 'player_joined':
        case 'player_left':
          // Mettre à jour la liste des joueurs
          updatePlayersList(message.data);
          break;
          
        case 'game_ended':
          console.log('🏁 Jeu terminé:', message.data);
          isGameStarted = false; // Le jeu n'est plus en cours
          
          // Désactiver le bouton pause
          const pauseBtnEnd = document.getElementById('pauseOnlineBtn') as HTMLButtonElement;
          if (pauseBtnEnd) {
            pauseBtnEnd.disabled = true;
            pauseBtnEnd.textContent = 'Game Over';
            pauseBtnEnd.style.opacity = '0.5';
          }
          
          updateStatus(`🏁 Game finished!`, 'text-yellow-400');
          
          // Afficher le résultat
          if (message.data.winner) {
            const winnerName = message.data.winner.name || message.data.winner.id;
            updateStatus(`🏆 Winner: ${winnerName}`, 'text-green-400');
          } else {
            updateStatus(`🤝 Game ended in a draw`, 'text-blue-400');
          }
          
          // Optionnel: Masquer le canvas ou afficher un bouton "New Game"
          setTimeout(() => {
            updateStatus('💭 Ready for a new game?', 'text-gray-400');
          }, 3000);
          break;
          
        case 'game_paused':
          updateStatus('⏸️ Jeu en pause', 'text-yellow-400');
          isPaused = true;
          // Changer le texte du bouton pour "Resume"
          const pauseBtn = document.getElementById('pauseOnlineBtn');
          if (pauseBtn) pauseBtn.textContent = 'Resume';
          break;
          
        case 'game_resumed':
          updateStatus('▶️ Jeu repris', 'text-green-400');
          isPaused = false;
          // Remettre le texte du bouton à "Pause"
          const resumeBtn = document.getElementById('pauseOnlineBtn');
          if (resumeBtn) resumeBtn.textContent = 'Pause';
          break;
          
        case 'game.ready':
          // Un joueur a changé son statut Ready
          if (message.data && message.data.userId !== undefined) {
            playersReady[message.data.userId] = message.data.ready;
            updateReadyStatus();
            
            // Afficher un message informatif
            const playerName = message.data.playerName || `Player ${message.data.userId}`;
            const statusMsg = message.data.ready 
              ? `🟢 ${playerName} is ready!` 
              : `🔄 ${playerName} is no longer ready`;
            updateStatus(statusMsg, message.data.ready ? 'text-green-400' : 'text-yellow-400');
          }
          break;
          
        case 'error':
          console.error('Erreur du jeu:', message.data.message);
          
          if (message.data.message === 'room_already_exists') {
            const roomId = message.data.gameId || 'unknown';
            updateStatus(`🔴 Room "${roomId}" already exists. Try joining it or use a different name.`, 'text-red-400');
            // Suggérer de rejoindre la room existante
            if (roomIdInput && message.data.gameId) {
              roomIdInput.value = message.data.gameId;
            }
          } else {
            updateStatus(`🔴 Error: ${message.data.message}`, 'text-red-400');
          }
          break;
          
        default:
          console.warn('🤷 [Game] Unhandled message type:', message.type, message);
          break;
      }
    }
    
    // Cache pour les noms d'utilisateur
    const userNameCache = new Map<string, string>();
    
    // Fonction pour récupérer le nom d'utilisateur réel via API
    async function fetchRealUserName(userId: string): Promise<string> {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/users/${userId}/profile`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          const userData = await response.json();
          return userData.user?.username || userData.username || userData.name || `User${userId}`;
        }
      } catch (error) {
        console.error('Erreur lors de la récupération du nom d\'utilisateur pour', userId, ':', error);
      }
      
      return `User${userId}`;
    }
    
    // Fonction pour obtenir un nom d'utilisateur plus lisible
    async function getDisplayName(player: any): Promise<string> {
      const userId = player.id;
      
      // Utiliser le cache si disponible
      if (userNameCache.has(userId)) {
        return userNameCache.get(userId)!;
      }
      
      let displayName: string;
      
      // Si c'est le joueur actuel, utiliser le nom qu'on a récupéré à la connexion
      if (userId === currentUserId && currentUserName) {
        displayName = currentUserName;
      } else {
        // Pour les autres joueurs, essayer de récupérer leur vrai nom
        displayName = await fetchRealUserName(userId);
        
        // Si l'API échoue, utiliser un nom sympa par défaut
        if (displayName.startsWith('User')) {
          displayName = getSimpleDisplayName(userId);
        }
      }
      
      userNameCache.set(userId, displayName);
      return displayName;
    }
    
    // Fonction pour mettre à jour la liste des joueurs
    async function updatePlayersList(data: any) {
      if (playersList) {
        if (data && data.players && data.players.length > 0) {
          // Mettre à jour la liste des joueurs dans room
          playersInRoom = data.players;
          
          // Initialiser le statut Ready pour les nouveaux joueurs
          data.players.forEach((player: any) => {
            if (!(player.id in playersReady)) {
              playersReady[player.id] = false;
            }
          });
          
          // Récupérer tous les noms d'utilisateur en parallèle
          const playersWithNames = await Promise.all(
            data.players.map(async (player: any) => {
              const displayName = await getDisplayName(player);
              const isCurrentUser = player.id === currentUserId ? ' (You)' : '';
              const paddleInfo = ` (${player.paddle})`;
              const readyIcon = playersReady[player.id] ? ' ✅' : ' ⏸️';
              return `<div class="mb-1">👤 ${displayName}${paddleInfo}${isCurrentUser}${readyIcon}</div>`;
            })
          );
          
          playersList.innerHTML = playersWithNames.join('');
          
          // Mettre à jour l'affichage du statut Ready
          updateReadyStatus();
        } else {
          playersList.innerHTML = 'No players connected';
          playersInRoom = [];
          playersReady = {};
        }
      }
    }
    
    // Fonction pour initialiser le canvas de jeu
    function initializeGameCanvas() {
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Fond noir
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Ligne centrale
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.stroke();
    }
    
    // Fonction pour rendre l'état du jeu
    function renderGameState(gameState: any) {
      
      if (!canvas || !gameState) {
        return;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Effacer le canvas
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Ligne centrale
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, 0);
      ctx.lineTo(canvas.width / 2, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Paddles - Adapter aux données du backend (p1, p2)
      ctx.fillStyle = '#ffffff';
      if (typeof gameState.p1 === 'number') {
        const leftPaddleX = 10;
        const leftPaddleY = gameState.p1;
        ctx.fillRect(leftPaddleX, leftPaddleY, 10, 80);
      }
      if (typeof gameState.p2 === 'number') {
        const rightPaddleX = canvas.width - 20;
        const rightPaddleY = gameState.p2;
        ctx.fillRect(rightPaddleX, rightPaddleY, 10, 80);
      }
      
      // Balle
      if (gameState.ball) {
        ctx.beginPath();
        ctx.arc(gameState.ball.x, gameState.ball.y, 8, 0, Math.PI * 2);
        ctx.fill();
      }
      
      // Score - Adapter aux données du backend (score1, score2)
      ctx.font = '24px Arial';
      ctx.textAlign = 'center';
      if (typeof gameState.score1 === 'number' && typeof gameState.score2 === 'number') {
        ctx.fillText(`${gameState.score1}`, canvas.width / 4, 40);
        ctx.fillText(`${gameState.score2}`, (canvas.width * 3) / 4, 40);
      }
    }
    
    // Event listeners pour les boutons
    connectBtn?.addEventListener('click', async () => {
      const roomId = roomIdInput?.value.trim();
      if (roomId) {
        await connectToGame(roomId);
      } else {
        updateStatus('🔴 Please enter a room ID to join', 'text-red-400');
      }
    });
    
    createRoomBtn?.addEventListener('click', async () => {
      const customName = customRoomNameInput?.value.trim();
      
      // Si un nom personnalisé est fourni, l'utiliser comme room ID
      if (customName && customName.length > 0) {
        const cleanRoomId = generateShortRoomId(customName);
        updateStatus(`🟡 Creating room "${cleanRoomId}"...`, 'text-yellow-400');
        await connectToGame(cleanRoomId, true); // true = créer avec ce nom
      } else {
        // Sinon, générer un ID court automatique
        updateStatus(`🟡 Creating room with auto-generated ID...`, 'text-yellow-400');
        await connectToGame(undefined, true); // true = créer avec ID automatique
      }
    });
    
    document.getElementById("startOnlineBtn")?.addEventListener('click', () => {
      if (currentRoomId) {
        // Afficher immédiatement la zone de jeu pour plus de fluidité
        updateStatus('🚀 Démarrage du jeu...', 'text-blue-400');
        if (gameControls) gameControls.classList.add('hidden');
        if (playersInfo) playersInfo.classList.add('hidden');
        if (gameArea) gameArea.classList.remove('hidden');
        
        // Initialiser le canvas immédiatement
        initializeGameCanvas();
        
        // Envoyer la demande de démarrage au serveur
        sendMessage({ type: 'game.start', data: { gameId: currentRoomId } });
      }
    });
    
    document.getElementById("readyBtn")?.addEventListener('click', () => {
      if (!currentRoomId || !currentUserId) return;
      
      // Inverser l'état Ready du joueur actuel
      isCurrentPlayerReady = !isCurrentPlayerReady;
      playersReady[currentUserId] = isCurrentPlayerReady;
      
      // Envoyer le signal au serveur
      sendMessage({ 
        type: 'game.ready', 
        data: { 
          gameId: currentRoomId, 
          userId: currentUserId,
          ready: isCurrentPlayerReady 
        } 
      });
      
      // Mettre à jour l'affichage
      updateReadyStatus();
      
      const statusMsg = isCurrentPlayerReady ? '🟢 You are ready!' : '🔄 Ready status removed';
      const statusColor = isCurrentPlayerReady ? 'text-green-400' : 'text-yellow-400';
      updateStatus(statusMsg, statusColor);
    });

    // Event listener pour le bouton back du jeu online
    document.getElementById("backFromOnlineGameBtn")?.addEventListener('click', () => {
      if (onlineWS) {
        onlineWS.close();
        onlineWS = null;
      }
      location.hash = "";
    });

    // Event listener pour le bouton back principal online
    document.getElementById("backFromOnlineBtn")?.addEventListener('click', () => {
      if (onlineWS) {
        onlineWS.close();
        onlineWS = null;
      }
      location.hash = "";
    });
    
    backBtn?.addEventListener('click', () => {
      // Nettoyer la connexion WebSocket
      if (onlineWS) {
        onlineWS.close();
        onlineWS = null;
      }
      location.hash = "";
    });
    
    // Gestion des contrôles clavier pour le jeu
    function handleKeyDown(event: KeyboardEvent) {
      if (!isConnected || !currentRoomId) return;
      
      let direction = null;
      
      switch (event.key.toLowerCase()) {
        case 'w':
        case 'arrowup':
        case 'i':
          direction = 'up';
          event.preventDefault();
          break;
        case 's':
        case 'arrowdown':
        case 'k':
          direction = 'down';
          event.preventDefault();
          break;
      }
      
      if (direction && currentPlayerNumber) {
        sendMessage({
          type: 'game.input',
          data: {
            gameId: currentRoomId,
            player: currentPlayerNumber,
            direction: direction
          }
        });
      }
    }
    
    function handleKeyUp(event: KeyboardEvent) {
      if (!isConnected || !currentRoomId) return;
      
      switch (event.key.toLowerCase()) {
        case 'w':
        case 's':
        case 'arrowup':
        case 'arrowdown':
        case 'i':
        case 'k':
          if (currentPlayerNumber) {
            sendMessage({
              type: 'game.input',
              data: {
                gameId: currentRoomId,
                player: currentPlayerNumber,
                direction: 'stop'
              }
            });
          }
          event.preventDefault();
          break;
      }
    }
    
    // Ajouter les event listeners clavier
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Nettoyer les event listeners quand on quitte la page
    const cleanup = () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
      if (onlineWS) {
        onlineWS.close();
        onlineWS = null;
      }
    };
    
    // Attacher les event listeners pour les boutons de jeu après que le DOM soit prêt
    setTimeout(() => {
      // Event listener pour le bouton pause du jeu online
      const pauseButton = document.getElementById("pauseOnlineBtn");
      console.log('🔍 Bouton pause trouvé:', !!pauseButton);
      pauseButton?.addEventListener('click', async () => {
        console.log('🔍 Bouton pause cliqué. CurrentRoomId:', currentRoomId, 'IsConnected:', isConnected, 'IsGameStarted:', isGameStarted);
        if (currentRoomId && isConnected && isGameStarted) {
          try {
            const token = localStorage.getItem('token');
            if (!token) return;

            const action = isPaused ? 'resume' : 'pause';
            const response = await fetch(`/api/games/${currentRoomId}/${action}`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`
              }
            });

            if (response.ok) {
              const result = await response.json();
              console.log(`Jeu ${action} avec succès:`, result);
              
              // Mettre à jour l'état local
              isPaused = !isPaused;
              const pauseBtn = document.getElementById('pauseOnlineBtn');
              if (pauseBtn) {
                pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
              }
              updateStatus(isPaused ? '⏸️ Jeu en pause' : '▶️ Jeu repris', isPaused ? 'text-yellow-400' : 'text-green-400');
            } else {
              const errorText = await response.text();
              console.error(`Erreur lors du ${action}:`, response.status, errorText);
              
              if (response.status === 400) {
                updateStatus(`❌ Impossible de ${action === 'pause' ? 'mettre en pause' : 'reprendre'} - jeu terminé ou invalide`, 'text-red-400');
              } else {
                updateStatus(`❌ Erreur ${response.status} lors du ${action}`, 'text-red-400');
              }
            }
          } catch (error) {
            console.error('Erreur réseau lors de la pause:', error);
            updateStatus('❌ Erreur réseau', 'text-red-400');
          }
        } else {
          console.warn('Impossible de faire pause - Room:', !!currentRoomId, 'Connected:', isConnected, 'GameStarted:', isGameStarted);
          if (!isGameStarted) {
            updateStatus('❌ Jeu non démarré ou terminé', 'text-red-400');
          } else if (!isConnected) {
            updateStatus('❌ Connexion perdue', 'text-red-400');
          } else {
            updateStatus('❌ Conditions non remplies pour la pause', 'text-red-400');
          }
        }
      });
    }, 100); // Attendre 100ms pour que le DOM soit prêt
    
    // Stocker la fonction de nettoyage pour pouvoir l'appeler plus tard
    (window as any).onlineCleanup = cleanup;
    
  } else if (route === "#/tournament") {
    // PAGE TOURNAMENT - Saisie de 4 joueurs pour un tournoi
    
    // Fonction pour commencer le tournoi
    async function startTournament() {
      const inputs = document.querySelectorAll(".player-input") as NodeListOf<HTMLInputElement>;
      const players: string[] = [];
      
      // Collecter les noms des 4 joueurs
      inputs.forEach(input => {
        const name = input.value.trim();
        if (name) {
          players.push(name);
        }
      });
      
      if (players.length !== 4) {
        alert("Please enter all 4 player names!");
        return;
      }
      
      // Vérifier l'unicité des noms (insensible à la casse)
      const lowercaseNames = players.map(name => name.toLowerCase());
      const uniqueNames = new Set(lowercaseNames);
      
      if (uniqueNames.size !== players.length) {
        alert("All players must have different names!");
        return;
      }
      
      // ✅ Vérifier que les pseudos ne sont pas réservés (avant la redirection)
      const currentUsername = localStorage.getItem('currentUsername');
      const playersToCheck = players.filter(name => 
        // Exclure l'utilisateur actuellement connecté
        !currentUsername || name.toLowerCase() !== currentUsername.toLowerCase()
      );
      
      // Vérifier chaque pseudo (sauf celui de l'utilisateur connecté)
      for (const playerName of playersToCheck) {
        try {
          const checkResponse = await fetch(`/api/users/search?q=${encodeURIComponent(playerName)}&limit=1`);
          if (checkResponse.ok) {
            const data = await checkResponse.json();
            // Vérifier si un utilisateur avec ce pseudo exact existe
            const exactMatch = data.users?.find((u: any) => 
              u.username.toLowerCase() === playerName.toLowerCase()
            );
            if (exactMatch) {
              alert(`Le pseudo "${playerName}" est réservé par un utilisateur authentifié. Veuillez en choisir un autre.`);
              return;
            }
          }
        } catch (error) {
          console.error('Error checking username:', error);
        }
      }
      
      // Créer le tournoi via l'API backend
      try {
        // Récupérer le token s'il existe (pour que le backend puisse autoriser l'utilisateur connecté)
        const token = localStorage.getItem('token');
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        
        const response = await fetch('/api/tournaments/local', {
          method: 'POST',
          headers,
          body: JSON.stringify({ players }),
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create tournament');
        }
        
        const data = await response.json();
        
        // Sauvegarder les informations du tournoi
        localStorage.setItem("tournamentId", data.tournamentId);
        localStorage.setItem("tournamentData", JSON.stringify(data.tournament));
        localStorage.setItem("currentMatch", JSON.stringify(data.nextMatch));
        localStorage.setItem('currentGameMode', 'tournament');
        
        // Rediriger vers la page de jeu pour le premier match
        location.hash = "#/game";
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        alert(`Failed to create tournament: ${errorMessage}`);
      }
    }
    
    // Navigation par clavier : Entrée pour passer au champ suivant ou démarrer
    function setupKeyboardNavigation() {
      const inputs = document.querySelectorAll(".player-input") as NodeListOf<HTMLInputElement>;
      inputs.forEach((input, index) => {
        input.addEventListener("keypress", (e: KeyboardEvent) => {
          if (e.key === "Enter") {
            // Si c'est le dernier champ et tous sont remplis, démarrer
            if (index === inputs.length - 1) {
              const allFilled = Array.from(inputs).every(inp => inp.value.trim() !== '');
              if (allFilled) {
                startTournament();
              }
            } else {
              // Sinon, passer au champ suivant
              inputs[index + 1].focus();
            }
          }
        });
      });
    }
    
    // Event listeners
    document.getElementById("startTournamentBtn")?.addEventListener("click", startTournament);
    document.getElementById("backToMenuBtn")?.addEventListener("click", () => {
      localStorage.removeItem('currentGameMode');
      location.hash = "";
    });
    
    // Configurer la navigation au clavier
    setupKeyboardNavigation();
    
    // Focus sur le premier input
    const firstInput = document.querySelector(".player-input") as HTMLInputElement;
    firstInput?.focus();
    
  } else if (route === "#/game") {
    // PAGE DE JEU PONG
    const canvas = document.getElementById("pongCanvas") as HTMLCanvasElement;
    
    let player1Name: string;
    let player2Name: string;
    let isTournamentMode = false;
    let currentMatchInfo: any = null;
    
    // Vérifier si on est en mode tournoi
    const currentGameMode = localStorage.getItem('currentGameMode');
    if (currentGameMode === 'tournament') {
      const currentMatchString = localStorage.getItem('currentMatch');
      if (currentMatchString) {
        currentMatchInfo = JSON.parse(currentMatchString);
        isTournamentMode = true;
        
        // Récupérer les joueurs du match actuel
        player1Name = currentMatchInfo.players[0];
        player2Name = currentMatchInfo.players[1];
        

      } else {
        // Fallback si pas d'info de match
        const tournamentPlayers = JSON.parse(localStorage.getItem('tournamentPlayers') || '[]');
        player1Name = tournamentPlayers[0] || 'Player 1';
        player2Name = tournamentPlayers[1] || 'Player 2';

      }
    } else {
      // Mode classique
      player1Name = localStorage.getItem('player1Name') || 'Player 1';
      player2Name = localStorage.getItem('player2Name') || 'Player 2';

    }
    
    // Sauvegarder les noms pour le jeu actuel
    localStorage.setItem('player1Name', player1Name);
    localStorage.setItem('player2Name', player2Name);
    
    // Affichage des noms des joueurs dans l'interface
    const player1Display = document.getElementById('player1Display');
    const player2Display = document.getElementById('player2Display');
    
    if (player1Display) {
      player1Display.textContent = player1Name;
    }
    if (player2Display) {
      player2Display.textContent = player2Name;
    }
    
    if (canvas) {
      // Nettoyer le client de jeu précédent s'il existe
      if (currentGameClient) {
        await currentGameClient.stop(); // ✅ Maintenant asynchrone
        currentGameClient = null;
      }
      
      // INITIALISATION DU CLIENT DE JEU

      currentGameClient = new GameClient(canvas);
      
      // Variables pour tracker les états du jeu
      let gameStarted = false;
      let isPaused = false;
      
      // Fonction pour démarrer le jeu
      const startGame = async () => {
        if (currentGameClient && !gameStarted) {
          try {
            await currentGameClient.start();
            gameStarted = true;
            
            // Masquer la section start et afficher les contrôles
            const startSection = document.getElementById("startSection");
            const gameControls = document.getElementById("gameControls");
            
            if (startSection) startSection.style.display = "none";
            if (gameControls) {
              gameControls.classList.remove("hidden");
              gameControls.classList.add("flex");
            }
          } catch (error) {
            alert('Failed to connect to game server. Please try again.');
          }
        }
      };

      // GESTION DU BOUTON START
      document.getElementById("startBtn")?.addEventListener("click", startGame);
      
      // GESTION DE LA TOUCHE ENTRÉE POUR DÉMARRER LE JEU
      gameKeyListener = (event: KeyboardEvent) => {
        if (event.key === "Enter" && !gameStarted) {
          event.preventDefault();
          startGame();
        }
      };
      
      // Ajouter l'écouteur de clavier
      document.addEventListener("keydown", gameKeyListener);

      // BOUTON RETOUR AU MENU PRINCIPAL
      document.getElementById("backToMenuBtn")?.addEventListener("click", async () => {
        // ✅ IMPORTANT: Arrêter et annuler la partie côté backend AVANT de changer de page
        if (currentGameClient) {
          await currentGameClient.stop();
          currentGameClient = null;
        }
        
        // Nettoyer les données de jeu
        localStorage.removeItem('currentGameMode');
        location.hash = "";
      });
    }
  } else if (route === "#/victory") {
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
  
  } else if (route === "#/tournament-transition") {
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
        const matchTypeText = nextMatchInfo.type === 'final' ? '🏆 FINAL' : 
                             nextMatchInfo.type === 'semifinal' ? `🔥 Semi-Final ${nextMatchInfo.number}` : 
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
  } else if (route === "#/sign-up") {
    // --- PAGE D'INSCRIPTION ---
    
    // Gestion du formulaire d'inscription
    const signUpForm = document.getElementById('signUpForm') as HTMLFormElement;
    
    signUpForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Récuperer les donnees du formulaire
      const formData = new FormData(signUpForm);
      const username = formData.get('username') as string;
      const email = formData.get('email') as string;
      const password = formData.get('password') as string;
      
      try {
        const response = await fetch('/api/users/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, email, password }),
        });
        
        const data = await response.json();
        
        if (response.ok) {
          // Succès d'inscription
          // Stocke le JWT et ouvre le WS de présence
          if (data.token) {
            localStorage.setItem('token', data.token);
            Presence.connect(data.token);
          }

          const name = data.user?.username || username;
          localStorage.setItem('currentUsername', username);
          location.hash = '#/profile';
        } else {
          // Erreur
          alert('Registration failed: ' + (data.error || 'Please try again'));
        }

      } catch (error) {
        alert('Network error. Please try again.');
      }
    });
    
    // Gestion du bouton "Back to Menu"
    document.getElementById("backToMenuSignup")?.addEventListener("click", () => {
      location.hash = '';
    });
  } else if (route === "#/login") {
    // --- PAGE DE CONNEXION ---
    
    // Gestion du formulaire de connexion
    const loginForm = document.getElementById('loginForm') as HTMLFormElement;
    
    loginForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      // Récuperer les donnees du formulaire
      const formData = new FormData(loginForm);
      const username = formData.get('username') as string;
      const password = formData.get('password') as string;
      
      try {
        const response = await fetch('/api/users/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });
        
        const data = await response.json();
        
        if (response.ok) {
          // Succès de connexion
          // Stocker le token JWT
          if (data.token) {
            localStorage.setItem('token', data.token);
            Presence.connect(data.token);
          }
          
          localStorage.setItem('currentUsername', username);
          location.hash = '#/profile';
        } else {
          // Erreur
          alert('Login failed: ' + (data.error || 'Invalid username or password'));
        }
      } catch (error) {
        alert('Network error. Please try again.');
      }
    });
    // Gestion du bouton "Back to Menu"
    document.getElementById("backToMenuLogin")?.addEventListener("click", () => {
      location.hash = '';
    });
  } else if (route === "#/profile") {
    // --- PAGE DE PROFIL ---
    
    // Récupérer le nom d'utilisateur (pour l'instant depuis localStorage, plus tard depuis l'API)
    const username = localStorage.getItem('currentUsername') || 'Guest';
    
    // Afficher le nom d'utilisateur
    const profileUsername = document.getElementById('profileUsername');
    if (profileUsername) {
      profileUsername.textContent = username;
    }

    // Charger l'avatar depuis l'API
    async function loadUserAvatar() {
      try {
        const userId = await getCurrentUserId();
        const profileData = await getUserProfile(userId);
        const avatarImg = document.getElementById('profileAvatar') as HTMLImageElement;
        
        if (avatarImg) {
          // Utiliser getUserAvatarPath avec l'avatar de l'utilisateur
          const avatarPath = getUserAvatarPath(userId, profileData?.user?.avatar);
          avatarImg.src = avatarPath;
        }
      } catch (error) {
        console.error('Erreur chargement avatar:', error);
        // Erreur silencieuse pour l'avatar
      }
    }

    // Charger l'avatar
    loadUserAvatar();
    
    // Charger les statistiques utilisateur et l'historique
    async function loadUserData() {
      try {
        const userId = await getCurrentUserId();
        const profile = await getUserProfile(userId);
        
        if (profile && profile.stats) {
          const stats = profile.stats;
          const winRate = stats.games_played > 0 ? ((stats.games_won / stats.games_played) * 100).toFixed(1) : '0';
          
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
        render();
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
    // 1) marquer offline côté backend (si aucune WS n’est ouverte, ça force l’état)
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
        
        // 5. Rediriger vers l'accueil
        location.hash = '';
        
        // Force le re-render pour mettre à jour l'interface
        setTimeout(() => render(), 10);
        
        // Afficher un message de confirmation
        alert('You have been logged out successfully!');
      } catch (error) {
        console.error('Logout error:', error);
        // En cas d'erreur, nettoyer quand même localement
        Presence.clear();
        localStorage.removeItem('token');
        localStorage.removeItem('currentUsername');
        location.hash = '';
        setTimeout(() => render(), 10);
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
    
    // Soumission du formulaire
    editProfileForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      console.log('[DEBUG] Form submitted!');
      console.log('[DEBUG] selectedAvatarFile:', selectedAvatarFile);
      console.log('[DEBUG] removeAvatar:', removeAvatar);
      
      if (!editProfileError || !editProfileSuccess) return;
      
      editProfileError.style.display = 'none';
      editProfileSuccess.style.display = 'none';
      
      const newUsername = (document.getElementById('newUsername') as HTMLInputElement).value.trim();
      const newEmail = (document.getElementById('newEmail') as HTMLInputElement).value.trim();
      const newPassword = (document.getElementById('newPassword') as HTMLInputElement).value;
      const confirmPassword = (document.getElementById('confirmPassword') as HTMLInputElement).value;
      
      // Validation
      if (newPassword && newPassword !== confirmPassword) {
        editProfileError.textContent = 'Passwords do not match';
        editProfileError.style.display = 'block';
        return;
      }
      
      if (newPassword && newPassword.length < 8) {
        editProfileError.textContent = 'Password must be at least 8 characters';
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
            render();
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
  } else if (route === "#/friends") {
    // --- PAGE FRIENDS ---
    
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
  } else if (route === "#/friends-profile") {
    // --- PAGE PROFIL AMI ---
    
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
    const friendAvatarImg = document.getElementById('friendProfileAvatar') as HTMLImageElement;
    if (friendAvatarImg) {
      const profileData = await getUserProfile(friendUserIdNum);
      const avatarPath = getUserAvatarPath(friendUserIdNum, profileData?.user?.avatar);
      friendAvatarImg.src = avatarPath;
    }
    
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
      isChatOpen = true;
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
    // D'abord recharger la liste des utilisateurs bloqués depuis le serveur
    await loadBlockedUsers();
    
    const isBlockedInitial = isUserBlocked(friendUserIdNum);
    const blockButton = document.getElementById('blockUserBtn') as HTMLButtonElement;
    const blockButtonText = document.getElementById('blockButtonText') as HTMLSpanElement;
    
    if (isBlockedInitial) {
      blockButtonText.textContent = 'UNBLOCK';
      blockButton.className = 'unblock-user-btn';
    }
  } else if (route === "#/friend-requests") {
    // --- PAGE DEMANDES D'AMIS ---
    
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
}

// INITIALISATION DU ROUTEUR SPA

// Lancer le rendu au chargement de la page
// Auto-connect si un token existe déjà (après reload)
// Auto-connect si un token existe déjà ET rendre la page
// Au lieu de: syncAuthFromBackend().finally(() => render());
window.addEventListener('DOMContentLoaded', () => {
  (async () => {
    try {
      // met à jour/efface token + username en fonction du backend
      await syncAuthFromBackend();
    } catch (e) {
      // Erreur silencieuse lors de la synchronisation
    }

    // Connecte le WS seulement si le token est encore présent après la sync
    const t = localStorage.getItem('token');
    if (t) {
      Presence.connect(t);
    } else {
      // aucune auth côté backend → nettoie l’UI locale
      localStorage.removeItem('currentUsername');
    }

    render();
  })();
});

// Render sur navigation hash
window.addEventListener('hashchange', render);