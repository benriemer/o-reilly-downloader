import { api, onUnauthorized } from './api.js';
import { emptyState, pageHeader } from './components.js';
import { html, icon, logoMark, renderInto, toast } from './ui.js';
import { downloadView } from './views/download.js';
import { jobsView } from './views/jobs.js';
import { libraryView } from './views/library.js';
import { renderLogin } from './views/login.js';
import { overviewView } from './views/overview.js';
import { settingsView } from './views/settings.js';

const ROUTES = [
  { pattern: /^\/$/, view: overviewView, label: 'Overview' },
  { pattern: /^\/download$/, view: downloadView, label: 'New download' },
  { pattern: /^\/jobs$/, view: jobsView, label: 'Activity' },
  { pattern: /^\/library$/, view: libraryView, label: 'Library' },
  { pattern: /^\/settings$/, view: settingsView, label: 'Settings' },
];

const appRoot = document.getElementById('app');
const STATUS_POLL_MS = 25_000;

let currentSession = null;
let currentController = null;
let currentCleanup = null;
let statusState = { worker: null, auth: null };
let statusTimer = null;

const notFoundView = {
  id: 'not-found',
  title: 'Not found',
  async mount(root) {
    document.title = 'Not found · Shelf';
    renderInto(
      root,
      html`
        <div class="view">
          ${pageHeader({
            eyebrow: '404',
            title: 'This shelf is empty.',
            description: 'The page you were looking for does not exist.',
          })}
          ${emptyState({
            iconName: 'search',
            title: 'Page not found',
            description: 'Check the address, or head back to your download activity.',
            action: html`<a class="button button--secondary button--small" href="/">${icon('overview', { size: 15 })}Back to overview</a>`,
          })}
        </div>
      `,
    );
  },
};

function normalisePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

function matchRoute(pathname) {
  const path = normalisePath(pathname);
  for (const route of ROUTES) {
    const match = route.pattern.exec(path);
    if (match) return { ...route, params: {}, path };
  }
  const jobMatch = /^\/jobs\/([a-f0-9]{6,32})$/.exec(path);
  if (jobMatch) {
    return {
      view: jobsView,
      label: 'Job detail',
      params: { id: jobMatch[1] },
      path,
    };
  }
  return { view: notFoundView, label: 'Not found', params: {}, path };
}

function navItem({ href, label, iconName, match }) {
  return html`
    <a class="nav-link" href="${href}" data-nav-link data-nav-match="${match}">
      <span class="nav-link__icon">${icon(iconName, { size: 18 })}</span>
      <span>${label}</span>
      <span class="nav-link__active-mark" aria-hidden="true"></span>
    </a>
  `;
}

