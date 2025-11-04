// AUTHENTIFICATION ET GESTION DES TOKENS

import { Presence } from './websocket.js';
import { loadBlockedUsers } from './blocking/index.js';
import { clearChatMessages } from './chat/index.js';

/**
 * Synchronise l'authentification avec le backend
 * Vérifie si le token stocké est valide et met à jour le localStorage
 */
export async function syncAuthFromBackend(): Promise<void> {
  const t = localStorage.getItem('token');
  if (!t) {
    // pas loggé : nettoie juste le nom local
    localStorage.removeItem('currentUsername');
    return;
  }

  try {
    const r = await fetch('/api/users/me', {
      headers: { 'Authorization': 'Bearer ' + t }
    });

    if (!r.ok) {
      // token invalide → purge tout
      localStorage.removeItem('token');
      localStorage.removeItem('currentUsername');
      clearChatMessages();
      return;
    }

    const data = await r.json();
    const user = data && data.user ? data.user : null;

    if (user && user.username) {
      localStorage.setItem('currentUsername', user.username);
    } else {
      localStorage.removeItem('currentUsername');
    }
  } catch (_e) {
    // en cas d'erreur réseau, on ne casse pas l'app
  }
}

/**
 * Fonction pour récupérer l'ID utilisateur via API
 */
export async function getCurrentUserId(): Promise<number> {
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
    if (!user || !user.id) {
      throw new Error('Invalid user data');
    }
    
    return user.id;
  } catch (error) {
    console.error('Error fetching current user ID:', error);
    return 1; // Fallback sur invité
  }
}

/**
 * Initialise le système de présence depuis le localStorage
 * Connecte le WebSocket si un token existe
 */
export function bootPresenceFromStorage() {
  const t = localStorage.getItem('token');
  if (t) {
    Presence.connect(t);
    // Charger la liste des utilisateurs bloqués
    loadBlockedUsers();
  }
  // Fermer proprement la WS quand l'onglet se ferme (ne touche pas au token)
  window.addEventListener('beforeunload', () => {
    try { Presence.disconnect(); } catch {}
  });
}
