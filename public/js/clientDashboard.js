
'use strict';

/* ═══════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════ */

const TOAST_ICONS = {
    success: 'check-circle-fill',
    error:   'x-circle-fill',
    warning: 'exclamation-triangle-fill',
    info:    'info-circle-fill',
};

const PANEL_TITLES = {
    dashboardPanel:    'Dashboard',
    appointmentPanel:  'My Appointments',
    transactionsPanel: 'Transactions',
    testimonialsPanel: 'Testimonials',
    userProfilePanel:  'My Account',
    adminChatPanel:    'Support Chat',
};

const ACTIVITY_ICONS = {
    appointment:  'calendar-check',
    transaction:  'file-earmark-check',
    notification: 'bell',
    update:       'arrow-repeat',
    completed:    'check-circle',
    cancelled:    'x-circle',
};


/* ═══════════════════════════════════════════════════════════
   MODAL INSTANCES  (initialised after DOM ready)
   ═══════════════════════════════════════════════════════════ */

let logoutModal;
let changePasswordModal;
let updateAppointmentStatusModal;
let clientTimelineModal;
let cancelTransactionModal;
let alertModal;
let confirmModal;


/* ═══════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════ */

let sidebarCollapsed = false;

function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;

    document.getElementById('sidebar').classList.toggle('collapsed', sidebarCollapsed);
    document.getElementById('appShell').classList.toggle('expanded', sidebarCollapsed);

    const icon = document.getElementById('sidebarToggleIcon');
    icon.className = sidebarCollapsed ? 'bi bi-chevron-right' : 'bi bi-chevron-left';

    localStorage.setItem('rnc-sidebar', sidebarCollapsed ? '1' : '0');
}

function restoreSidebarState() {
    if (localStorage.getItem('rnc-sidebar') === '1') {
        toggleSidebar();
    }
}


function showServerMessage(message, type = 'info', autoHide = true) {
    const wrap = document.getElementById('toastWrap');
    const id   = `toast_${Date.now()}`;
    const icon = TOAST_ICONS[type] ?? TOAST_ICONS.info;

    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    el.id        = id;
    el.innerHTML = `
        <i class="bi bi-${icon} toast-icon"></i>
        <span class="toast-msg">${message}</span>
        <button class="toast-close" onclick="dismissToast('${id}')">
            <i class="bi bi-x"></i>
        </button>
    `;

    wrap.appendChild(el);

    if (autoHide) {
        setTimeout(() => dismissToast(id), 4500);
    }
}

/**
 * Animate and remove a toast element.
 *
 * @param {string} id
 */
function dismissToast(id) {
    const el = document.getElementById(id);
    if (!el) return;

    el.style.opacity   = '0';
    el.style.transform = 'translateX(20px)';
    el.style.transition = 'all 0.2s';

    setTimeout(() => el.remove(), 220);
}


/* ═══════════════════════════════════════════════════════════
   ALERT / CONFIRM MODALS
   ═══════════════════════════════════════════════════════════ */

/** Override native alert with themed modal. */
window.alert = (message) => showAlertModal(message, 'info');

let confirmCallback = null;

/** Override native confirm with a promise-based modal. */
window.confirm = (message) =>
    new Promise((resolve) => {
        confirmCallback = resolve;
        showConfirmModal(message);
    });

/**
 * Show the themed alert modal.
 *
 * @param {string} message
 * @param {string} [type='info']  success | error | warning | info
 */
function showAlertModal(message, type = 'info') {
    const header    = document.getElementById('alertModalHeader');
    const titleText = document.getElementById('alertModalTitleText');
    const messageEl = document.getElementById('alertModalMessage');
    const icon      = header.querySelector('i');

    const TYPE_MAP = {
        success: ['bg-success', 'bi-check-circle-fill',          'Success'],
        error:   ['bg-danger',  'bi-x-circle-fill',              'Error'],
        warning: ['bg-warning', 'bi-exclamation-triangle-fill',  'Warning'],
    };

    messageEl.textContent = message;

    header.classList.remove('bg-primary', 'bg-success', 'bg-danger', 'bg-warning', 'bg-info');
    icon.classList.remove(
        'bi-info-circle-fill',
        'bi-check-circle-fill',
        'bi-x-circle-fill',
        'bi-exclamation-triangle-fill',
    );

    const [cls, ico, txt] = TYPE_MAP[type] ?? ['bg-primary', 'bi-info-circle-fill', 'Information'];
    header.classList.add(cls);
    icon.classList.add(ico);
    titleText.textContent = txt;

    alertModal.show();
}

/**
 * Show the confirm modal and wire up confirm/cancel callbacks.
 *
 * @param {string} message
 */
function showConfirmModal(message) {
    document.getElementById('confirmModalMessage').textContent = message;

    const confirmBtn = document.getElementById('confirmModalButton');

    confirmBtn.onclick = () => {
        if (confirmCallback) {
            confirmCallback(true);
            confirmCallback = null;
        }
        confirmModal.hide();
    };

    document.getElementById('confirmModal').addEventListener(
        'hidden.bs.modal',
        () => {
            if (confirmCallback) {
                confirmCallback(false);
                confirmCallback = null;
            }
        },
        { once: true },
    );

    confirmModal.show();
}

function showLogoutModal() {
    logoutModal.show();
}


/* ═══════════════════════════════════════════════════════════
   NOTIFICATIONS
   ═══════════════════════════════════════════════════════════ */

function toggleNotifications() {
    document.getElementById('notificationPanel').classList.toggle('show');
}

/** Close notification panel when clicking outside. */
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notificationPanel');
    const bell  = document.querySelector('.notif-btn');

    if (!panel.contains(e.target) && !bell.contains(e.target)) {
        panel.classList.remove('show');
    }
});

/**
 * Render notification items into the panel.
 *
 * @param {Array} notifications
 */
function displayNotifications(notifications) {
    const container = document.getElementById('notificationList');

    if (!notifications?.length) {
        container.innerHTML = `
            <p style="text-align:center;padding:16px;font-size:0.78rem;color:var(--text-muted);">
                No notifications
            </p>`;
        return;
    }

    container.innerHTML = notifications
        .map(
            (n) => `
            <div class="notif-item ${n.is_read ? '' : 'unread'}"
                 onclick="markAsRead(${n.notification_id})">
                <div class="nt">${n.title}</div>
                <div class="nm">${n.message}</div>
                <div class="nd">${formatNotificationTime(n.created_at)}</div>
            </div>`,
        )
        .join('');
}

