import { api } from '../api.js';
import { pageHeader, emptyState, jobActivityRow } from '../components.js';
import {
  formatBytes,
  formatCount,
  html,
  icon,
  plural,
  relativeTime,
  renderInto,
  shortDate,
} from '../ui.js';

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

function authReady(auth) {
  const states = [auth?.book, auth?.course];
  return states.filter((state) => state?.configured && state?.valid).length;
}

function bannerMarkup(data) {
  if (data.worker?.online) return html``;
  return html`
    <div class="notice notice--warning notice--wide" role="status">
      ${icon('wifiOff', { size: 18 })}
      <div>
        <strong>Downloader service is offline.</strong>
        <span>The library is still available. New jobs will start when the container reconnects.</span>
      </div>
    </div>
  `;
}

function statsMarkup(data) {
  const { stats } = data;
  const ready = authReady(data.auth);
  return html`
    <section class="stats-grid" aria-label="Library summary">
      <article class="stat-card stat-card--mint">
        <span class="stat-card__icon">${icon('library', { size: 19 })}</span>
        <p class="stat-card__label">Library</p>
        <p class="stat-card__value">${formatCount(stats.libraryItems)}</p>
        <p class="stat-card__meta">${formatCount(stats.bookCount)} ${plural(stats.bookCount, 'book')} · ${formatCount(stats.courseCount)} ${plural(stats.courseCount, 'course')}</p>
      </article>
      <article class="stat-card stat-card--sky">
        <span class="stat-card__icon">${icon('hardDrive', { size: 19 })}</span>
        <p class="stat-card__label">Storage</p>
        <p class="stat-card__value">${formatBytes(stats.totalBytes)}</p>
        <p class="stat-card__meta">Across ${formatCount(stats.fileCount)} ${plural(stats.fileCount, 'file')}</p>
      </article>
      <article class="stat-card stat-card--lavender">
        <span class="stat-card__icon">${icon('activity', { size: 19 })}</span>
        <p class="stat-card__label">Active</p>
        <p class="stat-card__value">${formatCount(stats.activeJobs)}</p>
        <p class="stat-card__meta">${stats.activeJobs ? 'Job in progress' : 'Queue is clear'}${data.worker?.queued ? ` · ${data.worker.queued} waiting` : ''}</p>
      </article>
      <article class="stat-card stat-card--peach">
        <span class="stat-card__icon">${icon('key', { size: 19 })}</span>
        <p class="stat-card__label">Access</p>
        <p class="stat-card__value">${ready}<span class="stat-card__fraction">/2</span></p>
        <p class="stat-card__meta">${ready === 2 ? 'Cookies ready' : 'Authentication needs attention'}</p>
      </article>
    </section>
  `;
}

function activityMarkup(data) {
  const jobs = data.recentJobs || [];
  if (jobs.length === 0) {
    return emptyState({
      iconName: 'activity',
      title: 'No downloads yet',
      description: 'Your first book or course will appear here with live progress.',
      action: html`<a class="button button--secondary button--small" href="/download">${icon('plus', { size: 15 })}Start a download</a>`,
    });
  }
  return html`<div class="activity-list">${jobs.map((job) => jobActivityRow(job))}</div>`;
}

function authRow(status, iconName, title) {
  const ready = status?.configured && status?.valid;
  const detail = ready
    ? `${status.cookieCount} cookies · updated ${relativeTime(status.modifiedAt)}`
    : status?.configured
      ? status.error || 'Invalid cookie file'
      : 'Not configured';
  return html`
    <div class="access-row">
      <span class="access-row__icon ${ready ? 'access-row__icon--ready' : ''}">${icon(iconName, { size: 17 })}</span>
      <span class="access-row__copy">
        <strong>${title}</strong>
        <span class="${ready ? 'muted' : 'text-warning'}">${detail}</span>
      </span>
      <span class="status-dot ${ready ? 'status-dot--success' : 'status-dot--warning'}"></span>
    </div>
  `;
}

