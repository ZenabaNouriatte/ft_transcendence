// UI DU SYSTÈME DE CHAT

import { chatMessages, isChatOpen, setIsChatOpen, addChatMessage, saveChatMessagesToStorage } from './state.js';
import { escapeHtml, getUserAvatarPath } from '../utils/helpers.js';
import { Presence } from '../websocket.js';
import * as DM from './dm.js';

/**
 * Met à jour l'affichage du chat avec les derniers messages
 */
export function updateChatDisplay() {
  console.log('[CHAT] updateChatDisplay called');
  const chatMessagesContainer = document.getElementById('chatMessages');
  console.log('[CHAT] Container found:', !!chatMessagesContainer);
  console.log('[CHAT] Messages to display:', chatMessages.length);
  
  if (!chatMessagesContainer) {
    // C'est normal si le chat overlay n'est pas encore créé
    console.log('[CHAT] Container #chatMessages not found yet (chat overlay not created)');
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
      
      // Vérifier si c'est un message système (userId: 0)
      const isSystemMessage = msg.userId === 0;
      
      // Avatar spécial pour le système
      const avatarStyle = isSystemMessage
        ? 'width: 32px; height: 32px; border-radius: 50%; border: 2px solid #ff8c00; overflow: hidden; flex-shrink: 0; background: linear-gradient(135deg, #fbde9c 0%, #f9c574 100%); display: flex; align-items: center; justify-content: center; font-size: 18px;'
        : `width: 32px; height: 32px; border-radius: 50%; border: 2px solid #ff8c00; overflow: hidden; flex-shrink: 0; background-image: url('${avatarPath}'); background-size: cover; background-position: center;`;
      
      const avatarContent = isSystemMessage ? '⚙️' : '';
      
      // Si c'est un message système, ne pas ajouter le onclick et changer le style du curseur
      const usernameStyle = isSystemMessage 
        ? 'cursor: default; font-weight: bold; color: #ff8c00;'
        : 'cursor: pointer; font-weight: bold; color: #ff8c00; text-decoration: none; transition: all 0.2s;';
      
      const usernameEvents = isSystemMessage
        ? ''
        : `onmouseover="this.style.opacity='0.7'; this.style.textDecoration='underline';" 
           onmouseout="this.style.opacity='1'; this.style.textDecoration='none';"
           onclick="localStorage.setItem('viewingFriendUserId', '${msg.userId}'); localStorage.setItem('viewingFriendUsername', '${escapeHtml(msg.username)}'); location.hash = '#/friends-profile';"`;
      
      return `
        <div class="chat-message" style="display: flex; align-items: flex-start; gap: 4px; padding: 8px 12px;">
          <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
            <div class="chat-avatar" style="${avatarStyle}">${avatarContent}</div>
            <span class="chat-username" style="${usernameStyle} flex-shrink: 0;" 
                  ${usernameEvents}>${escapeHtml(msg.username)}:</span>
          </div>
          <div style="flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 6px;">
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

/**
 * Envoie un message de chat global via WebSocket
 */
export function sendChatMessage(message: string) {
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

/**
 * Toggle l'ouverture/fermeture du chat overlay
 */
export function toggleChat() {
  setIsChatOpen(!isChatOpen);
  const chatOverlay = document.getElementById('chatOverlay');
  if (chatOverlay) {
    chatOverlay.style.display = isChatOpen ? 'flex' : 'none';
    // Afficher les messages quand on ouvre le chat
    if (isChatOpen) {
      updateChatDisplay();
    }
  }
}

// Variable pour tracker si les event listeners ont été attachés
let chatEventListenersAttached = false;

/**
 * Injecte le chat overlay dans le DOM s'il n'existe pas déjà
 */
export function ensureChatOverlayExists() {
  const existing = document.getElementById('chatOverlay');
  if (!existing) {
    const chatContainer = document.createElement('div');
    chatContainer.innerHTML = getChatOverlayHTML();
    document.body.appendChild(chatContainer.firstElementChild as HTMLElement);
    console.log('[CHAT] Chat overlay injected into DOM');
    chatEventListenersAttached = false; // Reset flag car nouveau DOM
  }
  
  // Attacher les event listeners seulement s'ils ne l'ont pas encore été
  if (!chatEventListenersAttached) {
    attachChatEventListeners();
    chatEventListenersAttached = true;
  }
}

/**
 * Attache tous les event listeners du chat
 */
export function attachChatEventListeners() {
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

  // Bouton d'invitation à une partie
  document.getElementById("inviteToGameBtn")?.addEventListener("click", () => {
    const activeDmUserId = DM.getActiveDmUserId();
    const usernameEl = document.getElementById("dmActiveUserName");
    const username = usernameEl?.textContent || 'Player';
    
    if (activeDmUserId) {
      DM.inviteToGame(activeDmUserId, username);
    }
  });
}

/**
 * Retourne le HTML complet du chat overlay
 */
export function getChatOverlayHTML(): string {
  return `
    <!-- Chat Overlay -->
    <div id="chatOverlay" class="fixed inset-0 bg-black bg-opacity-50 z-50" style="display: none;">
      <div class="fixed right-4 top-4 bottom-4 w-[500px] rounded-lg flex flex-col chat-window-container" style="max-height: calc(100vh - 32px);">
        <!-- Header with Tabs -->
        <div class="chat-header flex-shrink-0">
          <div class="flex border-b border-orange-500">
            <button id="chatTabGlobal" class="flex-1 px-4 py-3 font-bold chat-tab-active">
              Global
            </button>
            <button id="chatTabMessages" class="flex-1 px-4 py-3 font-bold chat-tab-inactive">
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
        <div id="dmView" class="flex-1 flex-col hidden min-h-0 w-full">
          <!-- Conversations List -->
          <div id="dmConversationsList" class="flex-1 overflow-y-auto min-h-0 w-full chat-messages-bg">
            <div class="p-4 text-center text-gray-400">
              Chargement des conversations...
            </div>
          </div>

          <!-- Active Conversation -->
          <div id="dmActiveConversation" class="hidden h-full w-full">
            <div class="flex flex-col h-full w-full">
            <!-- Conversation Header -->
            <div class="p-3 border-b border-orange-500 flex items-center gap-3 flex-shrink-0 w-full chat-messages-bg">
              <button id="dmBackBtn" class="text-white hover:text-orange-400 text-xl font-bold">←</button>
              <img id="dmActiveUserAvatar" src="" alt="" class="w-8 h-8 rounded-full" style="border: 2px solid #ff8c00;">
              <div class="flex-1">
                <div id="dmActiveUserName" class="font-bold" style="color: #ff8c00;"></div>
                <div id="dmActiveUserStatus" class="text-xs text-gray-400"></div>
              </div>
              <button id="inviteToGameBtn" class="px-3 py-2 text-sm font-bold text-white flex items-center gap-2" style="background-color: #ffcc99; border: 2px solid #ff8c00; border-radius: 20px; box-shadow: 0px 2px 0px #e6a875; transition: all 0.15s ease;" onmouseover="this.style.backgroundColor='#ffd9b3'; this.style.transform='translateY(-1px)'; this.style.boxShadow='0px 3px 0px #e6a875';" onmouseout="this.style.backgroundColor='#ffcc99'; this.style.transform='translateY(0px)'; this.style.boxShadow='0px 2px 0px #e6a875';" title="Inviter à une partie">
                <img src="/images/victory-page.png" alt="Game" style="width: 20px; height: 20px;">
                <span>Inviter</span>
              </button>
            </div>

            <!-- Messages Container -->
            <div id="dmMessages" class="flex-1 overflow-y-auto space-y-2 min-h-0 p-4 w-full chat-messages-bg">
              <!-- DM messages will be added here -->
            </div>

            <!-- Input Area -->
            <div class="p-4 chat-input-area flex-shrink-0 w-full">
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