/**
 * Update the notification badge count.
 *
 * @param {Array} notifications
 */
function updateNotificationBadge(notifications) {
    const unread = notifications.filter((n) => !n.is_read).length;
    const badge  = document.getElementById('notificationCount');

    if (unread > 0) {
        badge.textContent  = unread > 9 ? '9+' : unread;
        badge.style.display = 'flex';
    } else {
        badge.style.display = 'none';
    }
}

async function fetchNotifications() {
    const res = await fetch(`${BASE_URL}/api/client/notifications`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    if (!res.ok) return;

    const notifications = await res.json();
    displayNotifications(notifications);
    updateNotificationBadge(notifications);
}

async function markAsRead(id) {
    try {
        await fetch(`/api/client/notifications/${id}/read`, {
            method:  'PUT',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        fetchNotifications();
    } catch {
        // silently ignore
    }
}

async function markAllAsRead() {
    try {
        await fetch('/api/client/notifications/mark-all-read', {
            method:  'PUT',
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        fetchNotifications();
    } catch {
        // silently ignore
    }
}

/**
 * Format a timestamp into a relative time string.
 *
 * @param  {string} timestamp
 * @returns {string}
 */
function formatNotificationTime(timestamp) {
    const date = new Date(timestamp);
    const now  = new Date();
    const diff = Math.floor((now - date) / 60_000); // minutes

    if (diff < 1)    return 'Just now';
    if (diff < 60)   return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    if (diff < 10080) return `${Math.floor(diff / 1440)}d ago`;

    return date.toLocaleDateString();
}


/* ═══════════════════════════════════════════════════════════
   SECTION / PANEL NAVIGATION
   ═══════════════════════════════════════════════════════════ */

/**
 * Switch the visible panel and load its data.
 *
 * @param {string} sectionName  Key matching an id in PANEL_TITLES
 */
async function showSection(sectionName) {
    // Hide all panels
    document.querySelectorAll('.panel').forEach((p) => {
        p.classList.remove('active');
        p.style.display = 'none';
    });

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach((i) => i.classList.remove('active'));
    const activeNavItem = event?.target?.closest('.nav-item');
    if (activeNavItem) activeNavItem.classList.add('active');

    // Update page title
    document.getElementById('pageTitle').textContent = PANEL_TITLES[sectionName] ?? '';

    // Show target panel
    const target = document.getElementById(sectionName);
    if (target) {
        target.style.display = 'block';
        target.classList.add('active');
    }

    // Load panel data
    switch (sectionName) {
        case 'dashboardPanel':    await initializeDashboard();       break;
        case 'appointmentPanel':  await fetchAppointments();         break;
        case 'transactionsPanel': await fetchClientTransactions();   break;
    }
}


/* ═══════════════════════════════════════════════════════════
   TIME SLOTS
   ═══════════════════════════════════════════════════════════ */

let selectedTimeSlot = null;

/**
 * Fetch available time slots for a given date.
 *
 * @param {string} date  ISO date string (YYYY-MM-DD)
 */
async function fetchAvailableTimeSlots(date) {
    const res = await fetch(
        `${BASE_URL}/api/client/available-time-slots?date=${date}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
    );

    if (!res.ok) return;

    displayTimeSlots(await res.json());
}

/**
 * Render time slot options.
 *
 * @param {Array} slots
 */
function displayTimeSlots(slots) {
    const container = document.getElementById('timeSlotContainer');

    if (!slots?.length) {
        container.innerHTML = `
            <p style="font-size:0.82rem;color:var(--text-muted);">
                No available time slots for this date
            </p>`;
        return;
    }

    container.innerHTML = slots
        .map((slot) => {
            const spotsLeft = slot.max_capacity - slot.current_bookings;
            const isFull    = spotsLeft <= 0;
            const isLow     = spotsLeft <= 1 && !isFull;

            const capacityLabel = isFull
                ? 'Fully Booked'
                : `${spotsLeft} spot${spotsLeft > 1 ? 's' : ''} left`;

            const icon = isFull
                ? `<i class="bi bi-x-circle" style="color:var(--danger);"></i>`
                : `<i class="bi bi-circle" style="color:var(--text-muted);"></i>`;

            const clickHandler = isFull
                ? ''
                : `onclick="selectTimeSlot('${slot.appointment_time}')"`;

            return `
                <div class="time-slot-option ${isFull ? 'full' : ''}"
                     data-time="${slot.appointment_time}"
                     ${clickHandler}>
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <div>
                            <strong style="font-size:0.875rem;">
                                ${formatTime(slot.appointment_time)}
                            </strong>
                            <div class="time-slot-capacity ${isLow ? 'low' : ''}">
                                ${capacityLabel}
                            </div>
                        </div>
                        ${icon}
                    </div>
                </div>`;
        })
        .join('');
}

/**
 * Mark a time slot as selected.
 *
 * @param {string} time  HH:MM
 */
function selectTimeSlot(time) {
    // Deselect all
    document.querySelectorAll('.time-slot-option').forEach((slot) => {
        slot.classList.remove('selected');
        const icon = slot.querySelector('i');
        if (icon && !slot.classList.contains('full')) {
            icon.className = 'bi bi-circle';
        }
    });

    // Select chosen slot
    const selected = document.querySelector(`[data-time="${time}"]`);
    if (selected && !selected.classList.contains('full')) {
        selected.classList.add('selected');
        const icon = selected.querySelector('i');
        if (icon) icon.className = 'bi bi-check-circle-fill';
        selectedTimeSlot = time;
    }
}

/**
 * Convert a 24-hour "HH:MM" string to a 12-hour display string.
 *
 * @param  {string} time  HH:MM
 * @returns {string}
 */
function formatTime(time) {
    const [hourStr, minutes] = time.split(':');
    const hour  = parseInt(hourStr, 10);
    const ampm  = hour >= 12 ? 'PM' : 'AM';
    const h12   = hour % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
}


/* ═══════════════════════════════════════════════════════════
   USER INITIALISATION
   ═══════════════════════════════════════════════════════════ */

async function initializeUser() {
    const token = localStorage.getItem('token');
    const user  = JSON.parse(localStorage.getItem('user'));

    if (!token) {
        window.location.href = '/pages/index.html';
        return;
    }

    if (!user.last_name || !user.first_name) {
        new bootstrap.Modal(
            document.getElementById('setupUserModal'),
            { backdrop: 'static', keyboard: false },
        ).show();
        return;
    }

    // Populate UI with user info
    const initials = ((user.first_name?.[0] ?? '') + (user.last_name?.[0] ?? '')).toUpperCase();

    document.getElementById('user-name').textContent         = `${user.first_name}, ${user.last_name}`;
    document.getElementById('user-role').textContent         = user.role;
    document.getElementById('welcome-user').textContent      = `Welcome back, ${user.first_name}! 👋`;

    const avatarEl = document.getElementById('userAvatarInitial');
    if (avatarEl) avatarEl.textContent = initials;

    // Populate My Account panel
    if (typeof populateProfilePanel === 'function') populateProfilePanel();

    await fetchServices();
    await fetchAppointments();
    await fetchNotifications();
    await fetchClientTransactions();

    showSection('dashboardPanel');
}


/* ═══════════════════════════════════════════════════════════
   SETUP ACCOUNT FORM
   ═══════════════════════════════════════════════════════════ */

async function submitUserInfo(formData) {
    try {
        const res = await fetch('/api/client/setupAccount', {
            method:  'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization:  `Bearer ${localStorage.getItem('token')}`,
            },
            body: JSON.stringify(formData),
        });

        if (!res.ok) throw new Error('Setup failed');

        const data = await res.json();
        localStorage.setItem('user', JSON.stringify(data.user));

        bootstrap.Modal.getInstance(document.getElementById('setupUserModal')).hide();
        initializeUser();

    } catch {
        showAlertModal('An error occurred. Please try again.', 'error');
    }
}


/* ═══════════════════════════════════════════════════════════
   SERVICES
   ═══════════════════════════════════════════════════════════ */

async function fetchServices() {
    const res      = await fetch(`${BASE_URL}/api/user/getServices`);
    const services = await res.json();
    const el       = document.getElementById('services-col');

    if (!services?.length) {
        el.innerHTML = `
            <p style="font-size:0.82rem;color:var(--text-muted);">No services available</p>`;
        return;
    }

    el.innerHTML = services
        .map(
            (s) => `
            <div class="service-checkbox">
                <div class="form-check">
                    <input class="form-check-input" type="checkbox"
                           id="service-${s.service_id}"
                           name="services"
                           value="${s.service_id}">
                    <label class="form-check-label" for="service-${s.service_id}">
                        <strong style="font-size:0.875rem;">${s.service_name}</strong>
                        <p class="mb-0 form-text">${s.description}</p>
                    </label>
                </div>
            </div>`,
        )
        .join('');
}


/* ═══════════════════════════════════════════════════════════
   APPOINTMENTS
   ═══════════════════════════════════════════════════════════ */

/**
 * Filter appointments by status and refresh the list.
 *
 * @param {string} status
 */
function filterAppointment(status) {
    document.querySelectorAll('.filter-chip').forEach((b) => b.classList.remove('active'));
    event?.target?.classList.add('active');
    fetchAppointments(status);
}

/**
 * Fetch and render appointments.
 *
 * @param {string} [status='all']
 */
async function fetchAppointments(status = 'all') {
    const res          = await fetch(
        `${BASE_URL}/api/client/getAppointments/${status}`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
    );
    const appointments = await res.json();
    const container    = document.getElementById('appointment');

    if (!appointments?.length) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;">
                <i class="bi bi-calendar-x"></i>
                <p>No appointments found</p>
            </div>`;
        return;
    }

    container.innerHTML = appointments
        .map((app) => {
            const statusClass = app.status?.toLowerCase().replace(/\s+/g, '_');
            const bookedDate  = new Date(app.created_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
            });
            const apptDate = new Date(app.appointment_date).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
            });

            const serviceChips = (app.services ?? [])
                .map((s) => `<span class="mini-tag">${s}</span>`)
                .join('');

            const cancelBtn = (app.status === 'completed' || app.status === 'cancelled')
                ? ''
                : `<button class="btn-danger-sm"
                           onclick="showUpdateAppointmentStatusModal(${app.appointment_id})">
                       <i class="bi bi-x-circle"></i> Cancel
                   </button>`;

            return `
            <div class="data-card">
                <div class="data-card-header">
                    <span class="data-card-id">Appointment #${app.appointment_id}</span>
                    <span class="status-chip status-${statusClass}">${app.status}</span>
                </div>

                <div class="data-card-rows">
                    <div class="data-row">
                        <span class="data-row-label">Booked</span>
                        <span class="data-row-val">${bookedDate}</span>
                    </div>
                    <div class="data-row">
                        <span class="data-row-label">Scheduled</span>
                        <span class="data-row-val">${apptDate} ${formatTime(app.appointment_time)}</span>
                    </div>
                </div>

                <div class="data-card-tags">${serviceChips}</div>

                ${app.notes
                    ? `<div class="data-card-note">
                           <i class="bi bi-chat-left-text" aria-hidden="true"></i>
                           <span>${app.notes}</span>
                       </div>`
                    : ''}

                ${cancelBtn
                    ? `<div class="data-card-actions">${cancelBtn}</div>`
                    : ''}
            </div>`;
        })
        .join('');
}

async function submitAppointment(e) {
    e.preventDefault();

    const form             = document.getElementById('appointmentForm');
    const selectedServices = [];

    document
        .querySelectorAll('input[name="services"]:checked')
        .forEach((cb) => selectedServices.push(cb.value));

    if (!selectedServices.length) {
        showAlertModal('Please select at least one service.', 'warning');
        return;
    }

    if (!selectedTimeSlot) {
        showAlertModal('Please select a time slot.', 'warning');
        return;
    }

    // Double-check: block Sunday on submit too (guards against manual date entry)
    const dateVal = document.getElementById('appointmentDate').value;
    if (dateVal) {
        const chosen = new Date(dateVal + 'T00:00:00');
        if (chosen.getDay() === 0) {
            showAlertModal('Appointments are not available on Sundays. Please choose Monday – Saturday.', 'warning');
            document.getElementById('appointmentDate').value = '';
            selectedTimeSlot = null;
            return;
        }
    }

    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const res = await fetch('/api/client/submitAppointment', {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization:  `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
            services: selectedServices,
            date:     document.getElementById('appointmentDate').value,
            time:     selectedTimeSlot,
            notes:    document.getElementById('notes').value,
        }),
    });

    const data = await res.json();

    if (res.ok) {
        bootstrap.Modal.getInstance(document.getElementById('appointmentModal')).hide();
        form.reset();
        selectedTimeSlot = null;

        document.getElementById('timeSlotContainer').innerHTML = `
            <p style="font-size:0.82rem;color:var(--text-muted);">Please select a date first</p>`;

        await fetchServices();
        await fetchAppointments();
    }

    showServerMessage(data.message, res.ok ? 'success' : 'error');
}

async function showUpdateAppointmentStatusModal(appointmentID) {
    document.getElementById('updateAppointmentID').value              = appointmentID;
    document.getElementById('cancellationReason').value               = '';
    document.getElementById('updateAppointmentStatusMessageBox').style.display = 'none';
    updateAppointmentStatusModal.show();
}

/**
 * Display an inline message within the cancellation modal.
 *
 * @param {string}  message
 * @param {string}  [type='error']
 * @param {boolean} [autoHide=true]
 */
function showUpdateAppointmentMessage(message, type = 'error', autoHide = true) {
    const box  = document.getElementById('updateAppointmentStatusMessageBox');
    const text = document.getElementById('updateAppointmentStatusMessage');

    box.classList.remove('alert-success', 'alert-danger');
    box.classList.add(type === 'success' ? 'alert-success' : 'alert-danger');

    text.textContent   = message;
    box.style.display  = 'block';

    if (autoHide) setTimeout(() => { box.style.display = 'none'; }, 4000);
}

async function cancelAppointment() {
    const id     = document.getElementById('updateAppointmentID').value;
    const reason = document.getElementById('cancellationReason').value;

    if (!reason) {
        showUpdateAppointmentMessage('Cancellation Reason is required', 'error');
        return;
    }

    if (!id) {
        showUpdateAppointmentMessage('No appointment selected', 'error');
        return;
    }

    const res = await fetch(`/api/client/cancelAppointment/${id}`, {
        method:  'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization:  `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ reason }),
    });

    const data = await res.json();

    if (res.ok) {
        await fetchAppointments();
        await fetchNotifications();
        showServerMessage(data.message, 'success');
        updateAppointmentStatusModal.hide();
    } else {
        showServerMessage(data.message, 'error');
    }
}


