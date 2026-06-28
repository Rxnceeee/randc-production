'use strict';

/* ─── State ──────────────────────────────────────────────────────────── */
const bkState = {
  step: 1,
  firstName: '', lastName: '', email: '', phone: '',
  serviceIds: [],
  appointmentDate: '',
  appointmentTime: '',
  notes: '',
  services: []
};

/* ─── Init ───────────────────────────────────────────────────────────── */
function initBooking() {
  const dateInput = document.getElementById('bk-date');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today;
    dateInput.addEventListener('change', () => {
      const v = dateInput.value;
      if (v) loadSlots(v);
    });
  }
  fetchBookingServices();
  showBkStep(1);
}

/* ─── Services ───────────────────────────────────────────────────────── */
async function fetchBookingServices() {
  const grid = document.getElementById('bk-services-grid');
  const icons = [
    'bi-file-earmark-text','bi-house-check','bi-receipt',
    'bi-file-earmark-lock','bi-building','bi-clipboard-check'
  ];

  try {
    const res  = await fetch(BASE_URL + '/api/public/services');
    const data = await res.json();
    bkState.services = data.services || data || [];

    if (!bkState.services.length) {
      grid.innerHTML = '<p class="bk-api-msg">No services available at this time.</p>';
      return;
    }

    grid.innerHTML = bkState.services.map((s, i) => `
      <label class="bk-svc-card" for="bk-svc-${s.service_id}">
        <input type="checkbox" id="bk-svc-${s.service_id}" value="${s.service_id}"
          onchange="bkToggleService(${s.service_id})" />
        <span class="bk-svc-icon"><i class="bi ${icons[i % icons.length]}"></i></span>
        <span class="bk-svc-name">${bkEsc(s.service_name)}</span>
        ${s.description ? `<span class="bk-svc-desc">${bkEsc(s.description)}</span>` : ''}
        <span class="bk-svc-checkmark" aria-hidden="true"><i class="bi bi-check2-circle"></i></span>
      </label>`
    ).join('');
  } catch {
    grid.innerHTML = '<p class="bk-api-msg bk-api-err">Could not load services. Please refresh the page.</p>';
  }
}

function bkToggleService(id) {
  if (bkState.serviceIds.includes(id)) {
    bkState.serviceIds = bkState.serviceIds.filter(x => x !== id);
  } else {
    bkState.serviceIds.push(id);
  }
}

