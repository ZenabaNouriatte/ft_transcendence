// backend/src/ws-dm-handler.ts
// Handler pour les messages directs WebSocket

export function sanitizeString(input: string, maxLength: number): string {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '').substring(0, maxLength);
}

export interface DMHandlerContext {
  senderId: number;
  token: string;
  safeSend: (msg: any) => void;
  sendDirectMessage: (userId: number, message: any) => boolean;
  app: any;
}

export async function handleDirectMessage(
  data: any,
  requestId: string | undefined,
  ctx: DMHandlerContext
): Promise<void> {
  const { senderId, token, safeSend, sendDirectMessage, app } = ctx;

  if (!data || typeof data !== "object") {
    safeSend({
      type: "error",
      data: { message: "invalid_message_data" },
      requestId
    });
    return;
  }

  try {
    const { receiverId, message } = data;

    if (!receiverId || typeof receiverId !== "number") {
      safeSend({
        type: "error",
        data: { message: "invalid_receiver_id" },
        requestId
      });
      return;
    }

    const messageContent = sanitizeString(message, 500);

    if (messageContent.length === 0) {
      safeSend({
        type: "error",
        data: { message: "empty_message" },
        requestId
      });
      return;
    }

    app.log.info({
      requestId,
      senderId,
      receiverId,
      messageLength: messageContent.length
    }, "Direct message received via WebSocket");

    // Save message to database via API
    const saveResponse = await fetch(`http://gateway:8000/api/messages/send`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        receiverId: receiverId,
        message: messageContent
      })
    });

    if (!saveResponse.ok) {
      throw new Error(`Failed to save message: ${saveResponse.status}`);
    }

    const result = await saveResponse.json();

    if (!result.success || !result.message) {
      throw new Error('Failed to save message');
    }

    const dmMessage = result.message;

    // Get sender info
    const userResponse = await fetch(`http://gateway:8000/api/users/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    let senderUsername = `User${senderId}`;
    let senderAvatar = null;

    if (userResponse.ok) {
      const userData = await userResponse.json();
      if (userData.user) {
        senderUsername = userData.user.username || senderUsername;
        senderAvatar = userData.user.avatar || null;
      }
    }

    // Send confirmation to sender
    safeSend({
      type: "dm.sent",
      data: {
        id: dmMessage.id,
        receiverId: receiverId,
        message: messageContent,
        timestamp: dmMessage.created_at
      },
      requestId
    });

    // Send message to receiver if they're connected
    const sent = sendDirectMessage(receiverId, {
      type: "dm.message",
      data: {
        id: dmMessage.id,
        senderId: senderId,
        senderUsername: senderUsername,
        senderAvatar: senderAvatar,
        message: messageContent,
        timestamp: dmMessage.created_at
      }
    });

    app.log.info({
      senderId,
      receiverId,
      sent,
      messageId: dmMessage.id
    }, "Direct message processed");

  } catch (fetchErr) {
    app.log.error({ fetchErr }, "Error saving direct message");
    safeSend({
      type: "error",
      data: { message: "failed_to_send_message" },
      requestId
    });
  }
}