function accessMarkup(data) {
  const ready = authReady(data.auth);
  return html`
    <section class="panel panel--access">
      <div class="panel__header">
        <div>
          <p class="eyebrow">Access</p>
          <h2>Authentication</h2>
        </div>
        <a class="text-link" href="/settings">Manage ${icon('arrowRight', { size: 14 })}</a>
      </div>
      <div class="access-list">
        ${authRow(data.auth?.book, 'book', 'Book cookies')}
        ${authRow(data.auth?.course, 'video', 'Full course cookies')}
      </div>
      <p class="access-note">
        ${ready === 2
          ? 'Both download types are ready. Cookies are read by the downloader only.'
          : 'Add or refresh the missing cookie file in Settings before starting that download type.'}
      </p>
    </section>
  `;
}

function quickMarkup() {
  return html`
    <section class="quick-actions">
      <a class="quick-action quick-action--book" href="/download?type=book">
        <span class="quick-action__icon">${icon('book', { size: 20 })}</span>
        <span class="quick-action__copy">
          <strong>Download a book</strong>
          <span>EPUB, PDF, or both</span>
        </span>
        ${icon('arrowUpRight', { size: 16 })}
      </a>
      <a class="quick-action quick-action--course" href="/download?type=course">
        <span class="quick-action__icon">${icon('video', { size: 20 })}</span>
        <span class="quick-action__copy">
          <strong>Download a course</strong>
          <span>Videos and transcripts</span>
        </span>
        ${icon('arrowUpRight', { size: 16 })}
      </a>
    </section>
  `;
}

function recentCard(item, kind) {
  if (kind === 'book') {
    return html`
      <a class="recent-card" href="/library">
        <span class="recent-card__cover recent-card__cover--book">
          ${icon('book', { size: 22 })}
          <span class="recent-card__formats">${item.formats.map((format) => format.format.toUpperCase()).join(' · ')}</span>
        </span>
        <span class="recent-card__body">
          <strong>${item.title}</strong>
          <span>${formatBytes(item.sizeBytes)} · ${relativeTime(item.modifiedAt)}</span>
        </span>
      </a>
    `;
  }
  return html`
    <a class="recent-card" href="/library">
      <span class="recent-card__cover recent-card__cover--course">${icon('play', { size: 22 })}</span>
      <span class="recent-card__body">
        <strong>${item.title}</strong>
        <span>${formatCount(item.videoCount)} ${plural(item.videoCount, 'lesson')} · ${formatBytes(item.sizeBytes)}</span>
      </span>
    </a>
  `;
}

function recentMarkup(data) {
  const items = [
    ...(data.recentBooks || []).map((book) => ({ kind: 'book', item: book })),
    ...(data.recentCourses || []).map((course) => ({ kind: 'course', item: course })),
  ].sort(
    (a, b) =>
      new Date(b.item.modifiedAt || 0).getTime() -
      new Date(a.item.modifiedAt || 0).getTime(),
  );
  return html`
    <section class="section-block">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Library</p>
          <h2>Recently added</h2>
        </div>
        <a class="text-link" href="/library">Browse library ${icon('arrowRight', { size: 14 })}</a>
      </div>
      ${items.length
        ? html`<div class="recent-grid">${items.slice(0, 5).map(({ kind, item }) => recentCard(item, kind))}</div>`
        : emptyState({
            iconName: 'library',
            title: 'Your library is empty',
            description: 'Completed downloads are saved here automatically.',
            action: html`<a class="button button--secondary button--small" href="/download">Start your first download</a>`,
          })}
    </section>
  `;
}