/* ═══════════════════════════════════════════════════════════
   TRANSACTIONS
   ═══════════════════════════════════════════════════════════ */

/**
 * Normalise a status string to a CSS-safe class name.
 *
 * @param  {string} status
 * @returns {string}
 */
function toStatusClass(status) {
    return status.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Render transaction cards into the transactions panel.
 * Uses .data-card classes consistent with admin panel design.
 *
 * @param {Array} transactions
 */
function displayClientTransactions(transactions) {
    const container  = document.getElementById('transactionsList');
    const countBadge = document.getElementById('currentTransactionCount');

    countBadge.textContent = transactions.length;

    if (!transactions?.length) {
        container.innerHTML = `
            <div class="empty-state" style="grid-column:1/-1;">
                <i class="bi bi-inbox"></i>
                <p>No transactions found</p>
            </div>`;
        return;
    }

    const isFinished = (s) => ['claimed', 'completed', 'cancelled'].includes(s);

    container.innerHTML = transactions.map((tx) => {
        const statusClass = toStatusClass(tx.status_name);
        const createdDate = new Date(tx.created_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
        });
        const updatedDate = new Date(tx.updated_at).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });

        const receiptBtn = (tx.status_name === 'claimed' || tx.status_name === 'completed')
            ? `<button class="btn-outline-sm btn-indigo"
                       onclick="generateClientReceipt(${tx.transaction_id})">
                   <i class="bi bi-file-earmark-pdf"></i> Receipt
               </button>`
            : '';

        const cancelBtn = !isFinished(tx.status_name)
            ? `<button class="btn-danger-sm"
                       onclick="showCancelTransactionModal(${tx.transaction_id})">
                   <i class="bi bi-x-circle"></i> Cancel
               </button>`
            : '';

        const noteRow = tx.service_description
            ? `<div class="data-card-note">
                   <i class="bi bi-info-circle" aria-hidden="true"></i>
                   <span>${tx.service_description}</span>
               </div>`
            : '';

        return `
        <div class="data-card">
            <div class="data-card-header">
                <div class="data-card-meta">
                    <span class="data-card-id">Transaction #${tx.transaction_id}</span>
                    <span class="data-card-date">${tx.service_name}</span>
                </div>
                <span class="status-chip status-${statusClass}">
                    ${tx.status_name.replace(/_/g, ' ')}
                </span>
            </div>

            <div class="data-card-rows">
                <div class="data-row">
                    <span class="data-row-label">Created</span>
                    <span class="data-row-val">${createdDate}</span>
                </div>
                <div class="data-row">
                    <span class="data-row-label">Updated</span>
                    <span class="data-row-val">${updatedDate}</span>
                </div>
            </div>

            ${noteRow}

            <div class="data-card-actions">
                <button class="btn-outline-sm btn-teal"
                        onclick="viewClientTimeline(${tx.transaction_id})">
                    <i class="bi bi-clock-history"></i> Timeline
                </button>
                ${receiptBtn}
                ${cancelBtn}
            </div>
        </div>`;
    }).join('');
}

