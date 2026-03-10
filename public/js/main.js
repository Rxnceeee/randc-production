// main.js

'use strict';

let socket;
let currentConversationId = null;
let currentUserId         = null;
let currentUserName       = '';
let currentUserRole       = '';
let typingTimeout         = null;
let activeConversationId  = null;
let _clientUnreadCount    = 0;
const _onlineUsers        = new Set(); 

// Chat badge (client side nav)
function _incrementClientChatBadge() {
  _clientUnreadCount++;
  const badge = document.getElementById('chatNavBadge');
  if (!badge) return;
  badge.textContent   = _clientUnreadCount > 9 ? '9+' : _clientUnreadCount;
  badge.style.display = 'inline-flex';
}

function _clearClientChatBadge() {
  _clientUnreadCount  = 0;
  const badge = document.getElementById('chatNavBadge');
  if (!badge) return;
  badge.textContent   = '';
  badge.style.display = 'none';
}

function _msgContainer() {
  return currentUserRole === 'client'
    ? document.getElementById('chatMessages')
    : document.getElementById('chatMessagesContainer-inner');
}

//  INITIALIZE MESSAGES 
async function initializeMessages() {
  const user  = JSON.parse(localStorage.getItem('user'));
  const token = localStorage.getItem('token');
  if (!user || !token) { window.location.href = BASE_URL; return; }

  currentUserId   = user.id;
  currentUserName = `${user.first_name} ${user.last_name}`;
  currentUserRole = user.role;

  if (currentUserRole === 'client') {
    await initializeClientChat();
  } else if (['admin', 'staff'].includes(currentUserRole)) {
    await initializeAdminChat();
  }
}

// edit / delete 
function registerMessageSocketEvents() {
  socket.on('message_edited', ({ message_id, message_text }) => {
    const bubble = document.querySelector(`[data-message-id="${message_id}"]`);
    if (!bubble) return;

    const textEl = bubble.querySelector('.message-text');
    if (textEl) textEl.textContent = message_text;

    let label = bubble.querySelector('.msg-edited-label');
    if (!label) {
      label           = document.createElement('span');
      label.className = 'msg-edited-label';
      const timeEl    = bubble.querySelector('.message-time');
      timeEl ? bubble.insertBefore(label, timeEl) : bubble.appendChild(label);
    }
    label.textContent = 'edited';

    bubble.querySelector('.msg-edit-wrap')?.remove();
    if (textEl) textEl.style.display = '';
  });

  socket.on('message_deleted', ({ message_id }) => {
    const bubble = document.querySelector(`[data-message-id="${message_id}"]`);
    if (bubble) {
      bubble.style.animation = 'msgOut .2s ease forwards';
      setTimeout(() => bubble.remove(), 180);
    }
  });
}

// presence INDICATOR
function registerPresenceEvents() {
  socket.on('user_online', ({ userId, role }) => {
    _onlineUsers.add(String(userId));
    _applyPresence(String(userId), true, role);
  });

  socket.on('user_offline', ({ userId, role }) => {
    _onlineUsers.delete(String(userId));
    _applyPresence(String(userId), false, role);
  });

  // Re-confirm we are online after reconnect or tab regain focus
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && socket?.connected) {
      socket.emit('ping_presence');
    }
  });
}

function _applyPresence(userId, online, role) {
  document.querySelectorAll(`.conversation-item[data-client-id="${userId}"]`).forEach(item => {
    const dot = item.querySelector('.conv-online-dot');
    if (!dot) return;
    dot.classList.toggle('online',  online);
    dot.classList.toggle('offline', !online);
    dot.title = online ? 'Online' : 'Offline';
  });

  if (activeConversationId && currentUserRole !== 'client') {
    const convItem = document.querySelector(`.conversation-item[data-conv-id="${activeConversationId}"]`);
    if (convItem?.dataset.clientId === userId) {
      _updateAdminChatHeader(online);
    }
  }

 
  if (currentUserRole === 'client') {
    const isAdminRole = role === 'admin' || role === 'staff';
    if (isAdminRole) {
      const onlineDot = document.getElementById('onlineDot');
      const statusDot = document.getElementById('connectionStatus');
      const statusTxt = document.getElementById('statusText');

     
      if (onlineDot) {
        onlineDot.classList.toggle('online',  online);
        onlineDot.classList.toggle('offline', !online);
      }
      if (statusDot && statusTxt) {
        if (statusDot.dataset.type !== 'socket') {
          statusDot.className = `status-dot ${online ? 'online' : 'offline'}`;
          statusTxt.textContent = online ? 'Support is online' : 'Support is offline';
        }
      }
    }
  }
}

