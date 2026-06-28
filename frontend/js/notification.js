(function injectToastStyles() {
  if (document.getElementById('toast-notification-styles')) return;

  const style = document.createElement('style');
  style.id = 'toast-notification-styles';
  style.textContent = `
    /* ── Global toast stack (top-right, above modals) ── */
    #global-toast-container {
      position: fixed;
      top: 1.25rem;
      right: 1.25rem;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      pointer-events: none;
    }

    /* ── Modal-anchored toast (top of modal body) ── */
    .modal-toast-container {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
      pointer-events: none;
    }

    /* ── Base toast pill ── */
    .toast-pill {
      pointer-events: all;
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      min-width: 260px;
      max-width: 380px;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 0.875rem;
      line-height: 1.45;
      box-shadow:
        0 4px 16px rgba(0,0,0,0.14),
        0 1px 4px rgba(0,0,0,0.08);
      border-left: 4px solid transparent;
      background: #fff;
      color: #1e293b;
      opacity: 0;
      transform: translateX(24px);
      transition:
        opacity 0.28s cubic-bezier(.4,0,.2,1),
        transform 0.28s cubic-bezier(.4,0,.2,1);
      will-change: opacity, transform;
    }

    /* ── Visible state ── */
    .toast-pill.toast-show {
      opacity: 1;
      transform: translateX(0);
    }

    /* ── Exiting state ── */
    .toast-pill.toast-hide {
      opacity: 0;
      transform: translateX(24px);
    }

    /* ── Modal-anchored: slide down instead ── */
    .modal-toast-container .toast-pill {
      transform: translateY(-12px);
      max-width: 100%;
    }
    .modal-toast-container .toast-pill.toast-show {
      transform: translateY(0);
    }
    .modal-toast-container .toast-pill.toast-hide {
      transform: translateY(-12px);
    }

    /* ── Type variants ── */
    .toast-pill.toast-success {
      border-left-color: #16a34a;
      background: #f0fdf4;
    }
    .toast-pill.toast-success .toast-icon { color: #16a34a; }

    .toast-pill.toast-error {
      border-left-color: #dc2626;
      background: #fef2f2;
    }
    .toast-pill.toast-error .toast-icon { color: #dc2626; }

    .toast-pill.toast-warning {
      border-left-color: #d97706;
      background: #fffbeb;
    }
    .toast-pill.toast-warning .toast-icon { color: #d97706; }

    .toast-pill.toast-info {
      border-left-color: #2563eb;
      background: #eff6ff;
    }
    .toast-pill.toast-info .toast-icon { color: #2563eb; }

    /* ── Icon ── */
    .toast-icon {
      font-size: 1.1rem;
      flex-shrink: 0;
      margin-top: 1px;
    }

    /* ── Body ── */
    .toast-body {
      flex: 1;
    }
    .toast-body strong {
      display: block;
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 2px;
      opacity: 0.65;
    }

    /* ── Close button ── */
    .toast-close {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1rem;
      color: #94a3b8;
      padding: 0;
      line-height: 1;
      flex-shrink: 0;
      margin-top: 1px;
      transition: color 0.15s;
    }
    .toast-close:hover { color: #475569; }

    /* ── Progress bar ── */
    .toast-progress {
      position: absolute;
      bottom: 0;
      left: 0;
      height: 3px;
      border-radius: 0 0 10px 10px;
      width: 100%;
      transform-origin: left;
      animation: toastProgress linear forwards;
    }
    .toast-pill { position: relative; overflow: hidden; }

    .toast-success .toast-progress  { background: #16a34a; }
    .toast-error   .toast-progress  { background: #dc2626; }
    .toast-warning .toast-progress  { background: #d97706; }
    .toast-info    .toast-progress  { background: #2563eb; }

    @keyframes toastProgress {
      from { transform: scaleX(1); }
      to   { transform: scaleX(0); }
    }
  `;
  document.head.appendChild(style);
})();

const _toastIcons = {
  success: '<i class="bi bi-check-circle-fill toast-icon"></i>',
  error:   '<i class="bi bi-x-circle-fill toast-icon"></i>',
  warning: '<i class="bi bi-exclamation-triangle-fill toast-icon"></i>',
  info:    '<i class="bi bi-info-circle-fill toast-icon"></i>',
};

const _toastLabels = {
  success: 'Success',
  error:   'Error',
  warning: 'Warning',
  info:    'Info',
};

function showNotificationMessage(message, type = 'info', containerId = null, duration = 5000) {
  const validTypes = ['success', 'error', 'warning', 'info'];
  if (!validTypes.includes(type)) type = 'info';

  /* Resolve container */
  let container = null;

  if (containerId) {
    /* Look for an open modal first */
    const modalEl = document.getElementById(containerId);
    if (modalEl) {
      const modalBody = modalEl.querySelector('.modal-body');
      if (modalBody) {
        container = modalBody.querySelector('.modal-toast-container');
        if (!container) {
          container = document.createElement('div');
          container.className = 'modal-toast-container';
          modalBody.insertBefore(container, modalBody.firstChild);
        }
      }
    }
  }

  /* Fall back to global container */
  if (!container) {
    container = document.getElementById('global-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'global-toast-container';
      document.body.appendChild(container);
    }
  }

  /* Build pill */
  const pill = document.createElement('div');
  pill.className = `toast-pill toast-${type}`;
  pill.setAttribute('role', 'alert');
  pill.setAttribute('aria-live', 'assertive');

  pill.innerHTML = `
    ${_toastIcons[type] || ''}
    <div class="toast-body">
      <strong>${_toastLabels[type]}</strong>
      ${message}
    </div>
    <button class="toast-close" aria-label="Close">&times;</button>
    <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
  `;

  container.appendChild(pill);

  /* Animate in */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => pill.classList.add('toast-show'));
  });

  /* Dismiss helper */
  function dismiss() {
    pill.classList.remove('toast-show');
    pill.classList.add('toast-hide');
    pill.addEventListener('transitionend', () => {
      pill.remove();
      /* Clean up empty modal container */
      if (container.classList.contains('modal-toast-container') && !container.children.length) {
        container.remove();
      }
    }, { once: true });
  }

  /* Close button */
  pill.querySelector('.toast-close').addEventListener('click', dismiss);

  /* Auto-dismiss */
  const timer = setTimeout(dismiss, duration);

  /* Pause progress on hover */
  pill.addEventListener('mouseenter', () => {
    clearTimeout(timer);
    const progress = pill.querySelector('.toast-progress');
    if (progress) progress.style.animationPlayState = 'paused';
  });
  pill.addEventListener('mouseleave', () => {
    const progress = pill.querySelector('.toast-progress');
    if (progress) {
      progress.style.animationPlayState = 'running';
      setTimeout(dismiss, duration * parseFloat(getComputedStyle(progress).transform.split(',')[0].replace('matrix(', '')) * duration);
    }
  });

  return { dismiss };
}