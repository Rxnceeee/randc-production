import {
  getOrCreateConversationModel,
  getConversationMessagesModel,
  getActiveConversationsModel,
  markMessagesAsReadModel,
  saveMessageModel,
  unsendMessageModel,
  getTotalUnreadCountModel,
} from '../model/chatModel.js';
import { getIO } from '../config/socket.js';

export async function getOrCreateConversationController(req, res) {
  try {
    const clientId = req.user.id;
    const conversation = await getOrCreateConversationModel(clientId);
    res.status(200).json(conversation);
  } catch (error) {
    console.error('Error getting conversation:', error);
    res.status(500).json({ message: 'Failed to get conversation' });
  }
}

export async function adminCreateConversationController(req, res) {
  try {
    const clientId = parseInt(req.params.userId, 10);
    if (!clientId) return res.status(400).json({ message: 'Invalid client ID.' });

    const conversation = await getOrCreateConversationModel(clientId);

    return res.status(200).json({ conversation_id: conversation.conversation_id });
  } catch (err) {
    console.error('adminCreateConversationController error:', err);
    return res.status(500).json({ message: 'Failed to create conversation.' });
  }
}

export async function getConversationMessagesController(req, res) {
  try {
    const { conversationId } = req.params;
    const userId   = req.user.id;
    const userRole = req.user.role;

    const messages = await getConversationMessagesModel(conversationId, userId, userRole);

    if (!messages) {
      return res.status(404).json({ message: 'Conversation not found or access denied' });
    }

    res.status(200).json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Failed to fetch messages' });
  }
}

export async function getActiveConversationsController(req, res) {
  try {
    const conversations = await getActiveConversationsModel();
    res.status(200).json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ message: 'Failed to fetch conversations' });
  }
}

export async function markMessagesReadController(req, res) {
  try {
    const { conversationId } = req.body;
    const userId = req.user.id;

    await markMessagesAsReadModel(conversationId, userId);
    res.status(200).json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Error marking messages:', error);
    res.status(500).json({ message: 'Failed to mark messages as read' });
  }
}

export async function uploadChatFileController(req, res) {
  try {
    const { conversationId, senderName, senderRole } = req.body;
    const io       = getIO();
    const senderId = req.user.id;

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const fileData = {
      path:     req.file.path,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      size:     req.file.size,
    };

    const messageId = await saveMessageModel(
      conversationId,
      senderId,
      `📎 ${req.file.originalname}`,
      fileData
    );

    const nameParts = (senderName || '').split(' ');
    const messageData = {
      message_id:      messageId,
      conversation_id: conversationId,
      sender_id:       senderId,
      message_text:    `📎 ${req.file.originalname}`,
      first_name:      nameParts[0] || '',
      last_name:       nameParts[1] || '',
      role:            senderRole,
      created_at:      new Date().toISOString(),
      file_path:       req.file.path,
      file_name:       req.file.originalname,
      file_type:       req.file.mimetype,
      file_size:       req.file.size,
      is_read:         0,
    };

    io.to(`conversation_${conversationId}`).emit('new_message', messageData);

    res.status(200).json({ message: 'File uploaded successfully', data: messageData });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ message: 'Failed to upload file' });
  }
}

export async function unsendMessageController(req, res) {
  try {
    const { messageId } = req.params;
    const userId = req.user.id;
    const io     = getIO();

    const result = await unsendMessageModel(messageId, userId);
    if (!result) return res.status(403).json({ message: 'Cannot unsend this message' });

    io.to(`conversation_${result.conversation_id}`).emit('message_unsent', {
      message_id:      parseInt(messageId),
      conversation_id: result.conversation_id,
    });

    res.status(200).json({ message: 'Message unsent' });
  } catch (error) {
    console.error('Unsend error:', error);
    res.status(500).json({ message: 'Failed to unsend message' });
  }
}

export async function getUnreadCountController(req, res) {
  try {
    const count = await getTotalUnreadCountModel();
    res.status(200).json({ unread: count });
  } catch (error) {
    console.error('Error getting unread count:', error);
    res.status(500).json({ message: 'Failed to get unread count' });
  }
}