function _updateAdminChatHeader(online) {
  const dot = document.getElementById('connectionStatus');
  const txt = document.getElementById('statusText');
  if (dot) dot.className = `status-dot status-indicator ${online ? 'online' : 'offline'}`;
  if (txt) txt.textContent = online ? 'Online' : 'Offline';
}

// CLIENT CHAT
async function initializeClientChat() {
  const token = localStorage.getItem('token');
  socket = io(BASE_URL, {
    auth:              { token },
     transports:        ['websocket'],
    reconnection:      true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 10,
  });

  socket.on('connect', () => {
    console.log('Client connected');
    updateConnectionStatus(true);

    loadClientConversation();
  });

  socket.on('reconnect', () => {
    console.log('Client reconnected');
    updateConnectionStatus(true);
    socket.emit('ping_presence');
    if (currentConversationId) socket.emit('join_conversation', currentConversationId);
    loadClientConversation();
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    updateConnectionStatus(false);
  });

  registerMessageSocketEvents();
  registerPresenceEvents(); 

  socket.on('new_message', (message) => {
    appendMessage(message);
    scrollToBottom();
    if (Number(message.sender_id) !== Number(currentUserId)) {
      markMessageAsRead();

      const chatPanel = document.getElementById('adminChatPanel');
      if (!chatPanel?.classList.contains('active')) _incrementClientChatBadge();
    }
  });

  socket.on('user_typing',      () => showTypingIndicator());
  socket.on('user_stop_typing', () => hideTypingIndicator());
  socket.on('error', ({ message }) => showNotification(message, 'error'));
}

