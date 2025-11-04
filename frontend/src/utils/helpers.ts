// FONCTIONS UTILITAIRES

/**
 * Échappe les caractères HTML pour éviter les injections XSS
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Retourne le chemin de l'avatar d'un utilisateur
 * Si l'utilisateur a uploadé un avatar personnalisé, l'utiliser
 * Sinon, utiliser l'image par défaut basée sur l'ID
 */
export function getUserAvatarPath(userId: number, userAvatar?: string | null): string {
  // Si l'utilisateur a uploadé un avatar personnalisé, l'utiliser
  if (userAvatar && userAvatar.startsWith('/uploads/')) {
    return userAvatar;
  }
  
  // Sinon, utiliser l'image par défaut basée sur l'ID
  // ID direct: user 1 → image 1.JPG, user 2 → image 2.JPG, etc.
  // Si l'ID dépasse 15, on boucle (modulo)
  const imageNumber = userId > 15 ? ((userId - 1) % 15) + 1 : userId;
  return `/images/${imageNumber}.JPG`;
}

/**
 * Formate un timestamp en format HH:MM
 */
export function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const hoursStr = hours < 10 ? `0${hours}` : `${hours}`;
  const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
  return `${hoursStr}:${minutesStr}`;
}