/* ─── Slots ──────────────────────────────────────────────────────────── */
async function loadSlots(date) {
  const grid = document.getElementById('bk-slots-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="bk-slots-loading"><i class="bi bi-arrow-repeat bk-spin"></i> Checking availability…</div>';
  bkState.appointmentTime = '';
  document.querySelectorAll('.bk-slot-pill.bk-slot-selected').forEach(p => p.classList.remove('bk-slot-selected'));
  bkClearError('bk-time-err');

  try {
    const res  = await fetch(`${BASE_URL}/api/public/slots?date=${date}`);
    const data = await res.json();
    const slots = data.slots || [];

    if (!slots.length) {
      grid.innerHTML = '<p class="bk-api-msg">No time slots available for this date. Please choose another day.</p>';
      return;
    }

    grid.innerHTML = slots.map(s => `
      <button type="button"
        class="bk-slot-pill${!s.isAvailable ? ' bk-slot-full' : ''}"
        ${!s.isAvailable ? 'disabled aria-disabled="true"' : `onclick="bkSelectSlot('${s.time}', this)"`}
        aria-label="${bkFmt12h(s.time)}, ${s.isAvailable ? (s.remaining + ' slot' + (s.remaining !== 1 ? 's' : '') + ' left') : 'fully booked'}">
        <span class="bk-slot-time">${bkFmt12h(s.time)}</span>
        <span class="bk-slot-rem">${s.isAvailable ? (s.remaining === 1 ? '1 left' : s.remaining + ' left') : 'Full'}</span>
      </button>`
    ).join('');
  } catch {
    grid.innerHTML = '<p class="bk-api-msg bk-api-err">Could not load available slots. Please try again.</p>';
  }
}

function bkSelectSlot(time, btn) {
  document.querySelectorAll('.bk-slot-pill').forEach(p => p.classList.remove('bk-slot-selected'));
  btn.classList.add('bk-slot-selected');
  bkState.appointmentTime = time;
  bkClearError('bk-time-err');
}

/* ─── Step navigation ────────────────────────────────────────────────── */
function showBkStep(n) {
  bkState.step = n;

  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById('bk-step-' + i);
    if (el) el.hidden = (i !== n);
  }

  document.querySelectorAll('.bk-prog-node').forEach((node, idx) => {
    const s = idx + 1;
    node.className = 'bk-prog-node' + (s < n ? ' done' : s === n ? ' active' : '');
  });

  document.querySelectorAll('.bk-prog-line').forEach((line, idx) => {
    line.classList.toggle('done', idx + 1 < n);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bkNext() {
  if (!bkValidateStep(bkState.step)) return;
  if (bkState.step === 3) bkBuildReview();
  if (bkState.step < 4) showBkStep(bkState.step + 1);
}

function bkBack() {
  if (bkState.step > 1) showBkStep(bkState.step - 1);
}

/* ─── Validation ─────────────────────────────────────────────────────── */
function bkValidateStep(n) {
  bkClearAllErrors();
  let ok = true;

  if (n === 1) {
    const first = document.getElementById('bk-firstName').value.trim();
    const last  = document.getElementById('bk-lastName').value.trim();
    const email = document.getElementById('bk-email').value.trim();
    const phone = document.getElementById('bk-phone').value.trim();

    if (!first || first.length < 2 || first.length > 50 || !/^[A-Za-z\s\-]+$/.test(first)) {
      bkSetError('bk-firstName-err', 'Required · letters only · 2–50 chars'); ok = false;
    } else { bkState.firstName = first; }

    if (!last || last.length < 2 || last.length > 50 || !/^[A-Za-z\s\-]+$/.test(last)) {
      bkSetError('bk-lastName-err', 'Required · letters only · 2–50 chars'); ok = false;
    } else { bkState.lastName = last; }

    if (!email || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      bkSetError('bk-email-err', 'A valid email address is required'); ok = false;
    } else { bkState.email = email; }

    if (phone && !/^(\+?63|0)[0-9]{9,10}$/.test(phone.replace(/\s/g, ''))) {
      bkSetError('bk-phone-err', 'Must be a valid PH number — e.g. 09XX XXX XXXX'); ok = false;
    } else { bkState.phone = phone; }
  }

  if (n === 2) {
    if (!bkState.serviceIds.length) {
      bkSetError('bk-services-err', 'Please select at least one service'); ok = false;
    }
  }

  if (n === 3) {
    const date = document.getElementById('bk-date').value;
    if (!date) {
      bkSetError('bk-date-err', 'Please select a date'); ok = false;
    } else {
      const d     = new Date(date + 'T00:00:00');
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (d < today) {
        bkSetError('bk-date-err', 'Date must be today or in the future'); ok = false;
      } else if (d.getDay() === 0) {
        bkSetError('bk-date-err', 'We are closed on Sundays — please pick another day'); ok = false;
      } else {
        bkState.appointmentDate = date;
      }
    }
    if (!bkState.appointmentTime) {
      bkSetError('bk-time-err', 'Please select a time slot'); ok = false;
    }
  }

  return ok;
}

/* ─── Review build ───────────────────────────────────────────────────── */
function bkBuildReview() {
  bkState.notes = (document.getElementById('bk-notes')?.value || '').trim();

  const serviceNames = bkState.services
    .filter(s => bkState.serviceIds.includes(s.service_id))
    .map(s => s.service_name);

  document.getElementById('rv-name').textContent     = bkState.firstName + ' ' + bkState.lastName;
  document.getElementById('rv-email').textContent    = bkState.email;
  document.getElementById('rv-phone').textContent    = bkState.phone || '—';
  document.getElementById('rv-services').textContent = serviceNames.join(', ') || '—';
  document.getElementById('rv-date').textContent     = bkFormatDate(bkState.appointmentDate);
  document.getElementById('rv-time').textContent     = bkFmt12h(bkState.appointmentTime);
  document.getElementById('rv-notes').textContent    = bkState.notes || '—';
}

/* ─── Submit ─────────────────────────────────────────────────────────── */
async function bkSubmit() {
  const confirmCheck = document.getElementById('bk-confirm-check');
  if (!confirmCheck?.checked) {
    bkSetError('bk-confirm-err', 'Please check the box to confirm your details');
    return;
  }

  const btn = document.getElementById('bk-submit-btn');
  const errEl = document.getElementById('bk-submit-err');
  if (errEl) errEl.hidden = true;
  btn.disabled = true;
  btn.innerHTML = '<span class="bk-spin-sm" aria-hidden="true"></span> Sending request…';

  try {
    const body = {
      firstName: bkState.firstName,
      lastName:  bkState.lastName,
      email:     bkState.email,
      serviceIds:        bkState.serviceIds,
      appointmentDate:   bkState.appointmentDate,
      appointmentTime:   bkState.appointmentTime,
    };
    if (bkState.phone) body.phone = bkState.phone;
    if (bkState.notes) body.notes = bkState.notes;

    const res  = await fetch(BASE_URL + '/api/public/book', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
    const data = await res.json();

    if (res.ok) {
      bkShowSuccess();
      return;
    }

    let msg = data.message || 'Something went wrong. Please try again.';
    if (res.status === 429) msg = 'Too many booking attempts — please wait 15 minutes and try again.';
    if (res.status === 409) {
      msg = 'This time slot just filled up. Please go back and choose another time.';
      showBkStep(3);
    }
    if (errEl) { errEl.textContent = msg; errEl.hidden = false; }

  } catch {
    if (errEl) { errEl.textContent = 'Network error. Please check your connection.'; errEl.hidden = false; }
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-send" aria-hidden="true"></i> Submit Booking Request';
  }
}

function bkShowSuccess() {
  document.getElementById('bk-wizard').hidden  = true;
  document.getElementById('bk-success').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ─── Helpers ────────────────────────────────────────────────────────── */
function bkFmt12h(time) {
  if (!time) return '—';
  const parts = time.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] || '0', 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')} ${ampm}`;
}

function bkFormatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function bkSetError(id, msg) {
  const el = document.getElementById(id);
  if (el) el.textContent = msg;
}

function bkClearError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = '';
}

function bkClearAllErrors() {
  document.querySelectorAll('.bk-err').forEach(el => el.textContent = '');
}

function bkEsc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

document.addEventListener('DOMContentLoaded', initBooking);