function fullMarkup(data) {
  return html`
    <div class="view view--overview">
      ${pageHeader({
        eyebrow: 'Dashboard',
        title: greeting(),
        description: 'Here is the quiet pulse of your offline library.',
        actions: html`<a class="button button--primary" href="/download">${icon('plus', { size: 16 })}New download</a>`,
      })}
      <div data-region="banner">${bannerMarkup(data)}</div>
      <div data-region="stats">${statsMarkup(data)}</div>
      <div class="overview-grid">
        <section class="panel panel--activity">
          <div class="panel__header">
            <div>
              <p class="eyebrow">Activity</p>
              <h2>Recent downloads</h2>
            </div>
            <a class="text-link" href="/jobs">View all ${icon('arrowRight', { size: 14 })}</a>
          </div>
          <div data-region="activity">${activityMarkup(data)}</div>
        </section>
        <div class="overview-side">
          <div data-region="access">${accessMarkup(data)}</div>
          ${quickMarkup()}
        </div>
      </div>
      <div data-region="recent">${recentMarkup(data)}</div>
      <p class="view-updated">Library scanned ${shortDate(data.stats?.scannedAt)} · <span data-region="updated">just now</span></p>
    </div>
  `;
}

function skeletonMarkup() {
  return html`
    <div class="view view--overview" aria-busy="true">
      <header class="page-header">
        <div class="page-header__copy">
          <div class="skeleton skeleton--line skeleton--sm"></div>
          <div class="skeleton skeleton--heading"></div>
          <div class="skeleton skeleton--line skeleton--md"></div>
        </div>
      </header>
      <section class="stats-grid">
        ${Array.from({ length: 4 }).map(
          () => html`<div class="skeleton skeleton--card"><div class="skeleton skeleton--line skeleton--sm"></div><div class="skeleton skeleton--value"></div><div class="skeleton skeleton--line skeleton--md"></div></div>`,
        )}
      </section>
      <div class="overview-grid">
        <div class="skeleton skeleton--panel"></div>
        <div class="skeleton skeleton--panel"></div>
      </div>
    </div>
  `;
}

export const overviewView = {
  id: 'overview',
  title: 'Overview',
  async mount(root, ctx) {
    document.title = 'Overview · Shelf';
    renderInto(root, skeletonMarkup());
    let lastSignature = '';
    let timer = null;

    const update = async (initial = false) => {
      if (document.hidden && !initial) return;
      try {
        const data = await api.overview(ctx.signal);
        if (ctx.signal.aborted) return;
        const signature = JSON.stringify({
          stats: data.stats,
          jobs: data.recentJobs?.map((job) => [job.id, job.status, job.progress, job.stage]),
          auth: data.auth,
          worker: data.worker,
          recent: [data.recentBooks, data.recentCourses],
        });
        if (initial) {
          renderInto(root, fullMarkup(data));
        } else if (signature !== lastSignature) {
          const banner = root.querySelector('[data-region="banner"]');
          const stats = root.querySelector('[data-region="stats"]');
          const activity = root.querySelector('[data-region="activity"]');
          const access = root.querySelector('[data-region="access"]');
          const recent = root.querySelector('[data-region="recent"]');
          if (banner) renderInto(banner, bannerMarkup(data));
          if (stats) renderInto(stats, statsMarkup(data));
          if (activity) renderInto(activity, activityMarkup(data));
          if (access) renderInto(access, accessMarkup(data));
          if (recent) renderInto(recent, recentMarkup(data));
          const updated = root.querySelector('[data-region="updated"]');
          if (updated) updated.textContent = 'just now';
        }
        lastSignature = signature;
        ctx.updateStatus?.({ worker: data.worker, auth: data.auth });
      } catch (error) {
        if (ctx.signal.aborted || error?.name === 'AbortError') return;
        if (initial) {
          renderInto(
            root,
            html`<div class="view">${pageHeader({ eyebrow: 'Dashboard', title: 'Overview' })}${emptyState({
              iconName: 'alert',
              title: 'Could not load the dashboard',
              description: error.message || 'Check the containers and try again.',
              action: html`<button class="button button--secondary button--small" type="button" data-retry>Try again</button>`,
            })}</div>`,
          );
          root.querySelector('[data-retry]')?.addEventListener('click', () => {
            renderInto(root, skeletonMarkup());
            update(true);
          });
        }
      }
    };

    await update(true);
    timer = setInterval(() => update(false), 6000);
    const onVisibility = () => {
      if (!document.hidden) update(false);
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  },
};
