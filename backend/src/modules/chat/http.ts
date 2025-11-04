// backend/src/modules/chat/http.ts
// Microservice de logique métier pour le chat - Validation et filtrage
import type { FastifyPluginAsync } from "fastify";

const chatHttp: FastifyPluginAsync = async (app) => {
  app.get("/ping", async () => ({ ok: true, service: "chat" }));

  // ========================================================================
  // 1. VALIDATION D'UN MESSAGE AVANT ENVOI
  // ========================================================================
  app.post("/validate-message", async (req, reply) => {
    try {
      const { message, senderId, receiverId } = req.body as {
        message: string;
        senderId: number;
        receiverId: number;
      };

      // Vérifier que les champs requis sont présents
      if (!message || !senderId || !receiverId) {
        return reply.code(400).send({ 
          error: "missing_fields",
          message: "message, senderId, and receiverId are required"
        });
      }

      // Vérifier que le message n'est pas vide après trim
      const trimmedMessage = String(message).trim();
      if (trimmedMessage.length === 0) {
        return reply.code(400).send({ 
          error: "empty_message",
          message: "Message cannot be empty"
        });
      }

      // Vérifier la longueur maximale (500 caractères)
      if (trimmedMessage.length > 500) {
        return reply.code(400).send({ 
          error: "message_too_long",
          message: "Message cannot exceed 500 characters",
          maxLength: 500,
          actualLength: trimmedMessage.length
        });
      }

      // Vérifier que sender != receiver
      if (senderId === receiverId) {
        return reply.code(400).send({ 
          error: "self_messaging",
          message: "Cannot send message to yourself"
        });
      }

      // Filtrage basique de contenu inapproprié (peut être étendu)
      const forbiddenPatterns = [
        /<script\b/i,  // XSS basique
        /javascript:/i, // XSS dans liens
        /on\w+\s*=/i,  // Event handlers (onclick=, etc.)
      ];

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(trimmedMessage)) {
          return reply.code(400).send({ 
            error: "forbidden_content",
            message: "Message contains forbidden content"
          });
        }
      }

      // Message valide
      return reply.send({
        valid: true,
        sanitizedMessage: trimmedMessage,
        length: trimmedMessage.length,
        timestamp: Date.now()
      });

    } catch (error) {
      app.log.error(error, "Message validation error");
      return reply.code(500).send({ error: "validation_failed" });
    }
  });

  // ========================================================================
  // 2. VÉRIFIER SI UN UTILISATEUR PEUT ENVOYER À UN AUTRE
  // ========================================================================
  app.post("/check-can-send", async (req, reply) => {
    try {
      const { senderId, receiverId, blockedByReceiver, blockedBySender } = req.body as {
        senderId: number;
        receiverId: number;
        blockedByReceiver: boolean;
        blockedBySender: boolean;
      };

      if (!senderId || !receiverId) {
        return reply.code(400).send({ error: "missing_user_ids" });
      }

      // Si le receiver a bloqué le sender
      if (blockedByReceiver) {
        return reply.send({
          canSend: false,
          reason: "blocked_by_receiver",
          message: "You have been blocked by this user"
        });
      }

      // Si le sender a bloqué le receiver
      if (blockedBySender) {
        return reply.send({
          canSend: false,
          reason: "you_blocked_user",
          message: "You've blocked this account. Unblock it and try again."
        });
      }

      // Tout est OK
      return reply.send({
        canSend: true,
        message: "Message can be sent"
      });

    } catch (error) {
      app.log.error(error, "Can-send check error");
      return reply.code(500).send({ error: "check_failed" });
    }
  });

  // ========================================================================
  // 3. VALIDATION DE PARAMÈTRES DE CONVERSATION
  // ========================================================================
  app.post("/validate-conversation-params", async (req, reply) => {
    try {
      const { userId, otherUserId } = req.body as {
        userId: number;
        otherUserId: number;
      };

      if (!userId || !otherUserId) {
        return reply.code(400).send({ error: "missing_user_ids" });
      }

      const userIdNum = Number(userId);
      const otherUserIdNum = Number(otherUserId);

      if (!Number.isInteger(userIdNum) || !Number.isInteger(otherUserIdNum)) {
        return reply.code(400).send({ error: "invalid_user_ids" });
      }

      if (userIdNum <= 0 || otherUserIdNum <= 0) {
        return reply.code(400).send({ error: "user_ids_must_be_positive" });
      }

      if (userIdNum === otherUserIdNum) {
        return reply.code(400).send({ error: "cannot_converse_with_self" });
      }

      return reply.send({
        valid: true,
        userId: userIdNum,
        otherUserId: otherUserIdNum
      });

    } catch (error) {
      app.log.error(error, "Conversation params validation error");
      return reply.code(500).send({ error: "validation_failed" });
    }
  });
};

export default chatHttp;
