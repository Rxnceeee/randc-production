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
  const canDelete = isOwn ;

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

// Admin Dashboard// Chart.js instances
let _dbChartTrend   = null;
let _dbChartDemand  = null;
let _dbChartMonthly = null;

// ── LIVE CLOCK ────────────────────────────────────────────────────────────────
function dbStartClock() {
  function tick() {
    const now   = new Date();
    const timeEl = document.getElementById('dbLiveTime');
    const dateEl = document.getElementById('dbLiveDate');
    if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    if (dateEl) dateEl.textContent = now.toLocaleDateString('en-PH', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  }
  tick();
  setInterval(tick, 1000);
}

// ── AUTH HEADER ───────────────────────────────────────────────────────────────
function dbAuthHeader() {
  const token = localStorage.getItem('token') || sessionStorage.getItem('token') || '';
  return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── MAIN LOAD ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const storedUser = JSON.parse(
      localStorage.getItem('user') || sessionStorage.getItem('user') || '{}'
    );
    const adminName = storedUser.first_name || storedUser.username || 'Admin';
    const el = document.getElementById('dbAdminName');
    const av = document.getElementById('dbAdminAvatar');
    if (el) el.textContent = `Good ${dbGetGreeting()}, ${adminName}`;
    if (av) av.textContent = (adminName[0] || 'A').toUpperCase();

    // FIX 6: removed duplicate getDashboardStats fetch (was index 2 — same as index 0)
    // FIX: slot fetch now uses admin endpoint (todaySlots comes from getDashboardStats response)
    // FIX: removed "activities" fetch — recentActivities now included in getDashboardStats response
    const [statsRes, testimonialsRes, upcomingRes] = await Promise.allSettled([
      dbFetch('/api/admin/getDashboardStats'),
      dbFetchTestimonials(),
      dbFetchUpcomingAppointments(),
    ]);

    // FIX 1: data now directly has transactionStats, recentActivity, etc. (controller spreads stats)
    const data = statsRes.status === 'fulfilled' ? statsRes.value : null;

    if (data) {
      dbRenderKPIs(data);
      dbRenderPipeline(data);
      dbRenderCharts(data);
      dbRenderAlerts(data);
      dbRenderSlots(data.todaySlots || []);   // FIX 2: use todaySlots from response, not separate fetch
      dbRenderTopServices(data.topServices || []); // NEW: replaces Needs Attention panel
      // FIX 5: removed dbRenderActivityLog(data)   — section deleted
      // FIX 5: removed dbRenderAttentionItems(data) — section deleted
    }

    if (testimonialsRes.status === 'fulfilled') dbRenderTestimonials(testimonialsRes.value);
    if (upcomingRes.status   === 'fulfilled') dbRenderUpcoming(upcomingRes.value);

  } catch (err) {
    console.error('[Dashboard] Load error:', err);
  }
}

