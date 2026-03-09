// config/socket.js
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import {
  saveMessageModel,
  markMessagesAsReadModel,
  hardDeleteMessageModel,
  editMessageModel,
} from '../model/chatModel.js';

let io;

// userId (string) → Set<socketId>
const activeUsers = new Map();

function _addSocket(userId, socketId) {
  if (!activeUsers.has(userId)) activeUsers.set(userId, new Set());
  activeUsers.get(userId).add(socketId);
}

function _removeSocket(userId, socketId) {
  const set = activeUsers.get(userId);
  if (!set) return true;
  set.delete(socketId);
  if (set.size === 0) { activeUsers.delete(userId); return true; }
  return false;
}

export function initializeSocketIO(server) {
  io = new Server(server, {
    cors: {
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        const allowed = (process.env.ALLOWED_ORIGINS || process.env.CLIENT_URL || '*')
          .split(',').map(o => o.trim());
        if (allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
        return cb(new Error(`Socket.IO CORS blocked: ${origin}`));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout:  60000,
    pingInterval: 25000,
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    try {
      const raw =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization ||
        socket.handshake.query?.token;

      if (!raw) return next(new Error('AUTH_REQUIRED'));

      const token   = raw.replace(/^Bearer\s+/i, '');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user   = decoded; // { id, role, first_name, last_name, … }
      next();
    } catch {
      next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    const uid  = socket.user.id.toString();
    const role = socket.user.role;

    socket.userId = uid;

    // ── Auto-join rooms immediately on connect ────────────────────────────
    socket.join(`user_${uid}`);
    if (['admin', 'staff'].includes(role)) socket.join('admins');

    // Track presence
    _addSocket(uid, socket.id);

    if (activeUsers.get(uid).size === 1) {
      io.emit('user_online', { userId: uid, role });
    }

    socket.emit('connected', { userId: uid, socketId: socket.id, role });
    console.log(`✅ [${role}] user ${uid} connected — socket ${socket.id} (${activeUsers.get(uid).size} total)`);

    socket.on('join_conversation', (conversationId) => {
      socket.join(`conversation_${conversationId}`);
      console.log(`💬 User ${uid} joined conversation_${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId) => {
      socket.leave(`conversation_${conversationId}`);
    });

    socket.on('send_message', async (data) => {
      try {
        const { conversationId, message, senderName, senderRole, fileData } = data;
        const senderId = socket.user.id; 
        if (!conversationId || !senderId) {
          return socket.emit('error', { message: 'Missing required fields' });
        }

        const messageId = await saveMessageModel(conversationId, senderId, message, fileData || null);

        const parts = (senderName || `${socket.user.first_name} ${socket.user.last_name}`).split(' ');
        const messageData = {
          message_id:      messageId,
          conversation_id: conversationId,
          sender_id:       senderId,
          message_text:    message,
          first_name:      parts[0] || '',
          last_name:       parts.slice(1).join(' ') || '',
          role:            senderRole || role,
          created_at:      new Date().toISOString(),
          file_path:       fileData?.path     || null,
          file_name:       fileData?.filename || null,
          file_type:       fileData?.mimetype || null,
          is_read:         0,
          is_edited:       0,
        };

        io.to(`conversation_${conversationId}`).emit('new_message', messageData);

        // Sidebar notification for admins when client sends
        if ((senderRole || role) === 'client') {
          io.to('admins').emit('new_client_message', {
            conversationId,
            clientName: parts[0] || socket.user.first_name,
            preview:    (message || '').substring(0, 60) + ((message?.length || 0) > 60 ? '…' : ''),
            timestamp:  new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('send_message error:', err);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ── EDIT MESSAGE ──────────────────────────────────────────────────────
    socket.on('edit_message', async ({ messageId, newText, conversationId }) => {
      try {
        if (!messageId || !newText) return socket.emit('error', { message: 'Missing edit fields' });

        const result = await editMessageModel(messageId, socket.user.id, newText);
        if (!result) return socket.emit('error', { message: 'Not authorized or message not found' });

        io.to(`conversation_${conversationId}`).emit('message_edited', {
          message_id:   messageId,
          message_text: newText,
          edited_at:    new Date().toISOString(),
          is_edited:    1,
        });
      } catch (err) {
        console.error('edit_message error:', err);
        socket.emit('error', { message: 'Failed to edit message' });
      }
    });

    // ── HARD DELETE / UNSEND ──────────────────────────────────────────────
    socket.on('delete_message', async ({ messageId, conversationId }) => {
      try {
        if (!messageId) return socket.emit('error', { message: 'Missing messageId' });

        const result = await hardDeleteMessageModel(messageId, socket.user.id);
        if (!result) return socket.emit('error', { message: 'Not authorized or message not found' });

        io.to(`conversation_${conversationId}`).emit('message_deleted', {
          message_id:      messageId,
          conversation_id: conversationId,
        });
      } catch (err) {
        console.error('delete_message error:', err);
        socket.emit('error', { message: 'Failed to delete message' });
      }
    });

    // ── MARK READ ─────────────────────────────────────────────────────────
    socket.on('mark_read', async ({ conversationId }) => {
      try {
        await markMessagesAsReadModel(conversationId, socket.user.id);
        io.to(`conversation_${conversationId}`).emit('messages_read', {
          conversationId,
          userId:    socket.user.id,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('mark_read error:', err);
      }
    });

    // ── TYPING ────────────────────────────────────────────────────────────
    socket.on('typing', ({ conversationId }) => {
      socket.to(`conversation_${conversationId}`).emit('user_typing', {
        userId:   uid,
        userName: socket.user.first_name || 'Someone',
      });
    });

    socket.on('stop_typing', ({ conversationId }) => {
      socket.to(`conversation_${conversationId}`).emit('user_stop_typing', { userId: uid });
    });

    // ── PRESENCE HEARTBEAT ────────────────────────────────────────────────
    socket.on('ping_presence', () => {
      socket.emit('pong_presence', { userId: uid, timestamp: Date.now() });
      // Re-broadcast online in case admin missed it during reconnect
      socket.broadcast.emit('user_online', { userId: uid, role });
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      const wentOffline = _removeSocket(uid, socket.id);

      if (wentOffline) {
        io.emit('user_offline', { userId: uid, role });
        console.log(`👋 [${role}] user ${uid} offline — reason: ${reason}`);
      } else {
        console.log(`🔌 Socket ${socket.id} disconnected, user ${uid} still has ${activeUsers.get(uid)?.size} socket(s)`);
      }
    });

    socket.on('error', (err) => console.error('Socket error:', err));
  });

  return io;
}

export function getIO() {
  if (!io) throw new Error('Socket.IO not initialized — call initializeSocketIO first');
  return io;
}

export function getActiveUsers()           { return activeUsers; }
export function isUserOnline(userId)       { const s = activeUsers.get(String(userId)); return s ? s.size > 0 : false; }
export function emitToUser(uid, ev, data)  { io?.to(`user_${uid}`).emit(ev, data); }
export function emitToAdmins(ev, data)     { io?.to('admins').emit(ev, data); }
export function emitToConversation(id, ev, data) { io?.to(`conversation_${id}`).emit(ev, data); }
export function broadcast(ev, data)        { io?.emit(ev, data); }