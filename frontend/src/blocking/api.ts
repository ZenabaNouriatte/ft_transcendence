// API DE BLOCAGE D'UTILISATEURS

import { blockedUserIds, setBlockedUserIds } from './state.js';

/**
 * Charge la liste des utilisateurs bloqués depuis l'API
 */
export async function loadBlockedUsers(): Promise<void> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/blocked', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      setBlockedUserIds(data.blockedUsers || []);
      console.log('[BLOCK] Loaded blocked users:', blockedUserIds);
    }
  } catch (error) {
    console.error('Error loading blocked users:', error);
  }
}

/**
 * Bloque un utilisateur
 */
export async function blockUser(targetId: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/block', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetId })
    });

    if (response.ok) {
      setBlockedUserIds([...blockedUserIds, targetId]);
      console.log('[BLOCK] User blocked:', targetId);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error blocking user:', error);
    return false;
  }
}

/**
 * Débloque un utilisateur
 */
export async function unblockUser(targetId: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/unblock', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetId })
    });

    if (response.ok) {
      setBlockedUserIds(blockedUserIds.filter(id => id !== targetId));
      console.log('[BLOCK] User unblocked:', targetId);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error unblocking user:', error);
    return false;
  }
}

/**
 * Vérifie si un utilisateur est bloqué
 */
export function isUserBlocked(userId: number): boolean {
  return blockedUserIds.indexOf(userId) !== -1;
}
