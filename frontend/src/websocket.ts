// WEBSOCKET SINGLETON POUR LE SYSTÈME DE PRÉSENCE ET CHAT

// Type pour les handlers de messages WebSocket
type MessageHandler = (data: any) => void;

// Singleton WebSocket pour la présence et le chat
export const Presence = (() => {
  const MODULE_ID = Math.random().toString(36).substring(7);
  console.log(`[WS] 🆔 Module instance created with ID: ${MODULE_ID}`);
  
  let sock: WebSocket | null = null;
  let token: string | null = null;
  let reconnectTimer: number | null = null;
  
  // Handlers pour les différents types de messages
  const messageHandlers: Record<string, MessageHandler[]> = {};

  // Enregistre un handler pour un type de message spécifique
  function on(messageType: string, handler: MessageHandler) {
    console.log(`[WS] 📝 Module ${MODULE_ID}: Registering handler for type: ${messageType}`);
    console.log(`[WS] 📦 Module ${MODULE_ID}: Current messageHandlers:`, Object.keys(messageHandlers));
    if (!messageHandlers[messageType]) {
      messageHandlers[messageType] = [];
    }
    messageHandlers[messageType].push(handler);
    console.log(`[WS] ✅ Module ${MODULE_ID}: Handler registered for type: ${messageType}. Total handlers:`, messageHandlers[messageType].length);
  }

  // Émet un message aux handlers enregistrés
  function emit(messageType: string, data: any) {
    console.log(`[WS] 🔔 Module ${MODULE_ID}: emit called for type: ${messageType}`);
    console.log(`[WS] 📦 Module ${MODULE_ID}: Current messageHandlers:`, Object.keys(messageHandlers));
    const handlers = messageHandlers[messageType];
    console.log(`[WS] 🔍 Module ${MODULE_ID}: Found ${handlers?.length || 0} handlers for ${messageType}`);
    if (handlers) {
      handlers.forEach((handler, index) => {
        try {
          console.log(`[WS] 🎯 Module ${MODULE_ID}: Calling handler #${index} for ${messageType}`);
          handler(data);
        } catch (error) {
          console.error(`[WS] ❌ Module ${MODULE_ID}: Error in handler #${index} for ${messageType}:`, error);
        }
      });
    } else {
      console.warn(`[WS] ⚠️ Module ${MODULE_ID}: No handlers registered for message type: ${messageType}`);
    }
  }

  function wsUrl(t: string) {
    // même host/port que la page -> OK derrière nginx
    return `wss://${location.host}/ws?channel=chat&token=${encodeURIComponent(t)}`;
  }

  function connect(t: string) {
    console.log(`[WS] 🔌 Module ${MODULE_ID}: connect() called`);
    console.log(`[WS] 📦 Module ${MODULE_ID}: messageHandlers before connect:`, Object.keys(messageHandlers));
    token = t;
    disconnect();
    if (!token) return;

    const u = wsUrl(token);
    sock = new WebSocket(u);

    sock.onopen = () => {
      console.log(`[presence]✅ Module ${MODULE_ID}: WebSocket opened`);
      console.log(`[WS] 📦 Module ${MODULE_ID}: messageHandlers after open:`, Object.keys(messageHandlers));
    };
    sock.onmessage = (e) => {
      console.log('[WS] Message received:', e.data);
      
      // Ignorer les messages non-JSON comme "hello: connected"
      if (!e.data.startsWith('{')) {
        return;
      }
      
      try {
        const data = JSON.parse(e.data);
        console.log('[WS] Parsed data type:', data.type);
        
        // Log spécial pour game.invitation
        if (data.type === 'game.invitation') {
          console.log('[WS] 🎮🎮🎮 GAME INVITATION RECEIVED:', data.data);
        }
        
        // Émettre le message aux handlers enregistrés
        emit(data.type, data);
      } catch (error) {
        console.warn('[chat] Erreur parsing message:', error);
      }
    };
    sock.onclose = (e) => {
      console.log('[presence] ❌ WebSocket closed:', e.code, e.reason || '(reconnecting...)');
      sock = null;
      if (token && reconnectTimer === null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          console.log('[presence] 🔄 Reconnecting WebSocket...');
          connect(token!);
        }, 2000);
      }
    };
    sock.onerror = (e) => {
      // Erreur WebSocket - souvent normale lors de la reconnexion
      if (e.target && (e.target as any).readyState === WebSocket.CLOSED) {
        console.log('[presence] WebSocket connection lost, will reconnect...');
      } else {
        console.warn('[presence] ⚠️ WebSocket error:', e);
      }
    };
  }

  function disconnect() {
    console.log(`[WS] 🔌 Module ${MODULE_ID}: disconnect() called`);
    console.log(`[WS] 📦 Module ${MODULE_ID}: messageHandlers before disconnect:`, Object.keys(messageHandlers));
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (sock && sock.readyState === WebSocket.OPEN) { 
      try { 
        sock.close(1000, 'bye'); 
        console.log(`[presence] 🔌 Module ${MODULE_ID}: Explicit disconnect`);
      } catch {}
    }
    sock = null;
  }
  
  function clear() {
    console.log(`[WS] 🧹 Module ${MODULE_ID}: clear() called`);
    console.log(`[WS] 📦 Module ${MODULE_ID}: messageHandlers before clear:`, Object.keys(messageHandlers));
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

  return { connect, disconnect, clear, send, on };
})();

// Fermer proprement la WebSocket quand l'onglet se ferme
window.addEventListener('beforeunload', () => {
  console.log('[presence] 🚪 Page closing, disconnecting WebSocket...');
  Presence.disconnect();
});