async function loadClientConversation() {
  try {
    const res  = await fetch(`${BASE_URL}/api/chat/getOrCreateConversation`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    const data = await res.json();
    currentConversationId = data.conversation_id;
    socket.emit('join_conversation', currentConversationId);
    await loadMessages();
  } catch (err) {
    console.error('Error loading conversation:', err);
  }
}

// ADMIN CHAT
async function initializeAdminChat() {
  const token = localStorage.getItem('token');
  socket = io(BASE_URL, {
    auth:              { token },
     transports:        ['websocket'],
    reconnection:      true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 10,
  });

  socket.on('connect', () => {
    console.log('Admin connected');
    loadActiveConversations();
  });

  socket.on('reconnect', () => {
    console.log('🔄 Admin reconnected');
    socket.emit('ping_presence');
    if (activeConversationId) socket.emit('join_conversation', activeConversationId);
    loadActiveConversations();
  });

  socket.on('disconnect', () => console.log('❌ Admin disconnected'));

  registerMessageSocketEvents();
  registerPresenceEvents(); // ← was missing in original

  socket.on('new_client_message', ({ clientName }) => {
    loadActiveConversations();
    showNotification(`New message from ${clientName}`, 'info');
  });

  socket.on('new_message', (message) => {
    // FIX: must compare as Numbers — mixed types caused messages to silently not render
    if (Number(message.conversation_id) === Number(activeConversationId)) {
      appendMessage(message);
      scrollToBottom();
      if (Number(message.sender_id) !== Number(currentUserId)) markMessageAsRead();
    }
    // Always refresh sidebar counts
    loadActiveConversations();
  });

  socket.on('user_typing',      () => { if (activeConversationId) showTypingIndicator(); });
  socket.on('user_stop_typing', () => hideTypingIndicator());
}

// CONVERSATIONS LIST
async function loadActiveConversations() {
  try {
    const res   = await fetch(`${BASE_URL}/api/chat/getActiveConversations`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    const convs = await res.json();
    displayConversations(convs);
  } catch (err) {
    console.error('Error loading conversations:', err);
  }
}

function displayConversations(conversations) {
  const container = document.getElementById('conversationsList');
  if (!container) return;

  if (!conversations || conversations.length === 0) {
    container.innerHTML = `
      <div class="chat-empty-state" style="height:200px;">
        <i class="bi bi-inbox"></i>
        <p>No active conversations</p>
      </div>`;
    return;
  }

  container.innerHTML = conversations.map(conv => {
    const online   = _onlineUsers.has(String(conv.client_id));
    // FIX: compare as Numbers
    const isActive = Number(conv.conversation_id) === Number(activeConversationId);

    return `
      <div class="conversation-item ${isActive ? 'active' : ''}"
           data-conv-id="${conv.conversation_id}"
           data-client-id="${conv.client_id}"
           onclick="selectConversation(${conv.conversation_id})">

        <div class="conv-item-left">
          <div class="conv-avatar">
            <i class="bi bi-person-circle"></i>
            <span class="conv-online-dot ${online ? 'online' : 'offline'}"
                  title="${online ? 'Online' : 'Offline'}"></span>
          </div>
        </div>

        <div class="conv-item-body">
          <div class="conv-item-top">
            <span class="conversation-client-name">${conv.first_name} ${conv.last_name}</span>
            <span class="conversation-time">${conv.last_message_at ? formatTime(conv.last_message_at) : 'New'}</span>
          </div>
          <div class="conv-item-bottom">
            <span class="conversation-client-email">${conv.email}</span>
            ${conv.unread_count > 0 ? `<span class="unread-badge">${conv.unread_count}</span>` : ''}
          </div>
        </div>

      </div>`;
  }).join('');
}

// SELECT CONVERSATION (admin) 
async function selectConversation(conversationId) {
  activeConversationId  = conversationId;
  currentConversationId = conversationId;

  if (socket) socket.emit('join_conversation', conversationId);

  const convItem   = document.querySelector(`.conversation-item[data-conv-id="${conversationId}"]`);
  const clientId   = convItem?.dataset.clientId || null;
  const clientName = convItem?.querySelector('.conversation-client-name')?.textContent?.trim()
                     || 'Client';
  const isOnline   = clientId ? _onlineUsers.has(String(clientId)) : false;

  // Update header 
  const titleEl = document.querySelector('.chat-head-title');
  if (titleEl) titleEl.textContent = clientName;
  _updateAdminChatHeader(isOnline);

  // Highlight sidebar
  document.querySelectorAll('.conversation-item').forEach(el => el.classList.remove('active'));
  if (convItem) convItem.classList.add('active');

  // Clear only the messages area
  const msgInner = document.getElementById('chatMessagesContainer-inner');
  if (msgInner) msgInner.innerHTML = '';

  await loadMessages();
  loadActiveConversations();
}

// MESSAGES 
async function loadMessages() {
  if (!currentConversationId) return;
  try {
    const res = await fetch(`${BASE_URL}/api/chat/getMessages/${currentConversationId}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    if (!res.ok) throw new Error('Failed to load messages');
    const messages = await res.json();
    displayMessages(messages);
    markMessageAsRead();
  } catch (err) {
    console.error('Error loading messages:', err);
  }
}

function displayMessages(messages) {
  const container = _msgContainer();
  if (!container) { console.error('Messages container not found'); return; }

  container.innerHTML = '';

  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div class="no-messages" style="text-align:center;color:#888;padding:20px;">
        No messages yet. Start the conversation!
      </div>`;
    return;
  }

  messages.forEach(msg => appendMessage(msg));
  scrollToBottom();
}

function appendMessage(msg) {
  const container = _msgContainer();
  if (!container) return;

  const isOwn = Number(msg.sender_id) === Number(currentUserId);

  let content = '';
  if (msg.file_path) {
    const isImage = (msg.file_type || '').startsWith('image/');
    content = isImage
      ? `<div class="message-file">
           <img src="/${msg.file_path}" alt="${msg.file_name || ''}" class="message-image"
                onclick="window.open('/${msg.file_path}','_blank')">
           <small>${msg.file_name || ''}</small>
         </div>`
      : `<div class="message-file">
           <a href="/${msg.file_path}" target="_blank" class="file-link">
             <i class="bi bi-file-earmark"></i><span>${msg.file_name || 'File'}</span>
           </a>
         </div>`;
  } else {
    content = `<div class="message-text">${escapeHtml(msg.message_text || '')}</div>`;
  }

  const canEdit   = isOwn && !msg.file_path;
  const canDelete = isOwn && currentUserRole === 'admin';

  const trigger = canDelete
    ? `<button class="msg-menu-trigger" onclick="toggleMsgMenu(event,this)"
               title="Message options" aria-label="Message options">
         <i class="bi bi-three-dots-vertical"></i>
       </button>`
    : '';

  const div = document.createElement('div');
  div.className         = `chat-message ${isOwn ? 'own-message' : 'other-message'}`;
  div.dataset.messageId = msg.message_id;
  div.dataset.canEdit   = canEdit;
  div.dataset.canDelete = canDelete;

  div.innerHTML = `
    ${!isOwn ? `<div class="message-sender">${msg.first_name || ''} ${msg.last_name || ''}</div>` : ''}
    ${trigger}
    ${content}
    ${msg.is_edited ? `<span class="msg-edited-label">edited</span>` : ''}
    <div class="message-time">${formatTime(msg.created_at)}</div>
  `;

  container.appendChild(div);
}

// MESSAGE ACTIONS 
function deleteMessage(messageId) {
  socket.emit('delete_message', {
    messageId:      Number(messageId),
    conversationId: currentConversationId || activeConversationId,
  });
  const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
  if (bubble) {
    bubble.style.animation = 'msgOut .2s ease forwards';
    setTimeout(() => bubble.remove(), 180);
  }
}

function startEditMessage(messageId) {
  const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) return;
  const textEl = bubble.querySelector('.message-text');
  if (textEl) textEl.style.display = 'none';

  const wrap       = document.createElement('div');
  wrap.className   = 'msg-edit-wrap';
  wrap.innerHTML   = `
    <textarea class="msg-edit-textarea" rows="2">${textEl?.textContent || ''}</textarea>
    <div class="msg-edit-actions">
      <button class="msg-edit-btn cancel" onclick="cancelEditMessage(${messageId})">Cancel</button>
      <button class="msg-edit-btn save"   onclick="submitEditMessage(${messageId})">Save</button>
    </div>`;

  const timeEl = bubble.querySelector('.message-time');
  timeEl ? bubble.insertBefore(wrap, timeEl) : bubble.appendChild(wrap);

  const ta = wrap.querySelector('textarea');
  ta.focus();
  ta.selectionStart = ta.selectionEnd = ta.value.length;
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEditMessage(messageId); }
    if (e.key === 'Escape') cancelEditMessage(messageId);
  });
}

