// Direct Messages (DM) Management
// This file handles all DM-related functionality for the frontend

// Global state for DM
let dmConversations: any[] = [];
let activeDmUserId: number | null = null;
let dmMessages: any[] = [];
let dmUnreadCount = 0;

// Switch between Global Chat and DM tabs
export function switchToDmTab() {
  const globalView = document.getElementById('globalChatView');
  const dmView = document.getElementById('dmView');
  const tabGlobal = document.getElementById('chatTabGlobal');
  const tabMessages = document.getElementById('chatTabMessages');
  
  if (globalView) globalView.style.display = 'none';
  if (dmView) dmView.style.display = 'flex';
  
  if (tabGlobal) {
    tabGlobal.classList.remove('chat-tab-active');
    tabGlobal.classList.add('chat-tab-inactive');
  }
  if (tabMessages) {
    tabMessages.classList.add('chat-tab-active');
    tabMessages.classList.remove('chat-tab-inactive');
  }
  
  // IMPORTANT: Always load conversations when switching to DM tab
  loadDmConversations();
}

export function switchToGlobalTab() {
  const globalView = document.getElementById('globalChatView');
  const dmView = document.getElementById('dmView');
  const tabGlobal = document.getElementById('chatTabGlobal');
  const tabMessages = document.getElementById('chatTabMessages');
  
  if (globalView) globalView.style.display = 'flex';
  if (dmView) dmView.style.display = 'none';
  
  if (tabGlobal) {
    tabGlobal.classList.add('chat-tab-active');
    tabGlobal.classList.remove('chat-tab-inactive');
  }
  if (tabMessages) {
    tabMessages.classList.remove('chat-tab-active');
    tabMessages.classList.add('chat-tab-inactive');
  }
}

// Load list of conversations
export async function loadDmConversations() {
  const token = localStorage.getItem('token');
  if (!token) {
    console.warn('[DM] No token found, cannot load conversations');
    return;
  }
  
  try {
    const response = await fetch('/api/messages/conversations', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      console.error('[DM] Failed to load conversations, status:', response.status);
      return;
    }
    
    const data = await response.json();
    dmConversations = data.conversations || [];
    
    // Update unread count
    dmUnreadCount = dmConversations.reduce((sum: number, conv: any) => sum + (conv.unread_count || 0), 0);
    updateDmUnreadBadge();
    
    displayDmConversations();
  } catch (error) {
    console.error('[DM] ❌ Error loading conversations:', error);
  }
}

