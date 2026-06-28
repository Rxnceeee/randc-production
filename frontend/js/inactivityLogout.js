// inactivityLogout.js — v3


'use strict';

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000; 

let _inactivityTimer   = null;
let _warningTimer      = null;
let _logoutCallback    = null;
let _warningCallback   = null;
let _isWatching        = false;
let _timeoutMs         = DEFAULT_TIMEOUT_MS;
let _warningMs         = DEFAULT_TIMEOUT_MS - 60 * 1000; 
let _visibilityHandler = null;

const ACTIVITY_EVENTS = [
  'mousemove', 'mousedown', 'keydown',
  'touchstart', 'touchmove', 'scroll',
  'click', 'wheel',
];

function _clearTimers() {
  clearTimeout(_inactivityTimer);
  clearTimeout(_warningTimer);
  _inactivityTimer = null;
  _warningTimer    = null;
}

function _resetTimer() {
  _clearTimers();

  if (typeof _warningCallback === 'function') {
    _warningTimer = setTimeout(() => {
      _warningCallback(_timeoutMs - _warningMs); 
    }, _warningMs);
  }

  _inactivityTimer = setTimeout(_handleInactivity, _timeoutMs);
}

function _handleInactivity() {
  console.warn('[Inactivity] Timeout reached — logging out');
  const cb = _logoutCallback; 
  stopInactivityWatch();
  if (typeof cb === 'function') cb();
}

function _activityHandler() {
  if (!_isWatching) return;
  _resetTimer();

  // Keep socket presence alive on every real user interaction
  try {
    const s = (typeof socket !== 'undefined' && socket) || window.socket;
    if (s?.connected) s.emit('ping_presence');
  } catch {  }
}


function startInactivityWatch(onLogout, options = {}) {
  if (_isWatching) return; // guard against double-init

  _logoutCallback  = onLogout;
  _warningCallback = options.onWarning ?? null;
  _timeoutMs       = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Default: warn 1 minute before logout
  _warningMs       = options.warningMs ?? (_timeoutMs - 60 * 1000);

  _isWatching = true;

  ACTIVITY_EVENTS.forEach(ev =>
    window.addEventListener(ev, _activityHandler, { passive: true })
  );

  _visibilityHandler = () => _resetTimer();
  document.addEventListener('visibilitychange', _visibilityHandler);


  _resetTimer();
  //console.log(`[Inactivity] Started — logout: ${_timeoutMs / 1000}s, warning: ${_warningMs / 1000}s`);
}


function stopInactivityWatch() {
  if (!_isWatching) return;

  _isWatching = false;
  _clearTimers();

  ACTIVITY_EVENTS.forEach(ev =>
    window.removeEventListener(ev, _activityHandler)
  );

  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler);
    _visibilityHandler = null;
  }

  _logoutCallback  = null;
  _warningCallback = null;
  console.log('[Inactivity] Watch stopped');
}


function resetInactivityTimer() {
  if (_isWatching) _resetTimer();
}