// PAGE D'INSCRIPTION

// Importe les fonctionnalités qui fonctionnent sur toutes les pages
import { Presence } from '../websocket.js';
import { handleChatMessage } from '../chat/state.js';
import { updateChatDisplay } from '../chat/ui.js';
import { isUserBlocked, loadBlockedUsers } from '../blocking/index.js';
import * as Chat from '../chat/index.js';

// Fonction pour générer le HTML de la page d'inscription
export function getSignUpHTML(): string {
  return `
  <div class="flex flex-col items-center justify-center min-h-screen">
    <h1 class="page-title-large page-title-brown">Sign Up</h1>
    <div class="form-box-auth">
      <form id="signUpForm" class="space-y-4">

      <!-- CHAMPS DE SAISIE DU USERNAME -->
        <div>
          <label for="username" class="auth-label">Username</label>
          <input type="text" id="username" name="username" required
            class="styled-input"
            placeholder="Enter your username">
        </div>
        
        <!-- CHAMPS DE SAISIE DE L'EMAIL -->
        <div>
          <label for="email" class="auth-label">Email</label>
          <input type="email" id="email" name="email" required
            class="styled-input"
            placeholder="Enter your email">
        </div>
        
        <!-- CHAMPS DE SAISIE DU PASSWORD -->
        <div>
          <label for="password" class="auth-label">Password</label>
          <input type="password" id="password" name="password" required
            class="styled-input"
            placeholder="Enter your password">
        </div>
        
        <!-- BOUTON DE SOUMISSION DU FORMULAIRE -->
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
  `;
}

// Fonction pour attacher les événements de la page d'inscription
export function attachSignUpEvents() {
  // Récupère le formulaire d'inscription
  const signUpForm = document.getElementById('signUpForm') as HTMLFormElement;
  
  // Gère la soumission du formulaire
  signUpForm?.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Récupère les données du formulaire
    const formData = new FormData(signUpForm);
    const username = formData.get('username') as string;
    const email = formData.get('email') as string;
    const password = formData.get('password') as string;
    
    // Validation basique des champs
    if (!username || !email || !password) {
      alert('All fields are required');
      return;
    }
    
    // Envoie les données au backend pour l'inscription
    try {
      const response = await fetch('/api/users/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password }),
      });
      
      // Traite la réponse du backend
      const data = await response.json();

      // Si l'inscription a réussi on connecte l'utilisateur et on stocke le token JWT
      if (response.ok) {
        if (data.token) {
          localStorage.setItem('token', data.token);
          Presence.connect(data.token);
          
          // Charger la liste des utilisateurs bloqués
          await loadBlockedUsers();
          
          // Enregistrer le handler pour les messages de chat global
          Presence.on('chat.message', (data: any) => {
            handleChatMessage(data, isUserBlocked, updateChatDisplay);
          });
          
          // Enregistrer le handler pour les DM
          Presence.on('dm.message', (data: any) => {
            console.log('[Signup] DM message received:', data);
            if (data.data) {
              Chat.DM.handleIncomingDm(data.data);
            }
          });
          
          // Enregistrer le handler pour les invitations de jeu
          Presence.on('game.invitation', (message: any) => {
            if (message.data) {
              Chat.DM.handleGameInvitation(message.data);
            } else {
              console.error('[Signup] No data in game invitation message!');
            }
          });
        }
        // Redirige vers le profil utilisateur après inscription
        localStorage.setItem('currentUsername', username);
        location.hash = '#/profile';
      } else {
        alert('Registration failed: ' + (data.error || 'Please try again'));
      }
    } catch (error) {
      alert('Network error. Please try again.');
    }
  });
  
  // Event du bouton pour revenir au menu principal
  document.getElementById("backToMenuSignup")?.addEventListener("click", () => {
    location.hash = '';
  });
}

export function renderSignUpPage() {
  const root = document.getElementById("app");
  if (!root) return;

  root.innerHTML = getSignUpHTML();
  attachSignUpEvents();
}
