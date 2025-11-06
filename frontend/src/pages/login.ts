// PAGE DE CONNEXION

import { Presence } from '../websocket.js';
import { handleChatMessage } from '../chat/state.js';
import { updateChatDisplay } from '../chat/ui.js';
import { isUserBlocked, loadBlockedUsers } from '../blocking/index.js';
import * as Chat from '../chat/index.js';

/**
 * Génère le HTML de la page de connexion
 */
export function getLoginHTML(): string {
  return `
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
  `;
}

/**
 * Attache les event listeners de la page de connexion
 */
export function attachLoginEvents() {
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
          
          // Charger la liste des utilisateurs bloqués
          await loadBlockedUsers();
          
          // Enregistrer le handler pour les messages de chat
          Presence.on('chat.message', (data: any) => {
            handleChatMessage(data, isUserBlocked, updateChatDisplay);
          });
          
          // Enregistrer le handler pour les messages directs (DM)
          Presence.on('dm.message', (data: any) => {
            console.log('[Login] DM message received:', data);
            if (data.data) {
              Chat.DM.handleIncomingDm(data.data);
            }
          });
          
          // Enregistrer le handler pour les invitations de jeu
          Presence.on('game.invitation', (message: any) => {
            console.log('[Login] 🎮🎮🎮 Game invitation received, full message:', message);
            console.log('[Login] 🎮 message.data:', message.data);
            if (message.data) {
              Chat.DM.handleGameInvitation(message.data);
            } else {
              console.error('[Login] 🎮 ❌ No data in game invitation message!');
            }
          });
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
}

/**
 * Fonction principale de rendu de la page de connexion
 */
export function renderLoginPage() {
  const root = document.getElementById("app");
  if (!root) return;

  root.innerHTML = getLoginHTML();
  attachLoginEvents();
}