function cancelEditMessage(messageId) {
  const bubble = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) return;
  const textEl = bubble.querySelector('.message-text');
  if (textEl) textEl.style.display = '';
  bubble.querySelector('.msg-edit-wrap')?.remove();
}

function submitEditMessage(messageId) {
  const bubble  = document.querySelector(`[data-message-id="${messageId}"]`);
  if (!bubble) return;
  const newText = bubble.querySelector('.msg-edit-textarea')?.value.trim();
  if (!newText) return;

  socket.emit('edit_message', {
    messageId:      Number(messageId),
    newText,
    conversationId: currentConversationId || activeConversationId,
  });

  const textEl = bubble.querySelector('.message-text');
  if (textEl) { textEl.textContent = newText; textEl.style.display = ''; }
  bubble.querySelector('.msg-edit-wrap')?.remove();

  if (!bubble.querySelector('.msg-edited-label')) {
    const label       = document.createElement('span');
    label.className   = 'msg-edited-label';
    label.textContent = 'edited';
    const timeEl = bubble.querySelector('.message-time');
    timeEl ? bubble.insertBefore(label, timeEl) : bubble.appendChild(label);
  }
}

function toggleMsgMenu(event, btn) {
  event.stopPropagation();
  document.querySelectorAll('.msg-menu-dropdown').forEach(d => d.remove());

  const bubble    = btn.closest('.chat-message');
  const msgId     = bubble.dataset.messageId;
  const canEdit   = bubble.dataset.canEdit   === 'true';
  const canDelete = bubble.dataset.canDelete === 'true';

  const dropdown    = document.createElement('div');
  dropdown.className = 'msg-menu-dropdown';

  if (canEdit) {
    const b = document.createElement('button');
    b.className = 'msg-menu-item';
    b.innerHTML = `<i class="bi bi-pencil"></i> Edit`;
    b.onclick   = (e) => { e.stopPropagation(); dropdown.remove(); startEditMessage(msgId); };
    dropdown.appendChild(b);
  }
  if (canDelete) {
    const b = document.createElement('button');
    b.className = 'msg-menu-item danger';
    b.innerHTML = `<i class="bi bi-trash3"></i> Delete`;
    b.onclick   = (e) => { e.stopPropagation(); dropdown.remove(); deleteMessage(msgId); };
    dropdown.appendChild(b);
  }

  btn.after(dropdown);
}

