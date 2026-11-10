const SAFE = Symbol('safe-html');

export function raw(value) {
  return { [SAFE]: String(value) };
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

function flatten(value) {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'object' && SAFE in value) return value[SAFE];
  if (Array.isArray(value)) return value.map(flatten).join('');
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let output = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    output += flatten(values[index]) + strings[index + 1];
  }
  return raw(output);
}

export function renderInto(element, markup) {
  element.innerHTML = flatten(markup);
}

export function icon(name, { size = 18, className = '' } = {}) {
  const paths = ICONS[name] || ICONS.file;
  return raw(
    `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`,
  );
}

const ICONS = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1.8"/><rect x="14" y="3" width="7" height="7" rx="1.8"/><rect x="3" y="14" width="7" height="7" rx="1.8"/><rect x="14" y="14" width="7" height="7" rx="1.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  activity:
    '<path d="M3 12h4l2.4-7 4.2 14 2.4-7H21"/>',
  library:
    '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z"/><path d="M4 5.5v13"/><path d="M8 7h8M8 11h5"/>',
  settings:
    '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  logout: '<path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4"/><path d="M15 8l4 4-4 4M19 12H9"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.8 5 3.2-5 3.2z"/>',
  download: '<path d="M12 3v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M5 20h14"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>',
  chevronDown: '<path d="m5 9 7 7 7-7"/>',
  chevronLeft: '<path d="m15 5-7 7 7 7"/>',
  check: '<path d="m5 12 4.2 4.2L19 6.5"/>',
  alert: '<path d="M12 3 2.7 20h18.6z"/><path d="M12 9v5M12 17.5v.1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  hardDrive: '<rect x="3" y="5" width="18" height="6" rx="2"/><rect x="3" y="13" width="18" height="6" rx="2"/><path d="M7 8h.1M7 16h.1"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
  shield: '<path d="M12 3 4.5 6v5c0 4.8 3.2 8.3 7.5 10 4.3-1.7 7.5-5.2 7.5-10V6z"/><path d="m9 12 2 2 4-4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14"/><path d="M10 11v6M14 11v6"/>',
  upload: '<path d="M12 17V5"/><path d="m7.5 9.5 4.5-4.5 4.5 4.5"/><path d="M5 20h14"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>',
  fileText: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5M9 12h6M9 16h6"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
  rotate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  wifi: '<path d="M3.5 9.5a13 13 0 0 1 17 0M6.5 13a8.5 8.5 0 0 1 11 0M9.5 16.5a4 4 0 0 1 5 0M12 20h.1"/>',
  wifiOff: '<path d="m3 3 18 18M8.5 13a8 8 0 0 1 3-1.7M5 9.5A13 13 0 0 1 8 8M16 8.4a13 13 0 0 1 4.5 1.1M12 20h.1"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 6A10.8 10.8 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.9M6.2 6.4A17.6 17.6 0 0 0 2.5 12S6 18.5 12 18.5c1.5 0 2.8-.4 3.9-1"/>',
  sparkles: '<path d="m12 3 1.3 4.2L17.5 8.5l-4.2 1.3L12 14l-1.3-4.2-4.2-1.3 4.2-1.3z"/><path d="m18.5 14 .7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z"/>',
  arrowRight: '<path d="M4 12h16"/><path d="m14 6 6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.1"/>',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  arrowUpRight: '<path d="M7 17 17 7M8 7h9v9"/>',
  minus: '<path d="M5 12h14"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
};