/**
 * Fetch transactions and render them.
 *
 * @param {string} [status='all']
 */
async function fetchClientTransactions(status = 'all') {
    try {
        const res = await fetch(
            `${BASE_URL}/api/client/getClientTransactions/${status}`,
            { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
        );

        if (!res.ok) throw new Error('Failed to fetch transactions');

        displayClientTransactions(await res.json());
    } catch {
        showServerMessage('Failed to load transactions', 'error');
    }
}

/**
 * Apply a status filter to the transactions panel.
 *
 * @param {string} status
 * @param {Event}  [ev]  — click event (optional, used to activate the chip)
 */
async function filterClientTransactions(status, ev) {
    document
        .querySelectorAll('#transactionsPanel .filter-chip')
        .forEach((b) => b.classList.remove('active'));

    const target = ev?.target ?? document.querySelector(`#transactionsPanel .filter-chip[onclick*="'${status}'"]`);
    if (target) target.classList.add('active');

    document.getElementById('active-filter-transaction-button').value = status;
    document.getElementById('transactionSearch').value                = '';

    await fetchClientTransactions(status);
}


/** Debounced search handler for the transactions search input. */
async function searchDocumentTransaction() {
    clearTimeout(searchTimeout);

    const term   = document.getElementById('transactionSearch').value.trim();
    const status = document.getElementById('active-filter-transaction-button').value;

    if (term.length < 2) {
        await fetchClientTransactions(status);
        return;
    }

    searchTimeout = setTimeout(async () => {
        try {
            const res = await fetch(
                `${BASE_URL}/api/client/searchClientTransactions/${term}/${status}`,
                { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
            );

            if (res.ok) displayClientTransactions(await res.json());
        } catch {
            // silently ignore search errors
        }
    }, 300);
}

function showCancelTransactionModal(id) {
    document.getElementById('cancelTransactionId').value = id;
    document.getElementById('cancelReason').value        = '';
    cancelTransactionModal.show();
}

async function submitCancelTransaction() {
    const id     = document.getElementById('cancelTransactionId').value;
    const reason = document.getElementById('cancelReason').value.trim();

    if (reason.length < 10) {
        showAlertModal('Please provide a reason with at least 10 characters', 'warning');
        return;
    }

    cancelTransactionModal.hide();

    document.getElementById('cancelTransactionModal').addEventListener(
        'hidden.bs.modal',
        async function onHidden() {
            document
                .getElementById('cancelTransactionModal')
                .removeEventListener('hidden.bs.modal', onHidden);

            const confirmed = await window.confirm(
                'Are you sure you want to cancel this transaction? This action cannot be undone.',
            );

            if (!confirmed) {
                document.getElementById('cancelReason').value = reason;
                cancelTransactionModal.show();
                return;
            }

            try {
                const res = await fetch(`${BASE_URL}/api/client/cancelClientTransaction`, {
                    method:  'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization:  `Bearer ${localStorage.getItem('token')}`,
                    },
                    body: JSON.stringify({ transactionId: id, reason }),
                });

                const data           = await res.json();
                const currentStatus  = document.getElementById('active-filter-transaction-button').value;

                if (res.ok) {
                    showServerMessage(data.message, 'success');
                    await fetchClientTransactions(currentStatus);
                } else {
                    showAlertModal(data.message || 'Failed to cancel transaction', 'error');
                }
            } catch {
                showAlertModal('Failed to cancel transaction. Please try again.', 'error');
            }
        },
        { once: true },
    );
}


/* ═══════════════════════════════════════════════════════════
   TIMELINE
   ═══════════════════════════════════════════════════════════ */

/**
 * Fetch and display the processing timeline for a transaction.
 *
 * @param {number} transactionId
 */
async function viewClientTimeline(transactionId) {
    try {
        const res = await fetch(
            `${BASE_URL}/api/client/getClientTransactionTimeline/${transactionId}`,
            { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
        );

        if (!res.ok) throw new Error('Failed to load timeline');

        displayClientTimeline(await res.json());
        clientTimelineModal.show();
    } catch {
        showServerMessage('Failed to load timeline', 'error');
    }
}

/**
 * Render timeline items into the timeline modal.
 *
 * @param {Array} timeline
 */
function displayClientTimeline(timeline) {
    const container = document.getElementById('clientTimelineContent');

    if (!timeline?.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-clock"></i>
                <p>No timeline data</p>
            </div>`;
        return;
    }

    container.innerHTML =
        `<div class="timeline-wrap">` +
        timeline
            .map(
                (item, index) => `
                <div class="tl-item">
                    <div class="tl-left">
                        <div class="tl-dot ${index === 0 ? 'first' : ''}"></div>
                        <div class="tl-line"></div>
                    </div>
                    <div class="tl-body">
                        <div class="tl-status">${item.status_name}</div>
                        <div class="tl-date">
                            ${new Date(item.changed_at).toLocaleDateString('en-US', {
                                year: 'numeric', month: 'long', day: 'numeric',
                                hour: '2-digit', minute: '2-digit',
                            })}
                        </div>
                        <div class="tl-by">
                            <strong>By:</strong>
                            ${item.changed_by_first_name} ${item.changed_by_last_name}
                        </div>
                        ${item.remarks
                            ? `<div class="tl-remarks">
                                   <strong>Remarks:</strong> ${item.remarks}
                               </div>`
                            : ''}
                        ${item.photos?.length
                            ? `<div class="tl-photos">
                                   ${item.photos.map((p) =>
                                       `<a href="/${p.file_path}" target="_blank">
                                            <img src="/${p.file_path}" class="tl-photo">
                                        </a>`,
                                   ).join('')}
                               </div>`
                            : ''}
                    </div>
                </div>`,
            )
            .join('') +
        `</div>`;
}


/* ═══════════════════════════════════════════════════════════
   DASHBOARD
   ═══════════════════════════════════════════════════════════ */

async function initializeDashboard() {
    try {
        await Promise.all([
            fetchDashboardStats(),
            fetchRecentActivity(),
            fetchUpcomingAppointments(),
            fetchActiveTransactions(),
            fetchMonthlyOverview(),
        ]);
    } catch {
        showServerMessage('Failed to load dashboard data', 'error');
    }
}

async function fetchDashboardStats() {
    const res = await fetch(`${BASE_URL}/api/client/getDashboardStats`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    if (!res.ok) return;

    const stats = await res.json();

    ['totalAppointments', 'totalTransactions', 'pendingItems', 'completedItems'].forEach(
        (key) => animateCounter(key, stats[key] ?? 0),
    );
}

async function fetchRecentActivity() {
    const res = await fetch(`${BASE_URL}/api/client/getRecentActivity`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    if (res.ok) displayRecentActivity(await res.json());
}

async function fetchUpcomingAppointments() {
    const res = await fetch(`${BASE_URL}/api/client/getUpcomingAppointments`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    if (res.ok) displayUpcomingAppointments(await res.json());
}

async function fetchActiveTransactions() {
    const res = await fetch(`${BASE_URL}/api/client/getActiveTransactions`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    if (res.ok) displayActiveTransactions(await res.json());
}

async function fetchMonthlyOverview() {
    const res = await fetch(`${BASE_URL}/api/client/getMonthlyOverview`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });

    if (res.ok) displayMonthlyOverview(await res.json());
}

/**
 * Render the recent activity list on the dashboard.
 *
 * @param {Array} activities
 */
function displayRecentActivity(activities) {
    const container = document.getElementById('recentActivityList');

    if (!activities?.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-inbox"></i>
                <p>No recent activity</p>
            </div>`;
        return;
    }

    container.innerHTML = activities
        .map((a) => {
            const type = a.type.toLowerCase();
            const icon = ACTIVITY_ICONS[type] ?? 'info-circle';

            return `
                <div class="activity-item">
                    <div class="act-icon ${type}">
                        <i class="bi bi-${icon}"></i>
                    </div>
                    <div class="act-body">
                        <div class="act-title">${a.title}</div>
                        <div class="act-desc">${a.description}</div>
                        <div class="act-time">
                            <i class="bi bi-clock me-1"></i>
                            ${formatActivityTime(a.created_at)}
                        </div>
                    </div>
                </div>`;
        })
        .join('');
}

/**
 * Render upcoming appointments on the dashboard.
 *
 * @param {Array} appointments
 */
function displayUpcomingAppointments(appointments) {
    const container = document.getElementById('upcomingAppointmentsList');

    if (!appointments?.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-calendar-x"></i>
                <p>No upcoming appointments</p>
            </div>`;
        return;
    }

    container.innerHTML = appointments
        .slice(0, 5)
        .map((apt) => {
            const apptDate = new Date(apt.appointment_date).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
            });
            const serviceChips = (apt.services ?? [])
                .slice(0, 3)
                .map((s) => `<span class="mini-tag">${s}</span>`)
                .join('');
            const extra = apt.services?.length > 3
                ? `<span class="mini-tag">+${apt.services.length - 3}</span>`
                : '';

            return `
            <div class="data-card" style="gap:.4rem;">
                <div class="data-card-header">
                    <span class="data-card-id">Appt #${apt.appointment_id}</span>
                    <span style="font-size:.72rem;color:var(--accent);font-weight:600;">${apptDate}</span>
                </div>
                <div class="data-card-tags">${serviceChips}${extra}</div>
                <div class="data-row">
                    <span class="data-row-label"><i class="bi bi-clock"></i></span>
                    <span class="data-row-val">${formatTime(apt.appointment_time)}</span>
                </div>
            </div>`;
        })
        .join('');
}

/**
 * Render active transactions on the dashboard.
 * Uses .data-card / .data-row classes consistent with transactions panel.
 *
 * @param {Array} transactions
 */
function displayActiveTransactions(transactions) {
    const container = document.getElementById('activeTransactionsList');

    if (!transactions?.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="bi bi-file-earmark-x"></i>
                <p>No active transactions</p>
            </div>`;
        return;
    }

    container.innerHTML = transactions
        .slice(0, 5)
        .map((tx) => {
            const statusClass = toStatusClass(tx.status_name);
            const updatedDate = new Date(tx.updated_at).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
            });

            return `
            <div class="data-card" style="gap:.4rem;">
                <div class="data-card-header">
                    <div class="data-card-meta">
                        <span class="data-card-id">Txn #${tx.transaction_id}</span>
                    </div>
                    <span class="status-chip status-${statusClass}">
                        ${tx.status_name.replace(/_/g, ' ')}
                    </span>
                </div>
                <div class="data-card-tags">
                    <span class="mini-tag">${tx.service_name}</span>
                </div>
                <div class="data-row">
                    <span class="data-row-label"><i class="bi bi-calendar3"></i></span>
                    <span class="data-row-val">${updatedDate}</span>
                </div>
            </div>`;
        })
        .join('');
}