// Display conversations list
function displayDmConversations() {
  const listContainer = document.getElementById('dmConversationsList');
  if (!listContainer) {
    console.error('[DM] Conversations list container not found');
    return;
  }
  
  if (dmConversations.length === 0) {
    listContainer.innerHTML = `
      <div class="p-8 text-center text-gray-500">
        <p class="text-lg mb-2">Aucune conversation</p>
        <p class="text-sm">Commencez une conversation en visitant le profil d'un utilisateur</p>
      </div>
    `;
    return;
  }
  
  listContainer.innerHTML = dmConversations.map(conv => `
    <div class="dm-conversation-item ${conv.unread_count > 0 ? 'unread' : ''}" 
         data-user-id="${conv.other_user_id}"
         onclick="window.openDmConversation(${conv.other_user_id})">
      <div class="flex items-center gap-3">
        <img src="${getUserAvatarPath(conv.other_user_id, conv.other_avatar)}" 
             alt="${conv.other_username}"
             class="dm-conversation-avatar">
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between mb-1">
            <span class="dm-conversation-name">${escapeHtml(conv.other_username)}</span>
            <span class="dm-conversation-time">${formatTime(conv.last_message_at)}</span>
          </div>
          <div class="flex items-center justify-between">
            <span class="dm-conversation-preview">${escapeHtml(conv.last_message || 'Aucun message')}</span>
            ${conv.unread_count > 0 ? `<span class="dm-unread-badge">${conv.unread_count}</span>` : ''}
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// Open a conversation with a specific user
export async function openDmConversation(userId: number) {
  activeDmUserId = userId;
  
  // Hide conversations list, show active conversation
  const listContainer = document.getElementById('dmConversationsList');
  const activeConv = document.getElementById('dmActiveConversation');
  
  if (listContainer) listContainer.style.display = 'none';
  if (activeConv) {
    activeConv.classList.remove('hidden');
    activeConv.style.display = 'flex';
  }
  
  // Load user info first, then conversation
  await loadUserInfoAndConversation(userId);
  
  // Ensure this conversation exists in the local list for when we go back
  // This is important for new conversations that don't have messages yet
  const existsInList = dmConversations.some((c: any) => c.other_user_id === userId);
  if (!existsInList) {
    // The conversation will be properly loaded from backend when we go back or refresh
    await loadDmConversations();
  }
  
  // Mark as read
  markConversationAsRead(userId);
}

// Load user info and conversation
async function loadUserInfoAndConversation(userId: number) {
  const token = localStorage.getItem('token');
  if (!token) return;
  
  try {
    // First, try to get user info from existing conversations
    let conv = dmConversations.find((c: any) => c.other_user_id === userId);
    
    // If not in conversations, fetch user info from API
    if (!conv) {
      const userResponse = await fetch(`/api/users/${userId}/profile`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      if (userResponse.ok) {
        const userData = await userResponse.json();
        const user = userData.user;
        
        // Create a fake conversation object with user info
        conv = {
          other_user_id: userId,
          other_username: user.username,
          other_avatar: user.avatar,
          other_status: user.status || 'offline'
        };
      } else {
        console.error('[DM] Failed to fetch user info');
        // Fallback to default
        conv = {
          other_user_id: userId,
          other_username: `User ${userId}`,
          other_avatar: null,
          other_status: 'offline'
        };
      }
    }
    
    // Update header with user info
    const avatarEl = document.getElementById('dmActiveUserAvatar') as HTMLImageElement;
    const nameEl = document.getElementById('dmActiveUserName');
    const statusEl = document.getElementById('dmActiveUserStatus');
    
    if (avatarEl) avatarEl.src = getUserAvatarPath(userId, conv.other_avatar);
    if (nameEl) nameEl.textContent = conv.other_username;
    if (statusEl) {
      const isOnline = conv.other_status === 'online';
      const statusIcon = isOnline ? '/images/online.png' : '/images/offline.png';
      const statusText = isOnline ? 'En ligne' : 'Hors ligne';
      statusEl.innerHTML = `<img src="${statusIcon}" alt="${statusText}" style="width: 12px; height: 12px; display: inline-block; margin-right: 4px;"> ${statusText}`;
      statusEl.className = `text-xs ${isOnline ? 'status-online' : 'status-offline'}`;
    }
    
    // Now load the conversation messages
    await loadConversation(userId);
    
  } catch (error) {
    console.error('[DM] Error loading user info and conversation:', error);
  }
}

// Load messages for a conversation
async function loadConversation(userId: number) {
  const token = localStorage.getItem('token');
  if (!token) return;
  
  try {
    const response = await fetch(`/api/messages/conversation/${userId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      console.error('Failed to load conversation');
      return;
    }
    
    const data = await response.json();
    dmMessages = data.messages || [];
    
    displayDmMessages();
  } catch (error) {
    console.error('Error loading conversation:', error);
  }
}

