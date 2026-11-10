import { api, ApiError } from '../api.js';
import { pageHeader } from '../components.js';
import {
  confirmDialog,
  copyText,
  formatBytes,
  formatCount,
  fullDate,
  html,
  icon,
  openModal,
  relativeTime,
  renderInto,
  setButtonLoading,
  toast,
} from '../ui.js';

const BOOK_SNIPPET = `JSON.stringify(document.cookie.split(';').reduce((o, c) => {
  const [k, v] = c.trim().split('=');
  o[k] = v;
  return o;
}, {}))`;

function cookieReady(status) {
  return Boolean(status?.configured && status?.valid);
}

function cookieStatusText(status) {
  if (!status?.configured) return 'Not configured';
  if (!status.valid) return status.error || 'Invalid file';
  return `${formatCount(status.cookieCount)} cookies · updated ${relativeTime(status.modifiedAt)}`;
}

function cookieCard(kind, status) {
  const ready = cookieReady(status);
  const isBook = kind === 'book';
  return html`
    <article class="settings-card cookie-card">
      <div class="settings-card__header">
        <span class="settings-card__icon ${ready ? 'settings-card__icon--ready' : ''}">${icon(isBook ? 'book' : 'video', { size: 20 })}</span>
        <div class="settings-card__title">
          <h3>${isBook ? 'Book cookies' : 'Full course cookies'}</h3>
          <p>${isBook ? 'Required for EPUB and PDF downloads.' : 'Required for video and transcript downloads.'}</p>
        </div>
        <span class="status-badge ${ready ? 'status-badge--success' : 'status-badge--danger'}">
          <span class="status-dot"></span>${ready ? 'Ready' : 'Missing'}
        </span>
      </div>
      <dl class="settings-facts">
        <div><dt>File</dt><dd class="mono">/config/${status.fileName}</dd></div>
        <div><dt>Status</dt><dd class="${ready ? '' : 'text-warning'}">${cookieStatusText(status)}</dd></div>
        ${status.modifiedAt ? html`<div><dt>Updated</dt><dd title="${fullDate(status.modifiedAt)}">${relativeTime(status.modifiedAt)}</dd></div>` : ''}
        ${status.sizeBytes ? html`<div><dt>Size</dt><dd>${formatBytes(status.sizeBytes)}</dd></div>` : ''}
      </dl>
      ${status.configured && !status.valid
        ? html`<div class="notice notice--danger">${icon('alert', { size: 16 })}<span>${status.error || 'This cookie file cannot be used.'}</span></div>`
        : ''}
      <div class="settings-card__actions">
        <button class="button button--secondary button--small" type="button" data-update-cookie="${kind}">${icon('upload', { size: 14 })}${status.configured ? 'Update cookies' : 'Add cookies'}</button>
        ${status.configured ? html`<button class="button button--ghost button--small button--danger-text" type="button" data-remove-cookie="${kind}">${icon('trash', { size: 14 })}Remove</button>` : ''}
      </div>
      <details class="instruction-block">
        <summary>${icon('info', { size: 14 })}How to get ${isBook ? 'book' : 'full course'} cookies</summary>
        <div class="instruction-block__body">
          ${isBook
            ? html`
                <p>Sign in to <span class="mono">learning.oreilly.com</span> in your browser, open DevTools on the page, and run this in the console:</p>
                <div class="code-block">
                  <code>${BOOK_SNIPPET}</code>
                  <button class="code-copy" type="button" data-copy-instruction aria-label="Copy snippet">${icon('copy', { size: 14 })}</button>
                </div>
                <p class="muted">Paste the resulting JSON above, or save it as <span class="mono">config/cookies.json</span>.</p>
              `
            : html`
                <p>Course downloads need full cookies, including HttpOnly values that <span class="mono">document.cookie</span> cannot read. Capture them with the downloader's interactive login:</p>
                <div class="code-block">
                  <code>./oreilly.sh login</code>
                  <button class="code-copy" type="button" data-copy-instruction aria-label="Copy command">${icon('copy', { size: 14 })}</button>
                </div>
                <p class="muted">Then paste the resulting <span class="mono">cookies_full.json</span> above, or save it as <span class="mono">config/cookies_full.json</span>. A browser extension that exports HttpOnly cookies also works.</p>
              `}
          <p class="instruction-block__note">${icon('shield', { size: 13 })}Cookie values are never returned by the API, written to logs, or included in the interface.</p>
        </div>
      </details>
    </article>
  `;
}