function shellMarkup(session) {
  const passwordProtected = Boolean(session.auth?.required);
  return html`
    <div class="shell">
      <div class="shell__scrim" data-nav-close></div>

      <aside class="sidebar" data-sidebar aria-label="Primary navigation">
        <a class="sidebar__brand" href="/" data-nav-link>
          ${logoMark(36)}
          <span class="sidebar__brand-copy">
            <strong>Shelf</strong>
            <span>O'Reilly library</span>
          </span>
        </a>

        <nav class="sidebar__nav" aria-label="Workspace">
          <p class="sidebar__label">Workspace</p>
          ${navItem({ href: '/', label: 'Overview', iconName: 'overview', match: 'overview' })}
          ${navItem({ href: '/download', label: 'New download', iconName: 'plus', match: 'download' })}
          ${navItem({ href: '/jobs', label: 'Activity', iconName: 'activity', match: 'jobs' })}
          ${navItem({ href: '/library', label: 'Library', iconName: 'library', match: 'library' })}
        </nav>

        <div class="sidebar__nav sidebar__nav--secondary">
          <p class="sidebar__label">Instance</p>
          ${navItem({ href: '/settings', label: 'Settings', iconName: 'settings', match: 'settings' })}
        </div>

        <div class="sidebar__spacer"></div>

        <section class="sidebar__panel" aria-label="Service status">
          <p class="sidebar__label">Status</p>
          <div class="status-line" data-worker-status title="Downloader service status">
            <span class="status-dot status-dot--warning" data-worker-dot></span>
            <span class="status-line__label">Downloader</span>
            <span class="status-line__value" data-worker-label>Checking</span>
          </div>
          <div class="status-line" data-auth-status title="Cookie readiness">
            <span class="status-dot status-dot--warning" data-auth-dot></span>
            <span class="status-line__label">Cookies</span>
            <span class="status-line__value" data-auth-label>Checking</span>
          </div>
          <a class="sidebar__status-link" href="/settings">
            ${icon('shield', { size: 14 })}
            <span>Private, local-first</span>
          </a>
        </section>

        <div class="sidebar__footer">
          <span class="sidebar__version">Shelf ${session.app?.version || '1.0.0'}</span>
          ${passwordProtected
            ? html`<button class="sidebar__logout" type="button" data-shell-logout>
                ${icon('logout', { size: 15 })}
                <span>Sign out</span>
              </button>`
            : html`<span class="sidebar__mode">${icon('lock', { size: 13 })}Local only</span>`}
        </div>
      </aside>

      <div class="shell__body">
        <header class="topbar">
          <button class="icon-button topbar__menu" type="button" data-nav-toggle aria-label="Open navigation" aria-expanded="false">
            ${icon('menu', { size: 18 })}
          </button>
          <div class="topbar__context">
            <span class="topbar__eyebrow" data-context-eyebrow>Workspace</span>
            <span class="topbar__title" data-context-title>Overview</span>
          </div>
          <div class="topbar__actions">
            <span class="connection-pill connection-pill--checking" data-worker-pill title="Downloader service status">
              <span data-worker-pill-icon>${icon('wifi', { size: 14 })}</span>
              <span data-worker-pill-label>Checking</span>
            </span>
            <a class="button button--secondary button--small topbar__download" href="/download">
              ${icon('plus', { size: 15 })}<span>New download</span>
            </a>
            ${passwordProtected
              ? html`<button class="icon-button topbar__logout" type="button" data-shell-logout aria-label="Sign out" title="Sign out">
                  ${icon('logout', { size: 17 })}
                </button>`
              : ''}
          </div>
        </header>

        <main class="main" id="main" tabindex="-1">
          <div id="view-root"></div>
        </main>
      </div>
    </div>
  `;
}

function paintStatus() {
  const worker = statusState.worker;
  const auth = statusState.auth;
  const online = worker?.online === true;
  const known = worker != null;

  document.querySelectorAll('[data-worker-dot]').forEach((dot) => {
    dot.className = `status-dot ${
      online ? 'status-dot--success' : known ? 'status-dot--danger' : 'status-dot--warning'
    }`;
  });
  document.querySelectorAll('[data-worker-label]').forEach((label) => {
    label.textContent = online ? 'Online' : known ? 'Offline' : 'Checking';
  });
  document.querySelectorAll('[data-worker-status]').forEach((element) => {
    element.title = online
      ? `Downloader online${worker.version ? ` · v${worker.version}` : ''}`
      : known
        ? 'Downloader service is unreachable'
        : 'Checking the downloader service';
  });

  const pill = document.querySelector('[data-worker-pill]');
  if (pill) {
    pill.className = `connection-pill ${
      online
        ? 'connection-pill--online'
        : known
          ? 'connection-pill--offline'
          : 'connection-pill--checking'
    }`;
    const label = pill.querySelector('[data-worker-pill-label]');
    if (label) label.textContent = online ? 'Downloader online' : known ? 'Downloader offline' : 'Checking';
    const pillIcon = pill.querySelector('[data-worker-pill-icon]');
    if (pillIcon) renderInto(pillIcon, icon(online ? 'wifi' : 'wifiOff', { size: 14 }));
  }

  const statuses = [auth?.book, auth?.course].filter(Boolean);
  const ready = statuses.filter((state) => state.configured && state.valid).length;
  const authKnown = statuses.length === 2;
  document.querySelectorAll('[data-auth-dot]').forEach((dot) => {
    dot.className = `status-dot ${
      !authKnown ? 'status-dot--warning' : ready === 2 ? 'status-dot--success' : 'status-dot--warning'
    }`;
  });
  document.querySelectorAll('[data-auth-label]').forEach((label) => {
    label.textContent = authKnown ? `${ready}/2 ready` : 'Checking';
  });
  document.querySelectorAll('[data-auth-status]').forEach((element) => {
    element.title = authKnown
      ? `${ready} of 2 cookie files ready`
      : 'Checking cookie files';
  });
}

