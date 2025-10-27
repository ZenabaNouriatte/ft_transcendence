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
    tabGlobal.classList.add('text-gray-400');
  }
  if (tabMessages) {
    tabMessages.classList.add('chat-tab-active');
    tabMessages.classList.remove('text-gray-400');
  }
  
  // Load conversations
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
    tabGlobal.classList.remove('text-gray-400');
  }
  if (tabMessages) {
    tabMessages.classList.remove('chat-tab-active');
    tabMessages.classList.add('text-gray-400');
  }
}

// Load list of conversations
export async function loadDmConversations() {
  const token = localStorage.getItem('token');
  if (!token) return;
  
  console.log('[DM] Loading conversations...');
  
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
    
    console.log('[DM] Loaded conversations:', dmConversations.length, dmConversations);
    
    // Update unread count
    dmUnreadCount = dmConversations.reduce((sum: number, conv: any) => sum + (conv.unread_count || 0), 0);
    updateDmUnreadBadge();
    
    displayDmConversations();
  } catch (error) {
    console.error('[DM] Error loading conversations:', error);
  }
}

// Display conversations list
function displayDmConversations() {
  const listContainer = document.getElementById('dmConversationsList');
  if (!listContainer) {
    console.error('[DM] Conversations list container not found');
    return;
  }
  
  console.log('[DM] Displaying conversations:', dmConversations.length);
  
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
  
  console.log('[DM] Conversations displayed successfully');
}

// Open a conversation with a specific user
export async function openDmConversation(userId: number) {
  console.log('[DM] Opening conversation with user:', userId);
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
      console.log('[DM] User not in conversations, fetching from API');
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
      statusEl.textContent = conv.other_status === 'online' ? '🟢 En ligne' : '⚪ Hors ligne';
      statusEl.className = `text-xs ${conv.other_status === 'online' ? 'status-online' : 'status-offline'}`;
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
  
  messagesContainer.innerHTML = dmMessages.map(msg => {
    const isSent = msg.sender_id === currentUserId;
    const messageClass = isSent ? 'dm-message-sent' : 'dm-message-received';
    
    return `
      <div class="flex ${isSent ? 'justify-end' : 'justify-start'}">
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
      
      console.log('[DM] Message sent successfully, updating conversation list');
      
      // Update or create conversation in local list
      const existingConv = dmConversations.find((c: any) => c.other_user_id === userId);
      if (existingConv) {
        console.log('[DM] Updating existing conversation');
        existingConv.last_message = message.trim();
        existingConv.last_message_at = data.message.created_at;
      } else {
        console.log('[DM] New conversation, reloading list from backend');
        // If conversation doesn't exist, reload the list to get it from backend
        await loadDmConversations();
      }
      
      // Also send via WebSocket for real-time delivery
      (window as any).Presence?.send({
        type: 'dm.message',
        data: {
          receiverId: userId,
          message: message.trim()
        }
      });
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
  
  // Reload conversations to update unread counts
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
  
  // If this is the active conversation, add to messages
  if (activeDmUserId === senderId) {
    dmMessages.push({
      id,
      sender_id: senderId,
      receiver_id: getCurrentUserIdSync(),
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
  // This should be implemented to get current user ID from localStorage or global state
  const userDataStr = localStorage.getItem('userData');
  if (userDataStr) {
    try {
      const userData = JSON.parse(userDataStr);
      return userData.id || 0;
    } catch {
      return 0;
    }
  }
  return 0;
}

// Make functions available globally
(window as any).openDmConversation = openDmConversation;
(window as any).closeDmConversation = closeDmConversation;

// Export activeDmUserId getter
export function getActiveDmUserId(): number | null {
  return activeDmUserId;
}

(window as any).getActiveDmUserId = getActiveDmUserId;