function workerCard(worker) {
  const online = worker?.online;
  return html`
    <article class="settings-card">
      <div class="settings-card__header">
        <span class="settings-card__icon ${online ? 'settings-card__icon--ready' : ''}">${icon(online ? 'wifi' : 'wifiOff', { size: 20 })}</span>
        <div class="settings-card__title">
          <h3>Downloader service</h3>
          <p>The CLI worker running in its own container.</p>
        </div>
        <span class="status-badge ${online ? 'status-badge--success' : 'status-badge--danger'}">
          <span class="status-dot ${online ? '' : 'status-dot--warning'}"></span>${online ? 'Online' : 'Offline'}
        </span>
      </div>
      <dl class="settings-facts">
        <div><dt>Worker version</dt><dd>${worker?.version || '—'}</dd></div>
        <div><dt>Concurrency</dt><dd>${formatCount(worker?.maxConcurrent || 1)} job</dd></div>
        <div><dt>Running</dt><dd>${formatCount(worker?.active || 0)}</dd></div>
        <div><dt>Queued</dt><dd>${formatCount(worker?.queued || 0)}</dd></div>
      </dl>
      ${!online
        ? html`<div class="notice notice--warning">${icon('alert', { size: 16 })}<span>The worker is not reachable. Check <span class="mono">docker compose ps</span> and the downloader logs.</span></div>`
        : html`<p class="settings-note">${icon('shield', { size: 13 })}The worker API is internal to the Compose network and has no published port.</p>`}
    </article>
  `;
}

function securityCard(settings) {
  const { security, session } = settings;
  return html`
    <article class="settings-card">
      <div class="settings-card__header">
        <span class="settings-card__icon">${icon('shield', { size: 20 })}</span>
        <div class="settings-card__title">
          <h3>Access & security</h3>
          <p>How this Shelf instance is protected.</p>
        </div>
      </div>
      <dl class="settings-facts settings-facts--tall">
        <div>
          <dt>App password</dt>
          <dd>${security.passwordConfigured ? 'Enabled' : 'Not configured'}</dd>
          <span class="fact-note">${security.passwordConfigured ? 'A signed session is required.' : 'Local-only mode. Publish only on 127.0.0.1.'}</span>
        </div>
        <div>
          <dt>Session cookie</dt>
          <dd>${security.secureCookie ? 'Secure flag enabled' : 'HTTP / local'}</dd>
          <span class="fact-note">Set <span class="mono">COOKIE_SECURE=1</span> behind HTTPS.</span>
        </div>
        <div>
          <dt>Worker token</dt>
          <dd>${security.internalTokenConfigured ? 'Configured' : 'Network isolation only'}</dd>
          <span class="fact-note">The runner is never published outside the internal network.</span>
        </div>
      </dl>
      ${!security.passwordConfigured
        ? html`
            <div class="notice notice--warning">
              ${icon('alert', { size: 16 })}
              <div>
                <strong>Add a password before exposing Shelf.</strong>
                <span>Set <span class="mono">APP_PASSWORD</span> in <span class="mono">.env</span>, then restart with <span class="mono">docker compose up -d</span>.</span>
              </div>
            </div>
          `
        : ''}
      ${session?.required
        ? html`<div class="settings-card__actions"><button class="button button--ghost button--small" type="button" data-logout>${icon('logout', { size: 14 })}Sign out</button></div>`
        : ''}
    </article>
  `;
}

function storageCard(settings) {
  return html`
    <article class="settings-card">
      <div class="settings-card__header">
        <span class="settings-card__icon">${icon('hardDrive', { size: 20 })}</span>
        <div class="settings-card__title">
          <h3>Storage</h3>
          <p>Shared volumes used by both containers.</p>
        </div>
      </div>
      <dl class="settings-facts">
        <div><dt>Downloads</dt><dd class="mono">${settings.paths.downloads}</dd><span class="fact-note">Web container mounts this read-only.</span></div>
        <div><dt>Configuration</dt><dd class="mono">${settings.paths.config}</dd><span class="fact-note">Mounted from <span class="mono">./config</span> on the host.</span></div>
      </dl>
      <p class="settings-note">${icon('info', { size: 13 })}Back up <span class="mono">./download</span> and <span class="mono">./config</span> to keep your library and authentication.</p>
    </article>
  `;
}

