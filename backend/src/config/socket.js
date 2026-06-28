// Socket.IO removed — no-ops to maintain controller compatibility
export function emitToUser() {}
export function emitToAdmins() {}
export function emitToConversation() {}
export function broadcast() {}
export function getIO() { return null; }
export function isUserOnline() { return false; }
export function getActiveUsers() { return new Map(); }