async function refreshStatus({ quiet = true } = {}) {
  if (!currentSession) return;
  try {
    const data = await api.status();
    statusState = {
      worker: data.worker ?? statusState.worker,
      auth: data.auth ?? statusState.auth,
    };
    paintStatus();
  } catch (error) {
    if (error?.code === 'AUTH_REQUIRED' || error?.status === 401) return;
    statusState = {
      ...statusState,
      worker: { online: false, status: 'offline' },
    };
    paintStatus();
    if (!quiet) toast(error.message || 'Could not check service status.', 'error');
  }
}

function stopStatusPolling() {
  clearInterval(statusTimer);
  statusTimer = null;
  document.removeEventListener('visibilitychange', onStatusVisibility);
}

function onStatusVisibility() {
  if (!document.hidden) refreshStatus();
}

function startStatusPolling() {
  stopStatusPolling();
  refreshStatus();
  statusTimer = setInterval(() => {
    if (!document.hidden) refreshStatus();
  }, STATUS_POLL_MS);
  document.addEventListener('visibilitychange', onStatusVisibility);
}

function updateActiveNav(route) {
  document.querySelectorAll('[data-nav-link]').forEach((link) => {
    const match = link.dataset.navMatch;
    const active =
      match === route.view.id ||
      (match === 'jobs' && route.view.id === 'jobs');
    link.classList.toggle('is-active', Boolean(active));
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateContext(route) {
  const title = document.querySelector('[data-context-title]');
  const eyebrow = document.querySelector('[data-context-eyebrow]');
  if (title) title.textContent = route.label;
  if (eyebrow) eyebrow.textContent = route.view.id === 'not-found' ? 'Shelf' : 'Workspace';
}

function closeNav() {
  document.querySelector('.shell')?.classList.remove('is-nav-open');
  document.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', 'false');
}

function toggleNav() {
  const shell = document.querySelector('.shell');
  if (!shell) return;
  const open = !shell.classList.contains('is-nav-open');
  shell.classList.toggle('is-nav-open', open);
  document.querySelector('[data-nav-toggle]')?.setAttribute('aria-expanded', String(open));
}

function teardownView() {
  currentController?.abort();
  currentController = null;
  const cleanup = currentCleanup;
  currentCleanup = null;
  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (error) {
      console.error('View cleanup failed:', error);
    }
  }
}

async function renderRoute({ focus = true } = {}) {
  if (!document.getElementById('view-root')) return;
  const route = matchRoute(window.location.pathname);
  teardownView();
  closeNav();
  updateActiveNav(route);
  updateContext(route);

  const controller = new AbortController();
  currentController = controller;
  const viewRoot = document.getElementById('view-root');
  if (!viewRoot) return;
  if (focus) {
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  const ctx = {
    signal: controller.signal,
    params: route.params,
    session: currentSession,
    navigate,
    refreshStatus: () => refreshStatus({ quiet: false }),
    updateStatus(partial) {
      if (partial?.worker !== undefined) statusState = { ...statusState, worker: partial.worker };
      if (partial?.auth != null) statusState = { ...statusState, auth: partial.auth };
      paintStatus();
    },
    logout: () => enterLogin('You have signed out.'),
  };

  try {
    const cleanup = await route.view.mount(viewRoot, ctx);
    if (currentController !== controller) {
      if (typeof cleanup === 'function') cleanup();
      return;
    }
    currentCleanup = typeof cleanup === 'function' ? cleanup : null;
  } catch (error) {
    if (controller.signal.aborted) return;
    console.error(`Could not render ${route.path}:`, error);
    renderInto(
      viewRoot,
      html`
        <div class="view">
          ${pageHeader({ eyebrow: 'Something went wrong', title: 'This view could not be rendered.' })}
          ${emptyState({
            iconName: 'alert',
            title: 'Unexpected error',
            description: 'Reload the page or head back to the overview.',
            action: html`<a class="button button--secondary button--small" href="/">Back to overview</a>`,
          })}
        </div>
      `,
    );
  }
}

function navigate(target, { replace = false, focus = true } = {}) {
  let url;
  try {
    url = new URL(target, window.location.origin);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) {
    window.location.href = target;
    return;
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    if (replace) history.replaceState(null, '', next);
    else history.pushState(null, '', next);
  }
  renderRoute({ focus });
}

function renderBoot() {
  document.title = 'Shelf';
  renderInto(
    appRoot,
    html`
      <div class="boot-screen" aria-busy="true">
        <div class="boot-screen__mark">${logoMark(48)}</div>
        <p class="boot-screen__title">Shelf</p>
        <p class="boot-screen__hint">Opening your library…</p>
        <span class="spinner"></span>
      </div>
    `,
  );
}

function renderBootError(error) {
  document.title = 'Shelf';
  renderInto(
    appRoot,
    html`
      <div class="boot-screen">
        <div class="boot-screen__mark">${logoMark(48)}</div>
        <p class="boot-screen__title">Shelf is not responding.</p>
        <p class="boot-screen__hint">${error?.message || 'Check the web container and reload the page.'}</p>
        <button class="button button--secondary" type="button" data-boot-retry>${icon('refresh', { size: 15 })}Try again</button>
      </div>
    `,
  );
  appRoot.querySelector('[data-boot-retry]')?.addEventListener('click', () => window.location.reload());
}

function showShell(session) {
  currentSession = session;
  statusState = { worker: null, auth: null };
  renderInto(appRoot, shellMarkup(session));
  paintStatus();
}

function enterLogin(message = '') {
  teardownView();
  stopStatusPolling();
  currentSession = null;
  closeNav();
  document.body.classList.remove('is-nav-open');
  renderLogin(appRoot, {
    message,
    onSuccess(session) {
      showShell(session);
      startStatusPolling();
      renderRoute();
    },
  });
}

function onShellClick(event) {
  const navToggle = event.target.closest('[data-nav-toggle]');
  if (navToggle) {
    event.preventDefault();
    toggleNav();
    return;
  }
  if (event.target.closest('[data-nav-close]')) {
    closeNav();
    return;
  }
  const logout = event.target.closest('[data-shell-logout]');
  if (logout) {
    event.preventDefault();
    const button = logout;
    if (button.dataset.busy === '1') return;
    button.dataset.busy = '1';
    if (button.tagName === 'BUTTON') button.disabled = true;
    api
      .logout()
      .then(() => enterLogin('You have signed out.'))
      .catch((error) => {
        toast(error.message || 'Could not sign out.', 'error');
        if (button.tagName === 'BUTTON') button.disabled = false;
        delete button.dataset.busy;
      });
  }
}

function onDocumentClick(event) {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = event.target.closest('a[href]');
  if (!anchor) return;
  if (anchor.target && anchor.target !== '_self') return;
  if (anchor.hasAttribute('download')) return;
  if (anchor.dataset.navLink !== undefined) {
    closeNav();
  }
  let url;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return;
  }
  if (url.origin !== window.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) {
    return;
  }
  event.preventDefault();
  navigate(`${url.pathname}${url.search}${url.hash}`);
}

async function boot() {
  renderBoot();
  let session;
  try {
    session = await api.session();
  } catch (error) {
    renderBootError(error);
    return;
  }

  if (session.auth?.required && !session.auth.authenticated) {
    renderLogin(appRoot, {
      onSuccess(nextSession) {
        showShell(nextSession);
        startStatusPolling();
        renderRoute();
      },
    });
    return;
  }

  showShell(session);
  startStatusPolling();
  await renderRoute({ focus: false });
}

onUnauthorized(() => {
  enterLogin('Your session expired. Sign in again to continue.');
});

appRoot.addEventListener('click', onShellClick);
document.addEventListener('click', onDocumentClick);
window.addEventListener('popstate', () => renderRoute());
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeNav();
});

boot();