function viewMarkup(data) {
  return html`
    <div class="view view--settings">
      ${pageHeader({
        eyebrow: 'Settings',
        title: 'Tune the details.',
        description: 'Authentication, service health, and the boundaries that keep this instance private.',
        actions: html`<button class="button button--secondary" type="button" data-refresh-settings>${icon('refresh', { size: 15 })}Recheck</button>`,
      })}
      <section class="settings-section">
        <div class="section-heading">
          <div><p class="eyebrow">Authentication</p><h2>Cookie files</h2></div>
          <span class="header-meta">${formatCount([data.cookies.book, data.cookies.course].filter(cookieReady).length)} of 2 ready</span>
        </div>
        <p class="section-intro">The downloader reads these JSON cookie files from the shared config volume. Values are never shown here.</p>
        <div class="settings-grid settings-grid--cookies">
          ${cookieCard('book', data.cookies.book)}
          ${cookieCard('course', data.cookies.course)}
        </div>
      </section>
      <section class="settings-section">
        <div class="section-heading">
          <div><p class="eyebrow">Runtime</p><h2>Service & access</h2></div>
          <span class="header-meta">${data.app.timezone}</span>
        </div>
        <div class="settings-grid">
          ${workerCard(data.worker)}
          ${securityCard(data)}
        </div>
      </section>
      <section class="settings-section">
        <div class="section-heading">
          <div><p class="eyebrow">Data</p><h2>Storage & retention</h2></div>
        </div>
        <div class="settings-grid settings-grid--single">
          ${storageCard(data)}
        </div>
      </section>
      <footer class="settings-footer">
        <span>${icon('sparkles', { size: 14 })}Shelf ${data.app.version} · O'Reilly download manager</span>
        <span>Unofficial companion. Not affiliated with O'Reilly Media.</span>
      </footer>
    </div>
  `;
}

function errorMarkup(error) {
  return html`
    <div class="view">
      ${pageHeader({ eyebrow: 'Settings', title: 'Tune the details.' })}
      <div class="empty-state">
        <span class="empty-state__icon">${icon('alert', { size: 24 })}</span>
        <h3>Could not load settings</h3>
        <p>${error.message || 'Try again in a moment.'}</p>
        <div class="empty-state__action"><button class="button button--secondary button--small" type="button" data-refresh-settings>Try again</button></div>
      </div>
    </div>
  `;
}

function openCookieEditor(kind, status, onSaved) {
  const isBook = kind === 'book';
  const snippet = isBook
    ? 'Paste the JSON object printed by the browser console snippet. It should look like {"cookie_name":"value"}.'
    : 'Paste the contents of cookies_full.json, including HttpOnly session cookies.';
  const body = html`
    <p class="muted">${snippet}</p>
    <div class="form-alert" data-cookie-form-error hidden></div>
    <label class="field field--full">
      <span class="field__label">Cookie JSON</span>
      <textarea class="textarea textarea--code" rows="12" spellcheck="false" placeholder='{"name":"value"}' data-cookie-text></textarea>
    </label>
    <label class="drop-zone" data-cookie-drop>
      <input type="file" accept=".json,application/json" data-cookie-file hidden />
      ${icon('upload', { size: 18 })}
      <span><strong>Choose a JSON file</strong> or drag it here</span>
    </label>
    <div class="notice">${icon('shield', { size: 16 })}<span>The file is written to <span class="mono">/config/${status.fileName}</span> with mode 600. Values are never sent back to this page.</span></div>
  `;
  const footer = html`
    <button class="button button--ghost" type="button" data-modal-close>Cancel</button>
    <button class="button button--primary" type="button" data-cookie-save>${icon('check', { size: 15 })}Save cookies</button>
  `;

  openModal({
    title: `Update ${isBook ? 'book' : 'full course'} cookies`,
    eyebrow: 'Authentication',
    size: 'large',
    body,
    footer,
    onMount(wrapper, close) {
      const textarea = wrapper.querySelector('[data-cookie-text]');
      const errorBox = wrapper.querySelector('[data-cookie-form-error]');
      const save = wrapper.querySelector('[data-cookie-save]');
      const fileInput = wrapper.querySelector('[data-cookie-file]');
      const drop = wrapper.querySelector('[data-cookie-drop]');
      const showError = (message) => {
        errorBox.hidden = !message;
        errorBox.textContent = message || '';
      };
      const acceptFile = async (file) => {
        if (!file) return;
        if (file.size > 1024 * 1024) {
          showError('That file is larger than 1 MB.');
          return;
        }
        try {
          textarea.value = await file.text();
          showError('');
          textarea.focus();
        } catch {
          showError('Could not read that file.');
        }
      };
      fileInput.addEventListener('change', () => acceptFile(fileInput.files?.[0]));
      drop.addEventListener('dragover', (event) => {
        event.preventDefault();
        drop.classList.add('is-dragging');
      });
      drop.addEventListener('dragleave', () => drop.classList.remove('is-dragging'));
      drop.addEventListener('drop', (event) => {
        event.preventDefault();
        drop.classList.remove('is-dragging');
        acceptFile(event.dataTransfer?.files?.[0]);
      });
      save.addEventListener('click', async () => {
        const text = textarea.value.trim();
        if (!text) {
          showError('Paste your cookies or choose a JSON file first.');
          textarea.focus();
          return;
        }
        showError('');
        setButtonLoading(save, true, 'Saving…');
        try {
          await api.saveCookies(kind, text);
          close();
          toast(`${isBook ? 'Book' : 'Course'} cookies updated.`, 'success');
          await onSaved();
        } catch (error) {
          showError(error instanceof ApiError ? error.message : 'Could not save cookies.');
          setButtonLoading(save, false);
        }
      });
      textarea.focus();
    },
  });
}