async function dbFetch(path) {
  const res = await fetch((typeof BASE_URL !== 'undefined' ? BASE_URL : '') + path, {
    headers: dbAuthHeader()
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

async function dbFetchTestimonials() {
  return dbFetch('/api/admin/testimonials');
}

async function dbFetchUpcomingAppointments() {
  return dbFetch('/api/admin/filterAppointments/approved');
}

// ── KPI CARDS ─────────────────────────────────────────────────────────────────
function dbRenderKPIs(data) {
  const tx    = data.transactionStats || {};
  const appt  = data.appointmentStats || {};
  const users = data.userStats        || [];
  const proc  = data.processingStats  || {};

  const clients = users.find(u => u.role === 'client');

  // FIX 1: these now resolve correctly because controller spreads stats
  const pending   = +(tx.pending  || 0);
  const ongoing   = +(tx.ongoing  || tx.on_going || 0);
  const toClaim   = +(tx.to_claim || 0);
  const claimed   = +(tx.claimed  || tx.completed || 0);
  const penalty   = +(tx.penalty_count || tx.penalty || 0);

  // KPI 1 — Today's Appointments
  dbSetEl('kpiTodayAppt', data.todayAppointments ?? '—');
  dbSetEl('kpiTodaySub',  `${appt.approved || 0} approved · ${appt.pending || 0} pending`);
  dbSetTrend('kpiTodayTrend', data.todayAppointments, 5, '↑ Active', '↓ Slow');

  // KPI 2 — FIX 7: was "Pending Transactions" — now "In Progress" (ongoing count)
  dbSetEl('kpiPendingTx',  ongoing);
  dbSetEl('kpiPendingSub', `${pending} submitted · queued`);

  // KPI 3 — Ready to Claim
  dbSetEl('kpiReadyClaim', toClaim);
  dbSetEl('kpiClaimSub',   toClaim > 10 ? '⚠ High backlog' : 'Normal volume');
  dbSetTrend('kpiClaimTrend', toClaim > 15 ? 1 : -1, 0, '↑ High', '↓ Normal');

  // KPI 4 — Active Clients
  const activeC = clients?.active_count ?? clients?.count ?? '—';
  dbSetEl('kpiActiveClients', activeC);
  dbSetEl('kpiClientsSub',    `${clients?.verified_count ?? 0} verified`);
  dbSetTrend('kpiClientsTrend', 1, 0, '↑ Growing', '↑ Growing');

  // KPI 5 — Slot Utilisation (now computed from todaySlots in response)
  const todaySlots = data.todaySlots || [];
  const slotFull   = todaySlots.filter(s => s.current_bookings >= s.max_capacity).length;
  const slotOpen   = todaySlots.filter(s => s.is_available && s.current_bookings < s.max_capacity).length;
  const totalSlot  = todaySlots.length || 1;
  const utilPct    = Math.round((slotFull / totalSlot) * 100);
  dbSetEl('kpiSlotUtil', utilPct + '%');
  dbSetEl('kpiSlotSub',  `${slotFull} full · ${slotOpen} open`);
  const fillEl = document.getElementById('kpiSlotFill');
  if (fillEl) fillEl.style.width = utilPct + '%';

  // KPI 6 — Avg Processing Days
  const avgDays = parseFloat(proc.avg_processing_days || 0).toFixed(1);
  dbSetEl('kpiAvgProc', avgDays + 'd');
  dbSetTrend('kpiProcTrend', parseFloat(avgDays) > 7 ? 1 : -1, 0, '↑ Slow', '↓ Fast');

  // KPI 7 — Penalty Transactions
  dbSetEl('kpiPenaltyCount', penalty);
  dbSetTrend('kpiPenaltyTrend', penalty > 0 ? 1 : -1, 0, '↑ Action Needed', '↓ Clear');

  // KPI 8 — Client Satisfaction (from testimonials — no direct field in stats model)
  // Rating is computed in dbRenderTestimonials; initialise with placeholder here
  const starsEl = document.getElementById('kpiStars');
  if (starsEl) starsEl.innerHTML = '';
}

// ── ALERTS ────────────────────────────────────────────────────────────────────
function dbRenderAlerts(data) {
  const tx   = data.transactionStats || {};
  const appt = data.appointmentStats || {};
  const alerts = [];

  const toClaim = +(tx.to_claim     || 0);
  const penalty = +(tx.penalty_count || tx.penalty || 0);
  const unread  = +(data.unreadMessages || 0);
  const today   = +(data.todayAppointments || 0);

  if (penalty > 0) alerts.push({
    type:'danger', icon:'bi-exclamation-triangle-fill',
    title:'Penalty Triggered',
    text:`${penalty} transaction(s) exceeded the 7-day claim window — ₱200 penalty applies.`,
    action:'View Transactions', panel:'panel-transactions'
  });
  if (toClaim > 20) alerts.push({
    type:'warning', icon:'bi-box-seam-fill',
    title:'High Unclaimed Volume',
    text:`${toClaim} documents are ready to claim. High backlog risks further penalties.`,
    action:'Manage', panel:'panel-transactions'
  });
  if (unread > 5) alerts.push({
    type:'info', icon:'bi-chat-dots-fill',
    title:'Unread Client Messages',
    text:`${unread} unread message(s) require a response.`,
    action:'Open Chat', panel:'panel-chat'
  });
  if (today === 0) alerts.push({
    type:'info', icon:'bi-calendar-x',
    title:'No Appointments Today',
    text:'No appointments scheduled for today. May be a holiday or low-demand day.',
    action:null
  });
  if ((appt.pending || 0) > 0) alerts.push({
    type:'warning', icon:'bi-clock-history',
    title:'Pending Appointment Requests',
    text:`${appt.pending} appointment request(s) awaiting review.`,
    action:'Review', panel:'panel-appointments'
  });

  const row = document.getElementById('dbAlertsRow');
  if (!row) return;
  if (!alerts.length) {
    row.innerHTML = `
      <div class="db-alert db-alert--success">
        <i class="bi bi-check-circle-fill"></i>
        <div class="db-alert-body"><strong>All Clear</strong>No critical issues detected. System operating normally.</div>
      </div>`;
    return;
  }
  row.innerHTML = alerts.map(a => `
    <div class="db-alert db-alert--${a.type}">
      <i class="bi ${a.icon}"></i>
      <div class="db-alert-body"><strong>${a.title}</strong>${a.text}</div>
      ${a.action ? `<button class="db-alert-action" onclick="switchPanel('${a.panel}')">${a.action}</button>` : ''}
    </div>`).join('');
}

function dbRenderPipeline(data) {
  const tx = data.transactionStats || {};
  const pending   = +(tx.pending   || 0);
  const submitted   = +(tx.submitted   || 0);
  const ongoing   = +(tx.ongoing   || tx.on_going || 0);
  const toClaim   = +(tx.to_claim  || 0);
  const claimed   = +(tx.claimed   || tx.completed || 0);
  const cancelled = +(tx.cancelled || 0);
  const total     = pending + ongoing + toClaim + claimed + cancelled || 1;

  dbSetEl('pipeIn',     pending);
  dbSetEl('pipeSub',     submitted);

  dbSetEl('pipeProc',   ongoing);
  dbSetEl('pipeClaim',  toClaim);
  dbSetEl('pipeDone',   claimed);
  dbSetEl('pipeCancel', cancelled);

  const setPipe = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.round((val / total) * 100) + '%';
  };
  setPipe('pipeInFill',     pending);
  setPipe('pipeProcFill',   ongoing);
  setPipe('pipeClaimFill',  toClaim);
  setPipe('pipeDoneFill',   claimed);
  setPipe('pipeCancelFill', cancelled);

  const totalAll = pending + ongoing + toClaim + claimed + cancelled;
  dbSetEl('tpTotal',      totalAll);
  dbSetEl('tpClaimRate',  totalAll ? Math.round((claimed   / totalAll) * 100) + '%' : '—');
  dbSetEl('tpAvgDays',    parseFloat(data.processingStats?.avg_processing_days || 0).toFixed(1) + 'd');
  dbSetEl('tpCancelRate', totalAll ? Math.round((cancelled / totalAll) * 100) + '%' : '—');
}

function dbRenderSlots(slots) {
  const container = document.getElementById('dbSlotList');
  if (!container) return;

  const allTimes = [
    { t:'08:00:00', label:'8:00 AM'  }, { t:'09:00:00', label:'9:00 AM'  },
    { t:'10:00:00', label:'10:00 AM' }, { t:'11:00:00', label:'11:00 AM' },
    { t:'13:00:00', label:'1:00 PM'  }, { t:'14:00:00', label:'2:00 PM'  },
    { t:'15:00:00', label:'3:00 PM'  }, { t:'16:00:00', label:'4:00 PM'  },
  ];

  // Build map from database rows (now includes full + unavailable slots)
  const slotMap = {};
  if (Array.isArray(slots)) {
    slots.forEach(s => { slotMap[s.appointment_time] = s; });
  }

  const colors = ['#22c55e','#22c55e','#fbbf24','#f97316','#ef4444'];

  container.innerHTML = allTimes.map(({ t, label }) => {
    const s        = slotMap[t];
    // FIX 2: current_bookings is now a real value (full slots included in query)
    const booked   = s ? +s.current_bookings : 0;
    const cap      = s ? +s.max_capacity    : 3;
    const pct      = (s && cap > 0) ? Math.round((booked / cap) * 100) : 0;
    const isFull   = booked >= cap && cap > 0;
    const isUnavail = s && !s.is_available;
    const colorIdx  = Math.min(Math.floor(pct / 25), 4);
    const barColor  = isFull ? '#ef4444' : isUnavail ? '#5a6a88' : (colors[colorIdx] || '#22c55e');

    return `
      <div class="db-slot-row ${isFull ? 'db-slot-full' : ''} ${isUnavail ? 'db-slot-closed' : ''}">
        <span class="db-slot-time">${label}</span>
        <div class="db-slot-bar-wrap">
          <div class="db-slot-bar-fill" style="width:${pct}%;background:${barColor};"></div>
        </div>
        <span class="db-slot-count" style="color:${barColor};">
          ${isUnavail ? 'N/A' : s ? `${booked}/${cap}` : '—'}
        </span>
      </div>`;
  }).join('');
}

// ── CHARTS ────────────────────────────────────────────────────────────────────
function dbRenderCharts(data) {
  const isDark     = document.documentElement.getAttribute('data-theme') !== 'light';
  const gridColor  = isDark ? 'rgba(46,63,96,.5)'     : 'rgba(220,225,240,.8)';
  const textColor  = isDark ? '#5a6a88'               : '#9ca3af';

  if (typeof Chart === 'undefined') {
    console.warn('[Dashboard] Chart.js not loaded — charts skipped');
    return;
  }
  Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";

  // Booking Trend (line)
  const trendCtx = document.getElementById('chartBookingTrend');
  if (trendCtx) {
    if (_dbChartTrend) _dbChartTrend.destroy();
    const raw    = (data.recentActivity || []).slice().reverse();
    const labels = raw.map(r => new Date(r.date + 'T00:00:00')
      .toLocaleDateString('en-US', { month:'short', day:'numeric' }));
    const values = raw.map(r => r.new_appointments || 0);

    _dbChartTrend = new Chart(trendCtx, {
      type:'line',
      data:{
        labels,
        datasets:[{
          label:'Bookings', data:values,
          borderColor:'#22c55e',
          backgroundColor: isDark ? 'rgba(34,197,94,.08)' : 'rgba(34,197,94,.12)',
          borderWidth:2, pointRadius:0, pointHoverRadius:4, fill:true, tension:0.4,
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:600},
        plugins:{ legend:{display:false}, tooltip:{
          backgroundColor: isDark ? '#1a2540':'#fff',
          titleColor: isDark ? '#e8edf7':'#0f172a',
          bodyColor:  isDark ? '#8a97b4':'#374151',
          borderColor: isDark ? '#2e3f60':'#dde1ef', borderWidth:1,
        }},
        scales:{
          x:{ grid:{color:gridColor}, ticks:{color:textColor, maxTicksLimit:7} },
          y:{ grid:{color:gridColor}, ticks:{color:textColor, stepSize:1}, beginAtZero:true }
        }
      }
    });
  }

  // Service Demand (doughnut)
  const demandCtx = document.getElementById('chartServiceDemand');
  if (demandCtx) {
    if (_dbChartDemand) _dbChartDemand.destroy();
    const svcData = data.topServices || [];
    const palette = ['#22c55e','#22d3ee','#6366f1','#f59e0b','#f43f5e','#a855f7','#06b6d4'];
    const total   = svcData.reduce((s, x) => s + (+x.transaction_count || 0), 0) || 1;

    _dbChartDemand = new Chart(demandCtx, {
      type:'doughnut',
      data:{
        labels: svcData.map(s => s.service_name),
        datasets:[{
          data: svcData.map(s => s.transaction_count || 0),
          backgroundColor: palette, borderWidth:2,
          borderColor: isDark ? '#0e1525':'#fff', hoverOffset:4,
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:600}, cutout:'68%',
        plugins:{ legend:{display:false}, tooltip:{
          callbacks:{ label: ctx => ` ${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw/total*100)}%)` }
        }}
      }
    });

    const leg = document.getElementById('dbServiceLegend');
    if (leg) {
      leg.innerHTML = svcData.map((s, i) => `
        <div class="db-svc-legend-item">
          <span class="db-svc-legend-dot" style="background:${palette[i]};"></span>
          <span class="db-svc-legend-name">${s.service_name}</span>
          <span class="db-svc-legend-val">${s.transaction_count}</span>
          <span class="db-svc-legend-pct">${Math.round((s.transaction_count/total)*100)}%</span>
        </div>`).join('');
    }
  }

  // Monthly Volume (bar)
  const monthCtx = document.getElementById('chartMonthlyVol');
  if (monthCtx) {
    if (_dbChartMonthly) _dbChartMonthly.destroy();
    const monthly  = (data.monthlyTrends || []).slice().reverse();
    const mLabels  = monthly.map(m => {
      const [y, mo] = m.month.split('-');
      return new Date(+y, +mo-1).toLocaleDateString('en-US', { month:'short', year:'2-digit' });
    });

    _dbChartMonthly = new Chart(monthCtx, {
      type:'bar',
      data:{
        labels: mLabels,
        datasets:[{
          label:'Transactions', data: monthly.map(m => m.transaction_count || 0),
          backgroundColor:'rgba(34,211,238,.25)', borderColor:'#22d3ee',
          borderWidth:1.5, borderRadius:4,
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false, animation:{duration:600},
        plugins:{ legend:{display:false} },
        scales:{
          x:{ grid:{color:gridColor}, ticks:{color:textColor} },
          y:{ grid:{color:gridColor}, ticks:{color:textColor}, beginAtZero:true }
        }
      }
    });
  }
}

// ── TOP SERVICES LIST (NEW — replaces removed "Needs Attention" panel) ─────────
function dbRenderTopServices(services) {
  const list = document.getElementById('dbTopServicesList');
  if (!list) return;

  if (!services.length) {
    list.innerHTML = `<div class="db-list-empty"><i class="bi bi-briefcase"></i>No service data yet</div>`;
    return;
  }

  const max = Math.max(...services.map(s => +s.transaction_count || 0), 1);
  const palette = ['#22c55e','#22d3ee','#6366f1','#f59e0b','#f43f5e','#a855f7','#06b6d4'];

  list.innerHTML = services.map((s, i) => {
    const pct = Math.round(((+s.transaction_count || 0) / max) * 100);
    return `
      <div class="db-svc-rank-row">
        <span class="db-svc-rank-num">${i + 1}</span>
        <span class="db-svc-rank-name">${dbEsc(s.service_name)}</span>
        <div class="db-svc-rank-bar-wrap">
          <div class="db-svc-rank-fill" style="width:${pct}%;background:${palette[i] || '#22c55e'};"></div>
        </div>
        <span class="db-svc-rank-count">${s.transaction_count}</span>
      </div>`;
  }).join('');
}

// ── UPCOMING APPOINTMENTS (unchanged — already correct) ───────────────────────
function dbRenderUpcoming(response) {
  const list = document.getElementById('dbUpcomingAppts');
  if (!list) return;

  const items  = Array.isArray(response) ? response : (response?.appointments || response?.data || []);
  const sorted = items
    .filter(a => a.status === 'approved')
    .sort((a, b) => new Date(a.appointment_date) - new Date(b.appointment_date))
    .slice(0, 6);

  if (!sorted.length) {
    list.innerHTML = `<div class="db-list-empty"><i class="bi bi-calendar-x"></i>No upcoming appointments</div>`;
    return;
  }

  list.innerHTML = sorted.map(a => {
    const name     = a.client_name || `${a.first_name||''} ${a.last_name||''}`.trim();
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const dateStr  = new Date(a.appointment_date + 'T00:00:00')
      .toLocaleDateString('en-US', { month:'short', day:'numeric' });
    return `
      <div class="db-appt-row">
        <div class="db-appt-avatar">${initials}</div>
        <div class="db-appt-info">
          <div class="db-appt-name">${dbEsc(name)}</div>
          <div class="db-appt-meta">${dateStr}</div>
        </div>
        <div class="db-appt-time">${dbFmt12h(a.appointment_time)}</div>
      </div>`;
  }).join('');
}

// ── TESTIMONIALS + RATING ─────────────────────────────────────────────────────
// Also updates KPI 8 once rating is computed from real data
function dbRenderTestimonials(response) {
  const list  = document.getElementById('dbTestimonialList');
  const bk    = document.getElementById('dbRatingBreakdown');
  const ovEl  = document.getElementById('dbRatingOverall');
  if (!list) return;

  const items = Array.isArray(response) ? response : (response?.testimonials || response?.data || []);
  if (!items.length) {
    list.innerHTML = `<div class="db-list-empty"><i class="bi bi-star"></i>No reviews yet</div>`;
    return;
  }

  const avg = items.reduce((s, t) => s + (+t.rating || 0), 0) / items.length;
  if (ovEl) ovEl.textContent = `${avg.toFixed(1)} / 5.0  (${items.length})`;

  // Update KPI 8 with real computed rating
  dbSetEl('kpiAvgRating', avg.toFixed(1));
  dbSetEl('kpiRatingSub',  `${items.length} total reviews`);
  const starsEl = document.getElementById('kpiStars');
  if (starsEl) starsEl.innerHTML = dbStarHtml(avg);

  // Star breakdown
  if (bk) {
    bk.innerHTML = [5,4,3,2,1].map(star => {
      const count = items.filter(t => +t.rating === star).length;
      const pct   = Math.round((count / items.length) * 100);
      return `
        <div class="db-rating-bar-row">
          <span class="db-rating-star">${star}★</span>
          <div class="db-rating-track"><div class="db-rating-fill" style="width:${pct}%"></div></div>
          <span class="db-rating-num">${count}</span>
        </div>`;
    }).join('');
  }

  list.innerHTML = items.slice(0, 3).map(t => {
    const stars = '★'.repeat(+t.rating) + '☆'.repeat(5 - (+t.rating));
    const name  = t.client_name || t.initials || 'Client';
    const msg   = (t.message || t.content || '');
    return `
      <div class="db-testi-row">
        <div class="db-testi-header">
          <span class="db-testi-name">${dbEsc(name)}</span>
          <span class="db-testi-stars">${stars}</span>
        </div>
        <div class="db-testi-msg">"${dbEsc(msg.slice(0, 90))}${msg.length > 90 ? '…' : ''}"</div>
      </div>`;
  }).join('');
}

// ── HELPERS (unchanged) ───────────────────────────────────────────────────────
function dbSetEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function dbSetTrend(id, val, threshold = 0, upLabel = '↑', downLabel = '↓') {
  const el = document.getElementById(id);
  if (!el || val === null || val === undefined) return;
  const up  = val > threshold;
  el.textContent = up ? upLabel : downLabel;
  el.className   = 'db-kpi-trend ' + (up ? 'db-trend-up' : 'db-trend-down');
}

function dbTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function dbGetGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function dbFmt12h(t) {
  if (!t) return '—';
  const [h, m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function dbStarHtml(rating) {
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += rating >= i ? '★' : rating >= i - 0.5 ? '½' : '☆';
  }
  return html;
}

function dbEsc(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  dbStartClock();
  if (document.getElementById('panel-dashboard')?.classList.contains('active')) {
    loadDashboard();
  }
});

document.querySelectorAll('[data-panel="panel-dashboard"], [onclick*="panel-dashboard"]')
  .forEach(el => el.addEventListener('click', () => setTimeout(loadDashboard, 80)));

document.addEventListener('click', function(e) {
    if (!e.target.closest('.msg-menu-trigger') && !e.target.closest('.msg-menu-dropdown')) {
        document.querySelectorAll('.msg-menu-dropdown').forEach(d => d.remove());
    }
});