// Display messages in active conversation
function displayDmMessages() {
  const messagesContainer = document.getElementById('dmMessages');
  if (!messagesContainer) return;
  
  const currentUserId = getCurrentUserIdSync();
  
  messagesContainer.innerHTML = dmMessages.map((msg, index) => {
    const isSent = msg.sender_id === currentUserId;
    const messageClass = isSent ? 'dm-message-sent' : 'dm-message-received';
    
    return `
      <div class="flex w-full ${isSent ? 'justify-end' : 'justify-start'}">
        <div class="${messageClass}">
          <div>${escapeHtml(msg.message)}</div>
          <div class="dm-message-time">${formatTime(msg.created_at)}</div>
        </div>
      </div>
    `;
  }).join('');
  
  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Send a direct message
export async function sendDirectMessage(userId: number, message: string) {
  if (!message.trim()) return;
  
  const token = localStorage.getItem('token');
  if (!token) return;
  
  try {
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        receiverId: userId,
        message: message.trim()
      })
    });
    
    if (!response.ok) {
      console.error('Failed to send message');
      return;
    }
    
    const data = await response.json();
    if (data.success && data.message) {
      // Add message to local array
      dmMessages.push(data.message);
      displayDmMessages();
      
      // IMPORTANT: Always reload conversations after sending a message
      // This ensures the conversation appears in the list even if it's new
      await loadDmConversations();
      
      // Update the specific conversation if it exists in the list now
      const existingConv = dmConversations.find((c: any) => c.other_user_id === userId);
      if (existingConv) {
        existingConv.last_message = message.trim();
        existingConv.last_message_at = data.message.created_at;
      }
      
      // Note: No need to send via WebSocket - the API already handles real-time delivery
    }
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Mark conversation as read
async function markConversationAsRead(userId: number) {
  const token = localStorage.getItem('token');
  if (!token) return;
  
  try {
    await fetch('/api/messages/read', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        otherUserId: userId
      })
    });
    
    // Update local unread count
    const conv = dmConversations.find((c: any) => c.other_user_id === userId);
    if (conv) {
      conv.unread_count = 0;
      dmUnreadCount = dmConversations.reduce((sum: number, c: any) => sum + (c.unread_count || 0), 0);
      updateDmUnreadBadge();
    }
  } catch (error) {
    console.error('Error marking as read:', error);
  }
}

// Go back to conversations list
export function closeDmConversation() {
  activeDmUserId = null;
  dmMessages = [];
  
  const listContainer = document.getElementById('dmConversationsList');
  const activeConv = document.getElementById('dmActiveConversation');
  
  if (listContainer) listContainer.style.display = 'block';
  if (activeConv) {
    activeConv.classList.add('hidden');
    activeConv.style.display = 'none';
  }
  
  // IMPORTANT: Reload conversations from backend to get updated list with any new messages
  loadDmConversations();
}

