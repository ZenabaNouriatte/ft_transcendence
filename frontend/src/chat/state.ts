// ÉTAT DU SYSTÈME DE CHAT

/**
 * État d'ouverture du chat
 */
export let isChatOpen = false;

/**
 * Messages du chat global
 */
export let chatMessages: Array<{userId: number, username: string, avatar: string | null, message: string, timestamp: Date}> = [];

/**
 * Définit l'état d'ouverture du chat
 */
export function setIsChatOpen(value: boolean) {
  isChatOpen = value;
}

/**
 * Ajoute un message au chat
 */
export function addChatMessage(message: {userId: number, username: string, avatar: string | null, message: string, timestamp: Date}) {
  chatMessages.push(message);
}

/**
 * Charger les messages depuis localStorage au démarrage
 */
export function loadChatMessagesFromStorage() {
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

/**
 * Vider les messages du chat (appelé au logout ou clean)
 */
export function clearChatMessages() {
  chatMessages = [];
  localStorage.removeItem('chatMessages');
  console.log('[CHAT] Chat messages cleared');
}

/**
 * Sauvegarder les messages dans localStorage
 */
export function saveChatMessagesToStorage() {
  try {
    // Garder seulement les 100 derniers messages pour ne pas surcharger localStorage
    const messagesToSave = chatMessages.slice(-100);
    localStorage.setItem('chatMessages', JSON.stringify(messagesToSave));
  } catch (error) {
    console.error('[CHAT] Error saving messages to localStorage:', error);
  }
}

/**
 * Handler pour les messages de chat WebSocket
 * Appelé par le router au démarrage
 */
export function handleChatMessage(data: any, isUserBlocked: (userId: number) => boolean, updateChatDisplay: () => void) {
  console.log('[CHAT] handleChatMessage called with data:', data);
  
  const newMessage = {
    userId: data.userId || 0,
    username: data.username || 'Anonyme',
    avatar: data.avatar || null,
    message: data.message || '',
    timestamp: new Date()
  };
  
  console.log('[CHAT] Processed message:', newMessage);
  
  // Ne pas afficher les messages des utilisateurs bloqués
  if (!isUserBlocked(newMessage.userId)) {
    addChatMessage(newMessage);
    saveChatMessagesToStorage();
    console.log('[CHAT] Total messages:', chatMessages.length);
    updateChatDisplay();
  } else {
    console.log('[CHAT] Message from blocked user ignored:', newMessage.username);
  }
}
