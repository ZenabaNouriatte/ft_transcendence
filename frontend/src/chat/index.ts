// MODULE CHAT - Point d'entrée

// Exports de state.ts
export { 
  isChatOpen, 
  chatMessages, 
  setIsChatOpen, 
  addChatMessage,
  loadChatMessagesFromStorage,
  clearChatMessages,
  saveChatMessagesToStorage,
  handleChatMessage
} from './state.js';

// Exports de ui.ts
export {
  updateChatDisplay,
  sendChatMessage,
  toggleChat,
  ensureChatOverlayExists,
  attachChatEventListeners,
  getChatOverlayHTML
} from './ui.js';

// Ré-exporter tout le module DM
export * as DM from './dm.js';