// Update unread badge
function updateDmUnreadBadge() {
  const badge = document.getElementById('dmUnreadBadge');
  if (!badge) return;
  
  if (dmUnreadCount > 0) {
    badge.textContent = String(dmUnreadCount);
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// Handle incoming DM from WebSocket
export function handleIncomingDm(data: any) {
  const { id, senderId, senderUsername, senderAvatar, message, timestamp } = data;
  
  const currentUserId = getCurrentUserIdSync();
  
  // If this is the active conversation, add to messages
  if (activeDmUserId === senderId) {
    dmMessages.push({
      id,
      sender_id: senderId,
      receiver_id: currentUserId,
      message,
      created_at: timestamp,
      sender_username: senderUsername,
      sender_avatar: senderAvatar
    });
    displayDmMessages();
    
    // Mark as read
    markConversationAsRead(senderId);
  } else {
    // Update unread count
    dmUnreadCount++;
    updateDmUnreadBadge();
  }
  
  // Reload conversations list to show new message
  loadDmConversations();
}

// Utility functions
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function getUserAvatarPath(userId: number, userAvatar?: string | null): string {
  if (userAvatar && userAvatar.startsWith('/uploads/')) {
    return userAvatar;
  }
  const imageNumber = userId > 15 ? ((userId - 1) % 15) + 1 : userId;
  return `/images/${imageNumber}.JPG`;
}

function getCurrentUserIdSync(): number {
  // Try to get user ID from token JWT
  const token = localStorage.getItem('token');
  if (!token) {
    console.warn('[DM] No token found, cannot determine current user ID');
    return 0;
  }
  
  try {
    // Decode JWT token to get user ID
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    
    const payload = JSON.parse(jsonPayload);
    const userId = payload.userId || payload.id || payload.sub;
    
    console.log('[DM] Current user ID from token:', userId);
    return userId || 0;
  } catch (error) {
    console.error('[DM] Error decoding token:', error);
    return 0;
  }
}

// Invite user to an online game
export async function inviteToGame(userId: number, username: string) {
  console.log(`[DM] Inviting user ${userId} (${username}) to game`);
  
  try {
    // Create a new online game room
    const gameId = `game_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    // Get current user info
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Vous devez être connecté pour inviter à une partie');
      return;
    }
    
    const currentUserId = getCurrentUserIdSync();
    const response = await fetch('/api/users/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      alert('Erreur lors de la récupération de vos informations');
      return;
    }
    
    const data = await response.json();
    const currentUsername = data.user.username;
    
    // Store invitation data in sessionStorage to send after room is created
    sessionStorage.setItem('pendingGameInvitation', JSON.stringify({
      receiverId: userId,
      receiverUsername: username,
      gameId: gameId,
      senderUsername: currentUsername
    }));
    
    // Redirect to online game room with create=true
    location.hash = `#/online?roomId=${gameId}&create=true`;
    
  } catch (error) {
    console.error('[DM] Error preparing game invitation:', error);
    alert('Erreur lors de la préparation de l\'invitation');
  }
}

// Handle incoming game invitation
export function handleGameInvitation(data: any) {
  const { senderId, senderUsername, gameId } = data;
  
  // Create a custom invitation overlay instead of confirm() which gets blocked on inactive tabs
  showGameInvitationDialog(senderUsername, gameId);
}

// Show a custom game invitation dialog
function showGameInvitationDialog(senderUsername: string, gameId: string) {
  // Remove any existing invitation dialog
  const existingDialog = document.getElementById('gameInvitationDialog');
  if (existingDialog) {
    existingDialog.remove();
  }
  
  // Create the dialog overlay using the same style as Edit Profile modal
  const dialog = document.createElement('div');
  dialog.id = 'gameInvitationDialog';
  dialog.className = 'profile-modal';
  dialog.style.display = 'flex';
  
  dialog.innerHTML = `
    <div class="profile-modal-content" style="max-width: 500px;">
      <div class="profile-modal-header">
        <h2 class="page-title-medium page-title-purple">🎮 Game Invitation</h2>
        <button id="closeInvitationPopup" class="close-modal-btn">&times;</button>
      </div>
      <div style="text-align: center; padding: 2rem 1rem;">
        <div style="font-size: 4rem; margin-bottom: 1.5rem;">🎮</div>
        <p class="form-description-purple" style="font-size: 1.25rem; margin-bottom: 2rem;">
          <strong>${escapeHtml(senderUsername)}</strong> invites you to play!
        </p>
        <div class="modal-buttons">
          <button id="acceptInvitation" class="retro-btn hover-green">
            ✅ Accept
          </button>
          <button id="declineInvitation" class="retro-btn hover-red">
            ❌ Decline
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // Event listeners
  const acceptBtn = document.getElementById('acceptInvitation');
  const declineBtn = document.getElementById('declineInvitation');
  const closeBtn = document.getElementById('closeInvitationPopup');
  
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      dialog.remove();
    });
  }
  
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      dialog.remove();
      
      // Force navigation even if already on #/online page
      const currentRoute = location.hash.split('?')[0];
      if (currentRoute === '#/online') {
        // Store the join request for immediate execution
        sessionStorage.setItem('immediateJoin', gameId);
        // Force page reload by navigating away and back
        location.hash = '#/';
        setTimeout(() => {
          location.hash = `#/online?roomId=${gameId}&join=true&t=${Date.now()}`;
        }, 50);
      } else {
        location.hash = `#/online?roomId=${gameId}&join=true`;
      }
    });
  }
  
  if (declineBtn) {
    declineBtn.addEventListener('click', () => {
      dialog.remove();
    });
  }
  
  // Close on outside click
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      dialog.remove();
    }
  });
}

// Make functions available globally
(window as any).openDmConversation = openDmConversation;
(window as any).closeDmConversation = closeDmConversation;
(window as any).inviteToGame = inviteToGame;

// Export activeDmUserId getter
export function getActiveDmUserId(): number | null {
  return activeDmUserId;
}

(window as any).getActiveDmUserId = getActiveDmUserId;