export const settingsView = {
  id: 'settings',
  title: 'Settings',
  async mount(root, ctx) {
    document.title = 'Settings · Shelf';
    let data = null;
    let lastSignature = '';
    let stopped = false;
    let timer = null;

    const load = async ({ silent = false } = {}) => {
      try {
        const next = await api.settings(ctx.signal);
        if (ctx.signal.aborted) return;
        const signature = JSON.stringify({
          cookies: next.cookies,
          worker: next.worker,
          security: next.security,
          session: next.session,
        });
        if (signature === lastSignature && !silent) return;
        lastSignature = signature;
        data = next;
        renderInto(root, viewMarkup(data));
        ctx.updateStatus?.({ worker: data.worker, auth: data.cookies });
      } catch (error) {
        if (ctx.signal.aborted || error?.name === 'AbortError') return;
        if (!data) renderInto(root, errorMarkup(error));
        else if (!silent) toast(error.message || 'Could not refresh settings.', 'error');
      }
    };

    renderInto(root, html`<div class="view" aria-busy="true"><div class="skeleton skeleton--heading"></div><div class="skeleton skeleton--panel skeleton--tall"></div><div class="skeleton skeleton--panel"></div></div>`);
    await load({ silent: true });
    if (ctx.signal.aborted) return undefined;

    const onClick = async (event) => {
      const refresh = event.target.closest('[data-refresh-settings]');
      if (refresh) {
        setButtonLoading(refresh, true, 'Checking…');
        await load({ silent: true });
        toast('Settings refreshed.', 'success');
        return;
      }

      const update = event.target.closest('[data-update-cookie]');
      if (update && data) {
        const kind = update.dataset.updateCookie;
        openCookieEditor(kind, data.cookies[kind], async () => {
          lastSignature = '';
          await load({ silent: true });
          ctx.refreshStatus?.();
        });
        return;
      }

      const remove = event.target.closest('[data-remove-cookie]');
      if (remove && data) {
        const kind = remove.dataset.removeCookie;
        const label = kind === 'book' ? 'book cookies' : 'full course cookies';
        const confirmed = await confirmDialog({
          title: `Remove ${label}?`,
          message: 'Downloads of this type will fail until you add a new cookie file.',
          confirmLabel: 'Remove cookies',
        });
        if (!confirmed) return;
        try {
          await api.removeCookies(kind);
          toast(`${kind === 'book' ? 'Book' : 'Course'} cookies removed.`, 'success');
          lastSignature = '';
          await load({ silent: true });
          ctx.refreshStatus?.();
        } catch (error) {
          toast(error instanceof ApiError ? error.message : 'Could not remove cookies.', 'error');
        }
        return;
      }

      const copy = event.target.closest('[data-copy-instruction]');
      if (copy) {
        const block = copy.closest('.instruction-block');
        const code = block?.querySelector('code')?.textContent || '';
        const copied = await copyText(code);
        toast(copied ? 'Copied to clipboard.' : 'Could not copy.', copied ? 'success' : 'error');
        return;
      }

      if (event.target.closest('[data-logout]')) {
        try {
          await api.logout();
          ctx.logout?.();
        } catch (error) {
          toast(error.message || 'Could not sign out.', 'error');
        }
      }
    };

    root.addEventListener('click', onClick);
    timer = setInterval(() => {
      if (!stopped && !document.hidden && !document.querySelector('.modal-backdrop')) {
        load({ silent: true });
      }
    }, 30000);

    return () => {
      stopped = true;
      clearInterval(timer);
      root.removeEventListener('click', onClick);
    };
  },
};