/**
 * Update the monthly overview progress bars.
 *
 * @param {Object} overview
 */
function displayMonthlyOverview(overview) {
    const APPT_GOAL  = 10;
    const TXN_GOAL   = 15;

    const apptCount  = overview.monthlyAppointments ?? 0;
    const txnCount   = overview.monthlyTransactions ?? 0;

    document.getElementById('monthlyAppointmentCount').textContent       = apptCount;
    document.getElementById('monthlyAppointmentProgress').style.width    = `${Math.min((apptCount / APPT_GOAL) * 100, 100)}%`;

    document.getElementById('monthlyTransactionCount').textContent       = txnCount;
    document.getElementById('monthlyTransactionProgress').style.width    = `${Math.min((txnCount / TXN_GOAL) * 100, 100)}%`;
}

/**
 * Animate a counter element from 0 to target.
 *
 * @param {string} elementId
 * @param {number} target
 */
function animateCounter(elementId, target) {
    const el      = document.getElementById(elementId);
    let   current = 0;

    const interval = setInterval(() => {
        current += target / 30;

        if (current >= target) {
            el.textContent = target;
            clearInterval(interval);
        } else {
            el.textContent = Math.floor(current);
        }
    }, 1000 / 30);
}

/**
 * Format a timestamp as a human-readable relative time.
 *
 * @param  {string} timestamp
 * @returns {string}
 */