export function logoMark(size = 34) {
  return raw(
    `<svg width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="#9be9c4"/><path d="M10 7.5h12v18l-6-4.2-6 4.2z" fill="#0a0d11"/><path d="M13 12h6" stroke="#9be9c4" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  );
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const scaled = value / 1024 ** exponent;
  return `${scaled.toFixed(exponent === 0 || scaled >= 10 ? 0 : 1)} ${units[exponent]}`;
}

export function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

export function fullDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function shortDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

export function relativeTime(iso) {
  if (!iso) return '—';
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return '—';
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return shortDate(iso);
}

export function durationBetween(start, end) {
  if (!start) return '—';
  const from = new Date(start).getTime();
  const to = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return '—';
  const seconds = Math.floor((to - from) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function plural(count, singular, pluralForm = `${singular}s`) {
  return Number(count) === 1 ? singular : pluralForm;
}

const STATUS = {
  queued: { label: 'Queued', tone: 'muted' },
  running: { label: 'Downloading', tone: 'active' },
  cancelling: { label: 'Cancelling', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
};

export function statusMeta(status) {
  return STATUS[status] || { label: status || 'Unknown', tone: 'muted' };
}

export function statusBadge(status, { withIcon = false } = {}) {
  const meta = statusMeta(status);
  const isBusy = status === 'running' || status === 'cancelling';
  const dot = isBusy
    ? '<span class="status-dot status-dot--pulse"></span>'
    : '<span class="status-dot"></span>';
  return html`<span class="status-badge status-badge--${meta.tone}">${raw(dot)}${withIcon ? icon(status === 'completed' ? 'check' : status === 'failed' ? 'alert' : 'clock', { size: 13 }) : ''}<span>${meta.label}</span></span>`;
}

export function progressBar(value, { thin = false } = {}) {
  const progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return html`<progress class="progress ${thin ? 'progress--thin' : ''}" max="100" value="${progress}" aria-label="Download progress">${progress}%</progress>`;
}

export function jobTypeIcon(type) {
  return type === 'course' ? icon('video', { size: 17 }) : icon('book', { size: 17 });
}

export function libraryFileUrl(relativePath, { download = false } = {}) {
  const params = new URLSearchParams({ path: relativePath });
  if (download) params.set('download', '1');
  return `/api/library/file?${params.toString()}`;
}

export function setButtonLoading(button, loading, label = 'Working…') {
  if (!button) return;
  if (loading) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.classList.add('is-loading');
    button.innerHTML = `<span class="spinner spinner--small"></span><span>${escapeHtml(label)}</span>`;
  } else {
    button.disabled = false;
    button.classList.remove('is-loading');
    if (button.dataset.originalHtml) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

export function toast(message, tone = 'info', timeout = 4800) {
  const region = document.getElementById('toasts');
  if (!region) return;
  const element = document.createElement('div');
  element.className = `toast toast--${tone}`;
  element.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  const iconName =
    tone === 'success' ? 'check' : tone === 'error' ? 'alert' : tone === 'warning' ? 'alert' : 'info';
  element.innerHTML = `<span class="toast__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[iconName]}</svg></span><span class="toast__message"></span><button class="toast__close" type="button" aria-label="Dismiss notification"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">${ICONS.x}</svg></button>`;
  element.querySelector('.toast__message').textContent = message;
  const remove = () => {
    element.classList.add('toast--leaving');
    setTimeout(() => element.remove(), 180);
  };
  element.querySelector('.toast__close').addEventListener('click', remove);
  region.append(element);
  requestAnimationFrame(() => element.classList.add('toast--visible'));
  if (timeout > 0) setTimeout(remove, timeout);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    return copied;
  }
}

let modalCounter = 0;

export function openModal({ title, eyebrow = '', body, footer = '', size = 'normal', onMount }) {
  const root = document.getElementById('modal-root');
  const previousFocus = document.activeElement;
  const id = `modal-${(modalCounter += 1)}`;
  const wrapper = document.createElement('div');
  wrapper.className = 'modal-backdrop';
  wrapper.innerHTML = `
    <section class="modal modal--${size}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
      <header class="modal__header">
        <div>
          ${eyebrow ? `<p class="eyebrow">${escapeHtml(eyebrow)}</p>` : ''}
          <h2 class="modal__title" id="${id}-title">${escapeHtml(title)}</h2>
        </div>
        <button class="icon-button" type="button" data-modal-close aria-label="Close dialog">${ICONS.x}</button>
      </header>
      <div class="modal__body">${body[SAFE]}</div>
      ${footer ? `<footer class="modal__footer">${footer[SAFE]}</footer>` : ''}
    </section>`;
  const close = () => {
    if (!wrapper.isConnected) return;
    wrapper.classList.remove('is-open');
    document.removeEventListener('keydown', onKeyDown);
    setTimeout(() => {
      wrapper.remove();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    }, 160);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key === 'Tab') {
      const focusable = [
        ...wrapper.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  wrapper.addEventListener('click', (event) => {
    if (event.target === wrapper) close();
    if (event.target.closest('[data-modal-close]')) close();
  });
  root.append(wrapper);
  document.addEventListener('keydown', onKeyDown);
  requestAnimationFrame(() => wrapper.classList.add('is-open'));
  setTimeout(() => {
    const focusable = wrapper.querySelector(
      'textarea, input, button:not([data-modal-close]), [href]',
    );
    if (focusable) focusable.focus();
  }, 40);
  if (onMount) onMount(wrapper, close);
  return { close, element: wrapper };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'danger' }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value, close) => {
      if (settled) return;
      settled = true;
      close();
      resolve(value);
    };
    const { close } = openModal({
      title,
      eyebrow: 'Please confirm',
      size: 'small',
      body: html`<p class="muted">${message}</p>`,
      footer: html`<button class="button button--ghost" type="button" data-confirm-cancel>Cancel</button><button class="button button--${tone}" type="button" data-confirm-ok>${confirmLabel}</button>`,
      onMount(wrapper, closeModal) {
        wrapper.querySelector('[data-confirm-cancel]').addEventListener('click', () => settle(false, closeModal));
        wrapper.querySelector('[data-confirm-ok]').addEventListener('click', () => settle(true, closeModal));
        wrapper.addEventListener('click', (event) => {
          if (event.target === wrapper) settle(false, closeModal);
        });
      },
    });
    const observer = new MutationObserver(() => {
      if (!document.body.contains(document.querySelector('.modal-backdrop'))) {
        observer.disconnect();
        if (!settled) {
          settled = true;
          resolve(false);
        }
      }
    });
    observer.observe(document.getElementById('modal-root'), { childList: true });
  });
}

export function logLevel(line) {
  const value = String(line);
  if (value.startsWith('[shelf]')) return 'system';
  if (/\b(error|failed|unable|authentication issue|expired|invalid)\b/i.test(value) && !/failed:\s*0\b/i.test(value)) {
    return 'error';
  }
  if (/\b(warning|warn|already exists|skipping)\b/i.test(value)) return 'warning';
  if (/\b(complete|successfully|downloaded:|saved)\b/i.test(value)) return 'success';
  return 'default';
}

export function courseFileIcon(kind) {
  if (kind === 'video') return icon('video', { size: 16 });
  if (kind === 'transcript') return icon('fileText', { size: 16 });
  if (kind === 'pdf') return icon('book', { size: 16 });
  if (kind === 'audio') return icon('activity', { size: 16 });
  return icon('file', { size: 16 });
}

export function debounce(fn, delay = 180) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