// SEND
function sendMessage() {
  const input   = document.getElementById('messageInput');
  if (!input) return;
  const message = input.value.trim();
  if (!message || !currentConversationId) return;

  socket.emit('send_message', {
    conversationId: currentConversationId,
    message,
    senderName:     currentUserName,
    senderRole:     currentUserRole,
  });

  input.value        = '';
  input.style.height = 'auto';
  stopTyping();
}

// FILE UPLOAD
const ALLOWED_FILE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!ALLOWED_FILE_TYPES.has(file.type)) {
    const isMedia = file.type.startsWith('video/') || file.type.startsWith('audio/');
    showNotification(
      isMedia
        ? `${file.type.startsWith('video/') ? 'Video' : 'Audio'} files are not supported. Allowed: images and documents.`
        : `Unsupported type (${file.type || 'unknown'}). Allowed: JPEG, PNG, GIF, PDF, DOC, DOCX, TXT.`,
      'error'
    );
    event.target.value = '';
    return;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    showNotification(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`, 'error');
    event.target.value = '';
    return;
  }

  const fd = new FormData();
  fd.append('file',           file);
  fd.append('conversationId', currentConversationId);
  fd.append('senderId',       currentUserId);
  fd.append('senderName',     currentUserName);
  fd.append('senderRole',     currentUserRole);

  try {
    showNotification('Uploading…', 'info');
    const res  = await fetch(`${BASE_URL}/api/chat/upload`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body:    fd,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || 'Upload failed');
    showNotification('File sent.', 'success');
  } catch (err) {
    showNotification(err.message || 'Failed to upload file.', 'error');
  }

  event.target.value = '';
}

// POGI TYPINGS
function handleTyping() {
  const input = document.getElementById('messageInput');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = input.scrollHeight + 'px';

  if (!typingTimeout && socket) {
    socket.emit('typing', { conversationId: currentConversationId });
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 1000);
}

function stopTyping() {
  if (socket) socket.emit('stop_typing', { conversationId: currentConversationId });
  typingTimeout = null;
}

function handleKeyPress(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

// MARK READ
async function markMessageAsRead() {
  if (!currentConversationId) return;
  try {
    await fetch(`${BASE_URL}/api/chat/markRead`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ conversationId: currentConversationId }),
    });
    if (currentUserRole === 'client') _clearClientChatBadge();
  } catch (err) {
    console.error('markRead error:', err);
  }
}

// UI HELPERS
function updateConnectionStatus(connected) {
  const dot = document.getElementById('connectionStatus');
  const txt = document.getElementById('statusText');

  if (dot) { dot.className = `status-dot status-indicator ${connected ? 'online' : 'offline'}`; dot.dataset.type = 'socket'; }
  if (txt && currentUserRole === 'client') txt.textContent = connected ? 'Connected' : 'Connecting…';
}

function showTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) { el.style.display = 'flex'; scrollToBottom(); }
}

function hideTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.style.display = 'none';
}

function scrollToBottom() {
  const container = _msgContainer();
  if (container) container.scrollTop = container.scrollHeight;
}

function formatTime(timestamp) {
  const date      = new Date(timestamp);
  const now       = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString())       return timeStr;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${timeStr}`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + timeStr;
}

function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
  if (seconds < 60)     return 'Just now';
  if (seconds < 3600)   return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400)  return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
  return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function showNotification(message, type = 'info') {
  if (typeof showNotificationMessage === 'function') return showNotificationMessage(message, type);
  if (typeof showServerMessage       === 'function') return showServerMessage(message, type);
  console.log(`[${type.toUpperCase()}] ${message}`);
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.msg-menu-trigger') && !e.target.closest('.msg-menu-dropdown')) {
    document.querySelectorAll('.msg-menu-dropdown').forEach(d => d.remove());
  }
});

