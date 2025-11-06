import { Presence } from '../websocket.js';

// Variables globales pour gérer l'état du jeu online
let onlineWS: WebSocket | null = null;
let isConnected = false;
let currentRoomId: string | null = null;
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

// Cache pour les noms d'utilisateur
const userNameCache = new Map<string, string>();

// Variables pour les event listeners (pour cleanup)
let keyDownHandler: ((event: KeyboardEvent) => void) | null = null;
let keyUpHandler: ((event: KeyboardEvent) => void) | null = null;

/**
 * Retourne le HTML de la page online
 */
export function getOnlineHTML(): string {
  console.log('🎮📄📄📄 getOnlineHTML() called - Online page is loading!');
  return `
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
          
          <!-- Bouton de contrôle du jeu online centré -->
          <div class="flex justify-center mb-4">
            <button id="pauseOnlineBtn" class="retro-btn-small hover-blue">
              Pause
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
  `;
}

/**
 * Attache les event listeners de la page online
 */
export function attachOnlineEvents() {
  console.log('🎮⚡⚡⚡ attachOnlineEvents() called - Setting up online page!');
  
  // Éléments du DOM
  const statusText = document.getElementById("statusText") as HTMLElement;
  const customRoomNameInput = document.getElementById("customRoomNameInput") as HTMLInputElement;
  const roomIdInput = document.getElementById("roomIdInput") as HTMLInputElement;
  const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
  const createRoomBtn = document.getElementById("createRoomBtn") as HTMLButtonElement;
  const gameControls = document.getElementById("onlineGameControls") as HTMLElement;
  const playersInfo = document.getElementById("playersInfo") as HTMLElement;
  const playersList = document.getElementById("playersList") as HTMLElement;
  const gameArea = document.getElementById("onlineGameArea") as HTMLElement;
  const canvas = document.getElementById("onlineCanvas") as HTMLCanvasElement;
  const readyBtn = document.getElementById("readyBtn") as HTMLButtonElement;
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
      // Tous les joueurs sont prêts - le jeu va démarrer automatiquement
      if (statusDiv) statusDiv.innerHTML = '<span class="text-green-400">🟢 Both players ready! Starting game...</span>';
    } else {
      // En attente d'autres joueurs
      if (statusDiv) statusDiv.innerHTML = `<span class="text-orange-400">Ready: ${readyCount}/${totalPlayers} players</span>`;
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
        
        // Cacher les éléments
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
  async function handleGameMessage(message: any) {
    switch (message.type) {
      case 'game.created':
        currentRoomId = message.data.gameId;
        const autoJoined = message.data.autoJoined;
        
        if (autoJoined) {
          updateStatus(`🟢 Room created and joined: ${currentRoomId}`, 'text-green-400');
          console.log(`✅ Auto-joined room ${currentRoomId}`);
        } else {
          updateStatus(`🟢 Room created: ${currentRoomId}`, 'text-green-400');
        }
        
        if (roomIdInput && currentRoomId) roomIdInput.value = currentRoomId;
        
        console.log('🎮🔍🔍🔍 Checking for pending invitation...');
        // Check if there's a pending game invitation to send
        const pendingInvitation = sessionStorage.getItem('pendingGameInvitation');
        console.log('🎮🔍 pendingInvitation from sessionStorage:', pendingInvitation);
        
        if (pendingInvitation) {
          console.log('🎮✅ FOUND PENDING INVITATION!');
          try {
            const invitationData = JSON.parse(pendingInvitation);
            console.log('🎮 Parsed invitation data:', invitationData);
            console.log('🎮 About to call Presence.send()...');
            
            // Send invitation via Presence WebSocket
            Presence.send({
              type: 'game.invitation',
              data: {
                receiverId: invitationData.receiverId,
                gameId: invitationData.gameId,
                senderUsername: invitationData.senderUsername
              }
            });
            
            console.log('🎮 Presence.send() called successfully!');
            
            // Show notification to sender
            updateStatus(`🎮 Invitation sent to ${invitationData.receiverUsername}!`, 'text-purple-400');
            
            // Clear the pending invitation
            sessionStorage.removeItem('pendingGameInvitation');
            console.log('🎮 Pending invitation cleared from sessionStorage');
            
          } catch (err) {
            console.error('🎮❌ [Online] Error sending invitation:', err);
          }
        } else {
          console.log('🎮 No pending invitation found');
        }
        
        break;
        
      case 'game.joined':
        currentRoomId = message.data.gameId;
        updateStatus(`🟢 Joined room: ${currentRoomId}`, 'text-green-400');
        
        console.log(`[Debug] game.joined received - currentUserId: ${currentUserId}`);
        console.log('[Debug] Full message.data:', JSON.stringify(message.data, null, 2));
        console.log('[Debug] message.data.players:', message.data?.players);
        
        // Mettre à jour la liste des joueurs si elle est fournie
        if (message.data && message.data.players) {
          console.log('[Debug] ✅ Calling updatePlayersList with players:', message.data.players);
          await updatePlayersList(message.data);
          
          // Déterminer le numéro de joueur actuel
          if (currentUserId) {
            const currentPlayer = message.data.players.find((p: any) => p.id === currentUserId);
            if (currentPlayer) {
              currentPlayerNumber = currentPlayer.paddle === 'left' ? 1 : 2;
              console.log(`[Debug] ✅ Joined as player ${currentPlayerNumber} with paddle ${currentPlayer.paddle}, userId: ${currentUserId}`);
            } else {
              console.warn(`[Debug] ❌ Could not find currentPlayer in players list. UserId: ${currentUserId}, Players:`, message.data.players);
            }
          } else {
            console.warn(`[Debug] ❌ currentUserId is null`);
          }
        } else {
          console.warn('[Debug] ⚠️ game.joined received but NO players data!');
          console.warn('[Debug] message.data:', message.data);
        }
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
        
        // Masquer les infos de room et afficher la zone de jeu
        if (playersInfo) playersInfo.classList.add('hidden');
        if (gameArea) gameArea.classList.remove('hidden');
        initializeGameCanvas();
        break;
        
      case 'game_state':
        // Gérer le countdown
        if (message.data && typeof message.data.countdown === 'number') {
          if (message.data.countdown > 0) {
            updateStatus(`⏱️ Starting in ${message.data.countdown}...`, 'text-yellow-400');
            // Afficher le canvas et masquer les infos dès le countdown
            if (playersInfo) playersInfo.classList.add('hidden');
            if (gameArea) gameArea.classList.remove('hidden');
            initializeGameCanvas();
          } else if (message.data.countdown === 0) {
            updateStatus('🚀 GO!', 'text-green-400');
          }
          break;
        }
        
        // Mettre à jour l'état du jeu sur le canvas
        if (message.data && message.data.state) {
          renderGameState(message.data.state);
        }
        
        // Mettre à jour la liste des joueurs si disponible
        if (message.data && message.data.players) {
          await updatePlayersList(message.data);
          
          // Déterminer le numéro de joueur actuel basé sur le paddle
          if (currentUserId) {
            const currentPlayer = message.data.players.find((p: any) => p.id === currentUserId);
            if (currentPlayer) {
              // Mapping correct : left = joueur 1, right = joueur 2
              const newPlayerNumber = currentPlayer.paddle === 'left' ? 1 : 2;
              if (currentPlayerNumber !== newPlayerNumber) {
                currentPlayerNumber = newPlayerNumber;
                console.log(`[Debug] Player number set to ${currentPlayerNumber} for paddle ${currentPlayer.paddle}`);
              }
            }
          }
        }
        break;
        
      case 'player_joined':
        console.log('[Debug] 📥 player_joined received:', message.data);
        // Mettre à jour la liste des joueurs
        await updatePlayersList(message.data);
        console.log('[Debug] ✅ updatePlayersList called after player_joined');
        break;
        
      case 'player_left':
        console.log('[Debug] 📤 player_left received:', message.data);
        // Mettre à jour la liste des joueurs
        await updatePlayersList(message.data);
        break;
        
      case 'game_ended':
        console.log('🏁 Jeu terminé:', message.data);
        isGameStarted = false; // Le jeu n'est plus en cours
        
        // Faire disparaître le bouton pause
        const pauseBtnEnd = document.getElementById('pauseOnlineBtn') as HTMLButtonElement;
        if (pauseBtnEnd) {
          pauseBtnEnd.disabled = true;
          // pauseBtnEnd.textContent = 'Game Over';
          pauseBtnEnd.style.opacity = '0';
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
    console.log('[Debug] 📋 updatePlayersList called with data:', data);
    if (playersList) {
      if (data && data.players && data.players.length > 0) {
        console.log('[Debug] ✅ Updating players list with', data.players.length, 'players');
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
      console.log(`[Debug] Sending input - Player: ${currentPlayerNumber}, Direction: ${direction}, RoomId: ${currentRoomId}`);
      sendMessage({
        type: 'game.input',
        data: {
          gameId: currentRoomId,
          player: currentPlayerNumber,
          direction: direction
        }
      });
    } else if (direction && !currentPlayerNumber) {
      console.warn(`[Debug] Cannot send input - currentPlayerNumber is null. UserId: ${currentUserId}`);
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
  
  // Sauvegarder les références pour cleanup
  keyDownHandler = handleKeyDown;
  keyUpHandler = handleKeyUp;
  
  // Ajouter les event listeners clavier
  document.addEventListener('keydown', keyDownHandler);
  document.addEventListener('keyup', keyUpHandler);
  
  // Event listener pour le bouton pause du jeu online
  const pauseButton = document.getElementById("pauseOnlineBtn");
  if (pauseButton) {
    console.log('✅ Bouton pause trouvé et event listener attaché');
    pauseButton.addEventListener('click', async () => {
      console.log('🔍 Bouton pause cliqué');
      console.log('   - CurrentRoomId:', currentRoomId);
      console.log('   - IsConnected:', isConnected);
      console.log('   - IsGameStarted:', isGameStarted);
      console.log('   - IsPaused:', isPaused);
      
      if (currentRoomId && isConnected && isGameStarted) {
        try {
          const token = localStorage.getItem('token');
          if (!token) {
            console.warn('❌ Pas de token d\'authentification');
            return;
          }

          const action = isPaused ? 'resume' : 'pause';
          const endpoint = `/api/games/${currentRoomId}/${action}`;
          
          console.log(`🚀 Envoi requête ${action} à ${endpoint}`);

          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });

          if (response.ok) {
            const result = await response.json();
            console.log(`✅ Jeu ${action}d avec succès:`, result);
            
            // Mettre à jour l'état local
            isPaused = !isPaused;
            const pauseBtn = document.getElementById('pauseOnlineBtn');
            if (pauseBtn) {
              pauseBtn.textContent = isPaused ? 'Resume' : 'Pause';
            }
            updateStatus(isPaused ? '⏸️ Jeu en pause' : '▶️ Jeu repris', isPaused ? 'text-yellow-400' : 'text-green-400');
          } else {
            const errorText = await response.text();
            console.error(`❌ Erreur lors du ${action}:`, response.status, errorText);
            
            if (response.status === 400) {
              updateStatus(`❌ Impossible de ${action === 'pause' ? 'mettre en pause' : 'reprendre'} - jeu terminé ou invalide`, 'text-red-400');
            } else {
              updateStatus(`❌ Erreur ${response.status} lors du ${action}`, 'text-red-400');
            }
          }
        } catch (error) {
          console.error('❌ Erreur réseau lors de la pause/reprise:', error);
          updateStatus('❌ Erreur réseau', 'text-red-400');
        }
      } else {
        console.warn('⚠️ Impossible de faire pause - Room:', !!currentRoomId, 'Connected:', isConnected, 'GameStarted:', isGameStarted);
        if (!isGameStarted) {
          updateStatus('❌ Jeu non démarré ou terminé', 'text-red-400');
        } else if (!isConnected) {
          updateStatus('❌ Connexion perdue', 'text-red-400');
        } else {
          updateStatus('❌ Conditions non remplies pour la pause', 'text-red-400');
        }
      }
    });
  } else {
    console.error('❌ Bouton pause non trouvé dans le DOM');
  }

  // Auto-connect if roomId is provided in URL
  const fullHash = location.hash || '';
  const urlParams = new URLSearchParams(fullHash.split('?')[1] || '');
  const roomIdFromUrl = urlParams.get('roomId');
  const shouldCreate = urlParams.get('create') === 'true';
  const shouldJoin = urlParams.get('join') === 'true';
  
  // Check for immediate join from sessionStorage (used when already on page)
  const immediateJoin = sessionStorage.getItem('immediateJoin');
  if (immediateJoin) {
    console.log(`[Online] Immediate join detected for room: ${immediateJoin}`);
    sessionStorage.removeItem('immediateJoin');
    setTimeout(() => {
      connectToGame(immediateJoin, false); // false = join, not create
    }, 100);
  } else if (roomIdFromUrl) {
    console.log(`[Online] Auto-connecting to room: ${roomIdFromUrl}, create: ${shouldCreate}, join: ${shouldJoin}`);
    setTimeout(() => {
      connectToGame(roomIdFromUrl, shouldCreate);
    }, 100);
  }
}

/**
 * Nettoyer les event listeners et connexions WebSocket
 */
export function cleanupOnline() {
  // Retirer les event listeners clavier
  if (keyDownHandler) {
    document.removeEventListener('keydown', keyDownHandler);
    keyDownHandler = null;
  }
  if (keyUpHandler) {
    document.removeEventListener('keyup', keyUpHandler);
    keyUpHandler = null;
  }
  
  // Fermer la connexion WebSocket
  if (onlineWS) {
    onlineWS.close();
    onlineWS = null;
  }
  
  // Réinitialiser les variables d'état
  isConnected = false;
  currentRoomId = null;
  playersInRoom = [];
  currentUserId = null;
  currentPlayerNumber = null;
  currentUserName = null;
  playersReady = {};
  isCurrentPlayerReady = false;
  isPaused = false;
  isGameStarted = false;
  userNameCache.clear();
}
