// ÉTAT DU SYSTÈME DE BLOCAGE

/**
 * Liste des IDs utilisateurs bloqués par l'utilisateur actuel
 */
export let blockedUserIds: number[] = [];

/**
 * Met à jour la liste des utilisateurs bloqués
 */
export function setBlockedUserIds(ids: number[]) {
  blockedUserIds = ids;
}