document.addEventListener('DOMContentLoaded', initializeMessages);

// ── Admin Dashboard ──────────────────────────────────────────────────────────

const _charts = {
  appointments:  null,
  transactions:  null,
};

async function initializeDashboard() {
    try {
        showLoadingState();

        const res = await fetch(`${BASE_URL}/api/admin/getDashboardStats`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        });

        if (!res.ok) throw new Error('Failed to fetch dashboard stats');

        const data = await res.json();
        displayDashboardStats(data.stats);
        displayRecentActivities(data.recentActivities);
        initializeCharts(data.stats);
        hideLoadingState();
    } catch (error) {
        console.error('Error loading dashboard:', error);
        showMessage('Failed to load dashboard data', 'error');
        hideLoadingState();
    }
}

function displayDashboardStats(stats) {
    document.getElementById('currentDate').textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    document.getElementById('todayAppointments').textContent   = stats.todayAppointments || 0;
    document.getElementById('pendingAppointments').textContent = stats.appointmentStats.pending || 0;

    const activeTransactions = (stats.transactionStats.submitted || 0) +
                               (stats.transactionStats.ongoing   || 0) +
                               (stats.transactionStats.done      || 0) +
                               (stats.transactionStats.to_claim  || 0);
    document.getElementById('activeTransactions').textContent = activeTransactions;
    document.getElementById('unreadMessages').textContent     = stats.unreadMessages || 0;

    const clientStats = stats.userStats.find(u => u.role === 'client');
    document.getElementById('totalClients').textContent    = clientStats ? clientStats.count : 0;
    document.getElementById('activeServices').textContent  = stats.serviceStats.active_services || 0;

    document.getElementById('avgProcessingTime').textContent = Math.round(stats.processingStats.avg_processing_days || 0);
    document.getElementById('minProcessingTime').textContent = stats.processingStats.min_processing_days || 0;
    document.getElementById('maxProcessingTime').textContent = stats.processingStats.max_processing_days || 0;

    displayTopServices(stats.topServices);
}

function displayRecentActivities(activities) {
    const container = document.getElementById('recentActivities');

    if (!activities || activities.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">No recent activities</p>';
        return;
    }

    container.innerHTML = activities.map(activity => {
        const icon  = activity.type === 'appointment' ? 'calendar-check' : 'file-earmark-text';
        const color = activity.type === 'appointment' ? 'primary' : 'info';
        return `
            <div class="activity-item">
                <div class="activity-icon bg-${color}">
                    <i class="bi bi-${icon}"></i>
                </div>
                <div class="activity-details">
                    <p class="activity-title">
                        ${activity.user_name} 
                        ${activity.type === 'appointment' ? 'booked an appointment' : 'started a transaction'}
                    </p>
                    <small class="text-muted">
                        ${formatTimeAgo(activity.created_at)} • 
                        <span class="status-badge status-${activity.status.toLowerCase().replace(' ', '_')}">
                            ${activity.status}
                        </span>
                    </small>
                </div>
            </div>
        `;
    }).join('');
}