function formatActivityTime(timestamp) {
    const date    = new Date(timestamp);
    const now     = new Date();
    const sec     = Math.floor((now - date) / 1000);
    const min     = Math.floor(sec / 60);
    const hr      = Math.floor(min / 60);
    const day     = Math.floor(hr / 24);

    if (sec < 60)  return 'Just now';
    if (min < 60)  return `${min}m ago`;
    if (hr < 24)   return `${hr}h ago`;
    if (day < 7)   return `${day}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


/* ═══════════════════════════════════════════════════════════
   CHANGE PASSWORD
   ═══════════════════════════════════════════════════════════ */

function showChangePasswordModal() {
    document.getElementById('currentPassword').value               = '';
    document.getElementById('newPassword').value                   = '';
    document.getElementById('confirmNewPassword').value            = '';
    document.getElementById('changePasswordMessage').style.display = 'none';
    changePasswordModal.show();
}

/**
 * Display an inline message in the change-password modal.
 *
 * @param {string}  message
 * @param {string}  [type='error']
 * @param {boolean} [autoHide=true]
 */
function showChangePasswordMessage(message, type = 'error', autoHide = true) {
    const box  = document.getElementById('changePasswordMessage');
    const text = document.getElementById('changePasswordMsgText');

    box.classList.remove('alert-success', 'alert-danger');
    box.classList.add(type === 'success' ? 'alert-success' : 'alert-danger');

    text.textContent  = message;
    box.style.display = 'block';

    if (autoHide) setTimeout(() => { box.style.display = 'none'; }, 6000);
}

async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword     = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmNewPassword').value;

    if (newPassword !== confirmPassword) {
        showChangePasswordMessage('New passwords do not match', 'error');
        return;
    }

    if (newPassword.length < 12 || newPassword.length > 24) {
        showChangePasswordMessage('Password length must be 12–24 characters', 'error');
        return;
    }

    const res = await fetch('/api/client/changePassword', {
        method:  'PUT',
        headers: {
            'Content-Type': 'application/json',
            Authorization:  `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
    });

    const data = await res.json();

    if (res.ok) {
        showServerMessage(data.message, 'success');
        changePasswordModal.hide();
    } else {
        showChangePasswordMessage(data.message, 'error');
    }
}


