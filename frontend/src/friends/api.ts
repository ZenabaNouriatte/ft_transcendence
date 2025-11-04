// API AMIS

/**
 * Envoie une demande d'ami
 */
export async function sendFriendRequest(targetId: number): Promise<{success: boolean, status?: string, error?: string, message?: string}> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/request', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetId })
    });

    const data = await response.json();
    if (response.ok) {
      return { success: true, status: data.status };
    } else {
      return { success: false, error: data.error, message: data.message };
    }
  } catch (error) {
    return { success: false, error: 'network_error' };
  }
}

/**
 * Récupère le statut d'amitié avec un utilisateur
 */
export async function getFriendshipStatus(targetId: number): Promise<string> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch(`/api/friends/status/${targetId}`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.status;
    }
  } catch (error) {
    console.error('Error getting friendship status:', error);
  }
  return 'none';
}

/**
 * Récupère la liste des demandes d'amis reçues
 */
export async function getFriendRequests(): Promise<any[]> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/requests', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      return data.requests || [];
    }
  } catch (error) {
    console.error('Error getting friend requests:', error);
  }
  return [];
}

/**
 * Accepte une demande d'ami
 */
export async function acceptFriendRequest(requestId: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/accept', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requestId })
    });

    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * Décline une demande d'ami
 */
export async function declineFriendRequest(requestId: number): Promise<boolean> {
  try {
    const token = localStorage.getItem('token');
    const response = await fetch('/api/friends/decline', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ requestId })
    });

    return response.ok;
  } catch (error) {
    return false;
  }
}