function displayTopServices(services) {
    const container = document.getElementById('topServices');

    if (!services || services.length === 0) {
        container.innerHTML = '<p class="text-muted text-center">No service data available</p>';
        return;
    }

    const maxCount = Math.max(...services.map(s => s.transaction_count));
    container.innerHTML = services.map((service, index) => {
        const percentage = (service.transaction_count / maxCount) * 100;
        return `
            <div class="service-item">
                <div class="service-info">
                    <span class="service-rank">#${index + 1}</span>
                    <span class="service-name">${service.service_name}</span>
                    <span class="service-count">${service.transaction_count}</span>
                </div>
                <div class="service-progress">
                    <div class="service-progress-bar" style="width: ${percentage}%"></div>
                </div>
            </div>
        `;
    }).join('');
}

function initializeCharts(stats) {
    const appointmentsCtx = document.getElementById('appointmentsChart');
    if (appointmentsCtx) {
        if (_charts.appointments) {
            _charts.appointments.destroy();
            _charts.appointments = null;
        }

        _charts.appointments = new Chart(appointmentsCtx, {
            type: 'doughnut',
            data: {
                labels: ['Pending', 'Approved', 'Completed', 'Cancelled'],
                datasets: [{
                    data: [
                        stats.appointmentStats.pending   || 0,
                        stats.appointmentStats.approved  || 0,
                        stats.appointmentStats.completed || 0,
                        stats.appointmentStats.cancelled || 0
                    ],
                    backgroundColor: ['#fbbf24', '#3b82f6', '#10b981', '#ef4444'],
                    borderWidth: 2,
                    borderColor: '#1e293b'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#f1f5f9', padding: 15 }
                    }
                }
            }
        });
    }

    const transactionsCtx = document.getElementById('transactionsChart');
    if (transactionsCtx) {
        if (_charts.transactions) {
            _charts.transactions.destroy();
            _charts.transactions = null;
        }

        _charts.transactions = new Chart(transactionsCtx, {
            type: 'bar',
            data: {
                labels: Object.keys(stats.transactionStats),
                datasets: [{
                    label: 'Transactions',
                    data: Object.values(stats.transactionStats),
                    backgroundColor: '#667eea',
                    borderColor: '#764ba2',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#94a3b8', stepSize: 1 },
                        grid:  { color: '#334155' }
                    },
                    x: {
                        ticks: { color: '#94a3b8' },
                        grid:  { color: '#334155' }
                    }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}

function formatTimeAgo(timestamp) {
    const now     = new Date();
    const date    = new Date(timestamp);
    const seconds = Math.floor((now - date) / 1000);

    if (seconds < 60)     return 'Just now';
    if (seconds < 3600)   return Math.floor(seconds / 60)   + ' minutes ago';
    if (seconds < 86400)  return Math.floor(seconds / 3600) + ' hours ago';
    if (seconds < 604800) return Math.floor(seconds / 86400)+ ' days ago';

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function showLoadingState() { console.log('Loading dashboard...'); }
function hideLoadingState()  { console.log('Dashboard loaded'); }
function showMessage(message, type) { console.log(`${type}: ${message}`); }

document.addEventListener('DOMContentLoaded', () => {
    if (typeof Chart === 'undefined') {
        const script    = document.createElement('script');
        script.src      = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
        script.onload   = () => initializeDashboard();
        document.head.appendChild(script);
    } else {
        initializeDashboard();
    }

    initializeMessages();
});

document.addEventListener('click', function(e) {
    if (!e.target.closest('.msg-menu-trigger') && !e.target.closest('.msg-menu-dropdown')) {
        document.querySelectorAll('.msg-menu-dropdown').forEach(d => d.remove());
    }
});