/* ═══════════════════════════════════════════════════════════
   RECEIPT / PDF GENERATION
   ═══════════════════════════════════════════════════════════ */

async function generateClientReceipt(transactionId) {
    try {
        showServerMessage('Generating your receipt…', 'info');

        const res = await fetch(
            `${BASE_URL}/api/client/getTransactionReceipt/${transactionId}`,
            { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
        );

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.message || 'Failed to fetch receipt data');
        }

        await downloadReceiptAsPDF(await res.json());
        showServerMessage('Receipt downloaded successfully!', 'success');

    } catch (err) {
        showServerMessage(err.message || 'Failed to generate receipt', 'error');
    }
}

async function downloadReceiptAsPDF(data) {
    const { transaction, timeline, appointment } = data;
    const { jsPDF }     = window.jspdf;
    const doc           = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth     = doc.internal.pageSize.getWidth();
    const pageHeight    = doc.internal.pageSize.getHeight();
    const margin        = 15;
    const contentWidth  = pageWidth - margin * 2;
    let   yPos          = margin;

    // ── Helpers ──────────────────────────────────────────
    const addText = (text, x, y, opts = {}) => {
        const fontSize  = opts.fontSize  ?? 10;
        const fontStyle = opts.fontStyle ?? 'normal';
        const align     = opts.align     ?? 'left';

        doc.setFontSize(fontSize);
        doc.setFont('helvetica', fontStyle);

        if (align === 'center') {
            doc.text(text, pageWidth / 2, y, { align: 'center' });
        } else if (align === 'right') {
            doc.text(text, pageWidth - margin, y, { align: 'right' });
        } else {
            const lines = doc.splitTextToSize(text, opts.maxWidth ?? contentWidth);
            doc.text(lines, x, y);
            return lines.length * (fontSize * 0.35);
        }

        return fontSize * 0.35;
    };

    const drawLine = (y, thickness = 0.5) => {
        doc.setLineWidth(thickness);
        doc.line(margin, y, pageWidth - margin, y);
    };

    const addSection = (title) => {
        yPos += 8;
        doc.setFillColor(240, 240, 240);
        doc.rect(margin, yPos - 5, contentWidth, 8, 'F');
        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(title, margin + 2, yPos);
        yPos += 8;
    };

    // ── Logo ─────────────────────────────────────────────
    doc.setFillColor(37, 99, 235);
    doc.circle(pageWidth / 2, yPos + 10, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('RC', pageWidth / 2, yPos + 12, { align: 'center' });
    yPos += 25;
    doc.setTextColor(0, 0, 0);

    // ── Header ────────────────────────────────────────────
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('RandC Documentation Services', pageWidth / 2, yPos, { align: 'center' });
    yPos += 6;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Professional Document Processing Solutions', pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;
    drawLine(yPos, 1);
    yPos += 8;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('TRANSACTION RECEIPT', pageWidth / 2, yPos, { align: 'center' });
    yPos += 8;
    drawLine(yPos, 0.5);
    yPos += 8;

    // ── Transaction Summary Box ───────────────────────────
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, yPos, contentWidth, 20, 2, 2, 'S');

    const summaryRows = [
        ['Transaction ID:',  `#${transaction.transaction_id}`, 6],
        ['Status:',          null,                             12],
        ['Receipt Date:',
            new Date().toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
            }),
            18,
        ],
    ];

    for (const [label, value, offsetY] of summaryRows) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(label, margin + 5, yPos + offsetY);

        if (label === 'Status:') {
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(16, 185, 129);
            doc.text(transaction.current_status.toUpperCase(), margin + 45, yPos + offsetY);
            doc.setTextColor(0, 0, 0);
        } else {
            doc.setFont('helvetica', 'normal');
            doc.text(value, margin + 45, yPos + offsetY);
        }
    }

    yPos += 25;

    // ── Client Information ────────────────────────────────
    addSection('CLIENT INFORMATION');

    const clientRows = [
        ['Name:',    `${transaction.first_name} ${transaction.middle_name ?? ''} ${transaction.last_name}`],
        ['Email:',   transaction.email],
        ['Contact:', transaction.phone_number || 'Not provided'],
    ];

    for (const [label, value] of clientRows) {
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(label, margin + 5, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(value, margin + 35, yPos);
        yPos += 6;
    }

    // ── Service Information ───────────────────────────────
    addSection('SERVICE INFORMATION');

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Service:', margin + 5, yPos);
    doc.setFont('helvetica', 'normal');
    doc.text(transaction.service_name, margin + 35, yPos);
    yPos += 6;

    if (transaction.service_description) {
        doc.setFont('helvetica', 'bold');
        doc.text('Description:', margin + 5, yPos);
        doc.setFont('helvetica', 'normal');
        const descHeight = addText(transaction.service_description, margin + 35, yPos, {
            maxWidth: contentWidth - 35,
        });
        yPos += descHeight + 3;
    }

    // ── Processing Timeline ───────────────────────────────
    addSection('PROCESSING TIMELINE');

    const submitted = timeline.find((t) => t.status_name === 'submitted');
    const claimed   = timeline.find((t) => t.status_name === 'claimed' || t.status_name === 'completed');

    doc.setFontSize(9);

    if (submitted) {
        doc.setFont('helvetica', 'bold');
        doc.text('• Submitted:', margin + 5, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(
            new Date(submitted.changed_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            }),
            margin + 35,
            yPos,
        );
        yPos += 5;
    }

    if (claimed) {
        doc.setFont('helvetica', 'bold');
        doc.text('• Claimed:', margin + 5, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(
            new Date(claimed.changed_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit',
            }),
            margin + 35,
            yPos,
        );
        yPos += 5;
    }

    if (submitted && claimed) {
        const days = Math.ceil(
            (new Date(claimed.changed_at) - new Date(submitted.changed_at)) / (1000 * 60 * 60 * 24),
        );

        doc.setFont('helvetica', 'bold');
        doc.text('• Processing Time:', margin + 5, yPos);
        doc.setFont('helvetica', 'normal');
        doc.text(`${days} day${days !== 1 ? 's' : ''}`, margin + 35, yPos);
        yPos += 5;
    }

    // ── Related Appointment ───────────────────────────────
    if (appointment) {
        addSection('RELATED APPOINTMENT');

        doc.setFontSize(10);

        const aptRows = [
            ['Appointment ID:', `#${appointment.appointment_id}`],
            [
                'Date & Time:',
                `${new Date(appointment.appointment_date).toLocaleDateString('en-US', {
                    year: 'numeric', month: 'long', day: 'numeric',
                })} at ${appointment.appointment_time}`,
            ],
        ];

        for (const [label, value] of aptRows) {
            doc.setFont('helvetica', 'bold');
            doc.text(label, margin + 5, yPos);
            doc.setFont('helvetica', 'normal');
            doc.text(value, margin + 45, yPos);
            yPos += 6;
        }
    }

    // ── Important Notes ───────────────────────────────────
    addSection('IMPORTANT NOTES');

    const notes = [
        '• This receipt confirms your document has been successfully processed and claimed.',
        '• Please keep this receipt for your records.',
        '• For any inquiries, please contact us with your Transaction ID.',
        '• This is a computer-generated receipt and is valid without signature.',
    ];

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');

    for (const note of notes) {
        const h = addText(note, margin + 5, yPos, { fontSize: 9, maxWidth: contentWidth - 5 });
        yPos += h + 2;
    }

    yPos += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.text(
        `Processed by: ${transaction.processed_by_first_name} ${transaction.processed_by_last_name}`,
        margin + 5,
        yPos,
    );

    // ── Footer ────────────────────────────────────────────
    yPos = pageHeight - 25;
    drawLine(yPos, 0.5);
    yPos += 5;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('RandC Documentation Services', pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Thank you for trusting our services!', pageWidth / 2, yPos, { align: 'center' });
    yPos += 4;

    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 100, 100);
    doc.text(
        `Generated: ${new Date().toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        })}`,
        pageWidth / 2,
        yPos,
        { align: 'center' },
    );
    yPos += 4;

    doc.text(
        `Document Reference: TR-${transaction.transaction_id}-${new Date().getFullYear()}`,
        pageWidth / 2,
        yPos,
        { align: 'center' },
    );

    doc.save(
        `Transaction_Receipt_${transaction.transaction_id}_${new Date().toISOString().split('T')[0]}.pdf`,
    );
}


