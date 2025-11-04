// API UTILISATEURS

/**
 * Récupère le profil d'un utilisateur
 */
export async function getUserProfile(userId: number): Promise<any> {
  const token = localStorage.getItem('token');
  if (!token) {
    console.log('Pas de token pour récupérer le profil');
    return null;
  }

  try {
    console.log(`Récupération du profil pour l'utilisateur ${userId}`);
    
    const response = await fetch(`/api/users/${userId}/profile`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    console.log(`Réponse API profil: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Erreur API profil: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log('Données profil reçues:', data);
    return data;
  } catch (error) {
    console.error('Erreur lors de la récupération du profil:', error);
    return null;
  }
}
