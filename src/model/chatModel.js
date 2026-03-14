import { db } from '../config/db.js';
import fs from 'fs';
import path from 'path';

// GET OR CREATE CONVERSATION
export async function getOrCreateConversationModel(clientId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute(
      `SELECT conversation_id, admin_id FROM chat_conversations
       WHERE client_id = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [clientId]
    );

    if (existing.length > 0) {
      await connection.commit();
      return existing[0];
    }

    const [result] = await connection.execute(
      `INSERT INTO chat_conversations (client_id) VALUES (?)`,
      [clientId]
    );

    await connection.commit();
    return { conversation_id: result.insertId, admin_id: null };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// GET CONVERSATION MESSAGES
// Only returns non-deleted messages
export async function getConversationMessagesModel(conversationId, userId, userRole) {
  try {
    let accessQuery;
    if (userRole === 'client') {
      accessQuery = `SELECT conversation_id FROM chat_conversations WHERE conversation_id = ? AND client_id = ?`;
    } else {
      accessQuery = `SELECT conversation_id FROM chat_conversations WHERE conversation_id = ?`;
    }

    const params = userRole === 'client' ? [conversationId, userId] : [conversationId];
    const [access] = await db.execute(accessQuery, params);
    if (access.length === 0) return null;

    const [messages] = await db.execute(
      `SELECT
        cm.message_id,
        cm.sender_id,
        cm.message_text,
        cm.file_path,
        cm.file_name,
        cm.file_type,
        cm.file_size,
        cm.is_read,
        cm.is_edited,
        cm.edited_at,
        cm.created_at,
        u.first_name,
        u.last_name,
        u.role
      FROM chat_messages cm
      INNER JOIN users u ON cm.sender_id = u.id
      WHERE cm.conversation_id = ?
        AND (cm.is_deleted = 0 OR cm.is_deleted IS NULL)
      ORDER BY cm.created_at ASC`,
      [conversationId]
    );

    return messages;
  } catch (error) {
    throw error;
  }
}

// SAVE MESSAGE
export async function saveMessageModel(conversationId, senderId, messageText, fileData = null) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.execute(
      `INSERT INTO chat_messages
       (conversation_id, sender_id, message_text, file_path, file_name, file_type, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        conversationId,
        senderId,
        messageText || null,
        fileData?.path || null,
        fileData?.filename || null,
        fileData?.mimetype || null,
        fileData?.size?.toString() || null
      ]
    );

    await connection.execute(
      `UPDATE chat_conversations SET last_message_at = CURRENT_TIMESTAMP WHERE conversation_id = ?`,
      [conversationId]
    );

    await connection.commit();
    return result.insertId;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// EDIT MESSAGE
// Only sender can edit; updates text, marks as edited
export async function editMessageModel(messageId, senderId, newText) {
  // Verify ownership
  const [rows] = await db.execute(
    `SELECT message_id, conversation_id FROM chat_messages
     WHERE message_id = ? AND sender_id = ? AND (is_deleted = 0 OR is_deleted IS NULL)`,
    [messageId, senderId]
  );
  if (!rows.length) return null;

  await db.execute(
    `UPDATE chat_messages
     SET message_text = ?, is_edited = 1, edited_at = NOW()
     WHERE message_id = ?`,
    [newText, messageId]
  );

  return { conversation_id: rows[0].conversation_id };
}

// Completely removes from DB and deletes file from storage
export async function hardDeleteMessageModel(messageId, senderId) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Verify sender owns the message (admin can delete any message)
    const [rows] = await connection.execute(
      `SELECT cm.message_id, cm.conversation_id, cm.file_path,
              u.role
       FROM chat_messages cm
       INNER JOIN users u ON u.id = ?
       WHERE cm.message_id = ?
         AND (cm.sender_id = ? OR u.role = 'admin')
         AND (cm.is_deleted = 0 OR cm.is_deleted IS NULL)`,
      [senderId, messageId, senderId]
    );

    if (!rows.length) {
      await connection.rollback();
      return null;
    }

    const { conversation_id, file_path } = rows[0];

    // Hard delete from database
    await connection.execute(
      `DELETE FROM chat_messages WHERE message_id = ?`,
      [messageId]
    );

    await connection.commit();

    // Delete file from storage if exists
    if (file_path) {
      try {
        const absolutePath = path.resolve(file_path);
        if (fs.existsSync(absolutePath)) {
          fs.unlinkSync(absolutePath);
        }
      } catch (fileErr) {
        console.error('File deletion warning:', fileErr.message);
        // Don't fail the operation if file is already gone
      }
    }

    return { conversation_id };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// MARK MESSAGES AS READ
export async function markMessagesAsReadModel(conversationId, userId) {
  try {
    await db.execute(
      `UPDATE chat_messages
       SET is_read = 1
       WHERE conversation_id = ? AND sender_id != ? AND is_read = 0
         AND (is_deleted = 0 OR is_deleted IS NULL)`,
      [conversationId, userId]
    );
  } catch (error) {
    throw error;
  }
}

// GET ALL ACTIVE CONVERSATIONS
export async function getActiveConversationsModel() {
  try {
    const [conversations] = await db.execute(
      `SELECT
        cc.conversation_id,
        cc.client_id,
        cc.admin_id,
        cc.last_message_at,
        cc.created_at,
        u.first_name,
        u.last_name,
        u.email,
        (SELECT COUNT(*) FROM chat_messages
         WHERE conversation_id = cc.conversation_id
           AND sender_id = cc.client_id
           AND is_read = 0
           AND (is_deleted = 0 OR is_deleted IS NULL)) as unread_count,
        (SELECT message_text FROM chat_messages
         WHERE conversation_id = cc.conversation_id
           AND (is_deleted = 0 OR is_deleted IS NULL)
         ORDER BY created_at DESC LIMIT 1) as last_message
      FROM chat_conversations cc
      INNER JOIN users u ON cc.client_id = u.id
      WHERE cc.status = 'active'
      ORDER BY cc.last_message_at DESC`
    );
    return conversations;
  } catch (error) {
    throw error;
  }
}

// GET TOTAL UNREAD COUNT
export async function getTotalUnreadCountModel() {
  const [rows] = await db.query(
    `SELECT COALESCE(COUNT(*), 0) AS total
     FROM chat_messages cm
     INNER JOIN chat_conversations cc ON cc.conversation_id = cm.conversation_id
     WHERE cm.is_read = 0
       AND cm.sender_id = cc.client_id
       AND (cm.is_deleted = 0 OR cm.is_deleted IS NULL)`
  );
  return rows[0]?.total || 0;
}

// Legacy alias kept for backward compatibility
export async function unsendMessageModel(messageId, senderId) {
  return hardDeleteMessageModel(messageId, senderId);
}