/* ═══════════════════════════════════════════════════════════
   CHAT UI HELPERS
   ═══════════════════════════════════════════════════════════ */

/**
 * Auto-resize a textarea based on its content.
 *
 * @param {HTMLTextAreaElement} el
 */
function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}


/* ═══════════════════════════════════════════════════════════
   INITIALISATION
   ═══════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
    // Bootstrap modal instances
    logoutModal                  = new bootstrap.Modal(document.getElementById('logoutModal'));
    changePasswordModal          = new bootstrap.Modal(document.getElementById('changePasswordModal'));
    updateAppointmentStatusModal = new bootstrap.Modal(document.getElementById('updateAppointmentStatusModal'));
    clientTimelineModal          = new bootstrap.Modal(document.getElementById('clientTimelineModal'));
    cancelTransactionModal       = new bootstrap.Modal(document.getElementById('cancelTransactionModal'));
    alertModal                   = new bootstrap.Modal(document.getElementById('alertModal'));
    confirmModal                 = new bootstrap.Modal(document.getElementById('confirmModal'));

    // Appointment date minimum (tomorrow)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    document.getElementById('appointmentDate').setAttribute(
        'min',
        tomorrow.toISOString().split('T')[0],
    );

    // Date change → load time slots
    document.getElementById('appointmentDate').addEventListener('change', function () {
        if (this.value) {
            fetchAvailableTimeSlots(this.value);
            selectedTimeSlot = null;
        }
    });

    // Setup account form
    document.getElementById('setupUserForm').addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = {
            firstName:     document.getElementById('firstName').value.trim(),
            lastName:      document.getElementById('lastName').value.trim(),
            middleName:    document.getElementById('middleName').value.trim(),
            sex:           document.getElementById('sex').value,
            contactNumber: document.getElementById('contactNumber').value.trim(),
        };

        if (!formData.firstName || !formData.lastName || !formData.sex) {
            showAlertModal('Please fill in all required fields.', 'warning');
            return;
        }
        await submitUserInfo(formData);
    });

    // Restore sidebar collapse state
    restoreSidebarState();

    // Boot the dashboard
    initializeUser();
});