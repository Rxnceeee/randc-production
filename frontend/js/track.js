'use strict';

let _trackPoller = null;
let _trackSecAgo = 0;
let _trackTicker = null;

function initTrack() {
  const token = window.location.pathname.replace(/^\/track\/?/, '').split('/').filter(Boolean)[0];

  if (!token || token.length < 10) {
    renderTrackError('Invalid tracking link. Please scan the QR code from your confirmation email again.');
    return;
  }

  loadTracking(token);

  _trackPoller = setInterval(() => loadTracking(token), 60_000);
  _trackTicker = setInterval(() => {
    _trackSecAgo++;
    const el = document.getElementById('track-last-check');
    if (el) el.textContent = _trackSecAgo < 60
      ? 'Updated ' + _trackSecAgo + 's ago'
      : 'Updated ' + Math.floor(_trackSecAgo / 60) + 'min ago';
  }, 1000);
}

async function loadTracking(token) {
  _trackSecAgo = 0;
  const el = document.getElementById('track-last-check');
  if (el) el.textContent = 'Checking…';

  try {
    const res  = await fetch(BASE_URL + '/api/public/track/' + token);
    const data = await res.json();

    if (!res.ok) {
      renderTrackError(data.message || 'Booking not found. This link may be invalid or expired.');
      stopTrackPolling();
      return;
    }

    renderTrackData(data);
    if (el) el.textContent = 'Just updated';

    if (data.status === 'completed' || data.status === 'cancelled') stopTrackPolling();

  } catch {
    const errEl = document.getElementById('track-net-err');
    if (errEl) { errEl.hidden = false; }
  }
}

function renderTrackData(data) {
  document.getElementById('track-loading').hidden  = true;
  document.getElementById('track-error').hidden    = true;
  document.getElementById('track-content').hidden  = false;

  const statusCfg = {
    pending:   { label: 'Pending Review', color: '#f59e0b', bg: 'rgba(245,158,11,.12)', icon: 'bi-hourglass-split' },
    approved:  { label: 'Approved',       color: '#3b82f6', bg: 'rgba(59,130,246,.12)', icon: 'bi-calendar-check' },
    completed: { label: 'Completed',      color: '#22c55e', bg: 'rgba(34,197,94,.12)',  icon: 'bi-patch-check-fill' },
    cancelled: { label: 'Cancelled',      color: '#ef4444', bg: 'rgba(239,68,68,.12)',  icon: 'bi-x-circle' },
    lapsed:    { label: 'Lapsed',         color: '#6b7280', bg: 'rgba(107,114,128,.12)', icon: 'bi-clock-history' },
  };

  const cfg = statusCfg[data.status] || statusCfg.pending;

  const badge = document.getElementById('track-status-badge');
  badge.textContent = cfg.label;
  badge.style.color      = cfg.color;
  badge.style.background = cfg.bg;
  badge.style.borderColor = cfg.color + '44';

  const icon = document.getElementById('track-status-icon');
  if (icon) {
    icon.className     = 'bi ' + cfg.icon;
    icon.style.color   = cfg.color;
  }

  setText('track-name',    data.firstName || '—');
  setText('track-date',    trackFormatDate(data.appointmentDate));
  setText('track-time',    trackFmt12h(data.appointmentTime));
  setText('track-updated', trackFormatDateTime(data.updatedAt));

  const svcEl = document.getElementById('track-services');
  if (svcEl) {
    const names = (data.services || []).map(s => s.service_name || s.serviceName).filter(Boolean);
    svcEl.innerHTML = names.length
      ? names.map(n => `<span class="track-svc-pill">${escTrack(n)}</span>`).join('')
      : '<span class="track-muted">—</span>';
  }

  const remarksSection = document.getElementById('track-remarks-section');
  const remarksEl      = document.getElementById('track-remarks');
  if (data.remarks && data.remarks.trim()) {
    if (remarksSection) remarksSection.hidden = false;
    if (remarksEl)      remarksEl.textContent = data.remarks;
  } else {
    if (remarksSection) remarksSection.hidden = true;
  }

  const netErr = document.getElementById('track-net-err');
  if (netErr) netErr.hidden = true;
}

function renderTrackError(msg) {
  document.getElementById('track-loading').hidden  = true;
  document.getElementById('track-content').hidden  = true;
  document.getElementById('track-error').hidden    = false;
  const msgEl = document.getElementById('track-error-msg');
  if (msgEl) msgEl.textContent = msg;
}

function stopTrackPolling() {
  if (_trackPoller) { clearInterval(_trackPoller); _trackPoller = null; }
  if (_trackTicker) { clearInterval(_trackTicker); _trackTicker = null; }
}

/* ─── Helpers ────────────────────────────────────────────────────────── */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '—';
}

function trackFmt12h(time) {
  if (!time) return '—';
  const parts = String(time).split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] || '0', 10);
  if (isNaN(h)) return time;
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function trackFormatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function trackFormatDateTime(dtStr) {
  if (!dtStr) return '—';
  const d = new Date(dtStr);
  if (isNaN(d.getTime())) return dtStr;
  return d.toLocaleString('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function escTrack(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

document.addEventListener('DOMContentLoaded', initTrack);
