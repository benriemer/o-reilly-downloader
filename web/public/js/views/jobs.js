import { api, ApiError } from '../api.js';
import { emptyState, jobActivityRow, pageHeader } from '../components.js';
import {
  confirmDialog,
  copyText,
  durationBetween,
  formatCount,
  fullDate,
  html,
  icon,
  jobTypeIcon,
  logLevel,
  progressBar,
  relativeTime,
  renderInto,
  statusBadge,
  statusMeta,
  toast,
} from '../ui.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

const ACTIVE_STATUSES = new Set(['queued', 'running', 'cancelling']);

function connectionMarkup(worker) {
  if (!worker || worker.online !== false) return html``;
  return html`
    <div class="notice notice--warning notice--wide" role="status">
      ${icon('wifiOff', { size: 18 })}
      <div>
        <strong>Downloader connection lost.</strong>
        <span>Showing the last known jobs. Shelf will reconnect automatically.</span>
      </div>
    </div>
  `;
}

function filterCounts(jobs) {
  return {
    all: jobs.length,
    active: jobs.filter((job) => ACTIVE_STATUSES.has(job.status)).length,
    completed: jobs.filter((job) => job.status === 'completed').length,
    failed: jobs.filter((job) => job.status === 'failed').length,
  };
}

function filteredJobs(jobs, filter) {
  if (filter === 'active') return jobs.filter((job) => ACTIVE_STATUSES.has(job.status));
  if (filter === 'completed') return jobs.filter((job) => job.status === 'completed');
  if (filter === 'failed') return jobs.filter((job) => job.status === 'failed');
  return jobs;
}

function listMarkup(jobs, filter) {
  const counts = filterCounts(jobs);
  const filtered = filteredJobs(jobs, filter);
  return html`
    <div class="jobs-toolbar">
      <div class="filter-tabs" role="group" aria-label="Filter jobs">
        ${FILTERS.map(
          (entry) => html`
            <button class="filter-tab ${filter === entry.id ? 'is-active' : ''}" type="button" data-filter="${entry.id}" aria-pressed="${filter === entry.id}">
              ${entry.label}<span class="filter-tab__count">${formatCount(counts[entry.id])}</span>
            </button>
          `,
        )}
      </div>
    </div>
    ${jobs.length === 0
      ? emptyState({
          iconName: 'activity',
          title: 'No downloads yet',
          description: 'Book and course jobs will appear here with live progress and logs.',
          action: html`<a class="button button--secondary button--small" href="/download">${icon('plus', { size: 15 })}New download</a>`,
        })
      : filtered.length === 0
        ? emptyState({
            iconName: 'check',
            title: 'Nothing in this view',
            description: 'Try another filter to see the rest of your download history.',
          })
        : html`<div class="jobs-list">${filtered.map((job) => jobActivityRow(job))}</div>`}
  `;
}

function detailChromeMarkup(job) {
  const active = ACTIVE_STATUSES.has(job.status);
  const meta = statusMeta(job.status);
  return html`
    <div class="job-detail__top">
      <a class="icon-button icon-button--subtle job-detail__close" href="/jobs" aria-label="Close job details">${icon('x', { size: 17 })}</a>
      <span class="job-detail__type job-detail__type--${job.type}">${jobTypeIcon(job.type)}</span>
      <div class="job-detail__heading">
        <p class="eyebrow">${job.type === 'course' ? 'Video course' : 'Book'} · ${job.id.slice(0, 6)}</p>
        <h2>${job.title}</h2>
        <p>${job.subtitle || 'Download job'}</p>
      </div>
    </div>

    <div class="job-detail__statusline">
      ${statusBadge(job.status, { withIcon: true })}
      <span class="muted">${meta.label}</span>
    </div>

    <div class="job-progress">
      <div class="job-progress__top">
        <span>${job.stage || meta.label}</span>
        <strong>${Math.round(job.progress || 0)}%</strong>
      </div>
      ${progressBar(job.progress)}
    </div>

    <dl class="job-facts">
      <div><dt>Created</dt><dd title="${fullDate(job.createdAt)}">${relativeTime(job.createdAt)}</dd></div>
      <div><dt>Started</dt><dd>${job.startedAt ? relativeTime(job.startedAt) : 'Waiting'}</dd></div>
      <div><dt>Duration</dt><dd>${durationBetween(job.startedAt, job.finishedAt)}</dd></div>
      <div><dt>Job</dt><dd class="mono">${job.id}</dd></div>
    </dl>

    <div class="job-detail__notices">
      ${job.error
        ? html`<div class="notice notice--danger">${icon('alert', { size: 17 })}<div><strong>Download failed</strong><span>${job.error}</span></div></div>`
        : ''}
      ${job.warning
        ? html`<div class="notice notice--warning">${icon('alert', { size: 17 })}<div><strong>Completed with a warning</strong><span>${job.warning}</span></div></div>`
        : ''}
      ${job.status === 'cancelled'
        ? html`<div class="notice">${icon('info', { size: 17 })}<span>This job was cancelled before it finished.</span></div>`
        : ''}
    </div>

    <div class="job-detail__actions">
      ${active
        ? html`<button class="button button--ghost button--danger-text" type="button" data-cancel-job="${job.id}">${icon('x', { size: 15 })}Cancel download</button>`
        : ''}
      ${['failed', 'cancelled'].includes(job.status)
        ? html`<button class="button button--secondary" type="button" data-retry-job="${job.id}">${icon('rotate', { size: 15 })}Retry download</button>`
        : ''}
      ${job.status === 'completed'
        ? html`<a class="button button--secondary" href="/library">${icon('library', { size: 15 })}Open library</a>`
        : ''}
    </div>
  `;
}

function logMarkup(job) {
  const lines = Array.isArray(job.logs) ? job.logs : [];
  if (lines.length === 0) {
    return html`<div class="log-empty">${job.status === 'queued' ? 'Waiting for the downloader…' : 'No output captured yet.'}</div>`;
  }
  return html`${lines.map(
    (line) => html`<span class="log-line log-line--${logLevel(line)}">${line}</span>`,
  )}`;
}

function detailMarkup(job) {
  return html`
    <aside class="panel job-detail" data-region="job-detail" aria-label="Job details">
      <div data-region="detail-chrome">${detailChromeMarkup(job)}</div>
      <section class="log-panel">
        <div class="log-panel__header">
          <div>
            <p class="eyebrow">Output</p>
            <h3>Execution log</h3>
          </div>
          <div class="log-panel__actions">
            <span class="log-panel__count" data-log-count>${formatCount(job.logs?.length || 0)} lines</span>
            <button class="icon-button icon-button--subtle" type="button" data-copy-log="${job.id}" aria-label="Copy execution log" title="Copy log">${icon('copy', { size: 15 })}</button>
          </div>
        </div>
        <div class="log-view" data-region="detail-log" tabindex="0" aria-label="Execution log">${logMarkup(job)}</div>
        ${job.logTruncated
          ? html`<p class="log-panel__note">${icon('info', { size: 13 })}Earlier lines were trimmed to keep the response small.</p>`
          : ''}
      </section>
    </aside>
  `;
}

function detailSkeleton() {
  return html`
    <aside class="panel job-detail" aria-busy="true">
      <div class="skeleton skeleton--line skeleton--sm"></div>
      <div class="skeleton skeleton--heading"></div>
      <div class="skeleton skeleton--card"></div>
      <div class="skeleton skeleton--card skeleton--tall"></div>
    </aside>
  `;
}

export const jobsView = {
  id: 'jobs',
  title: 'Activity',
  async mount(root, ctx) {
    document.title = 'Activity · Shelf';
    const selectedId = ctx.params?.id || null;
    let filter = 'all';
    let jobs = [];
    let worker = null;
    let currentJob = null;
    let stopped = false;
    let timer = null;
    let lastJobStates = new Map();
    let logsSignature = '';
    let initialDetailPainted = false;

    renderInto(
      root,
      html`
        <div class="view view--jobs" aria-busy="true">
          <div class="skeleton skeleton--heading"></div>
          <div class="skeleton skeleton--panel skeleton--tall"></div>
        </div>
      `,
    );

    const shell = () => html`
      <div class="view view--jobs">
        ${pageHeader({
          eyebrow: 'Activity',
          title: 'Downloads',
          description: 'Every job, its live progress, and the downloader output in one place.',
          actions: html`
            <button class="button button--secondary" type="button" data-refresh-jobs>${icon('refresh', { size: 15 })}Refresh</button>
            <a class="button button--primary" href="/download">${icon('plus', { size: 16 })}New download</a>
          `,
        })}
        <div data-region="connection">${connectionMarkup(worker)}</div>
        <div class="jobs-layout ${selectedId ? 'has-detail' : ''}" data-region="jobs-layout">
          <section class="panel jobs-panel">
            <div class="panel__header jobs-panel__header">
              <div>
                <p class="eyebrow">Queue</p>
                <h2>${selectedId ? 'Job history' : 'All jobs'}</h2>
              </div>
              <span class="header-meta" data-region="jobs-count">${formatCount(jobs.length)} total</span>
            </div>
            <div data-region="job-list">${listMarkup(jobs, filter)}</div>
          </section>
          ${selectedId ? html`<div data-region="detail-slot">${detailSkeleton()}</div>` : ''}
        </div>
      </div>
    `;

    let listRegion = null;
    let detailSlot = null;

    function paintList() {
      listRegion = root.querySelector('[data-region="job-list"]');
      if (listRegion) {
        renderInto(listRegion, listMarkup(jobs, filter));
        if (selectedId) {
          const selected = listRegion.querySelector(`a[href="/jobs/${CSS.escape(selectedId)}"]`);
          if (selected) selected.classList.add('is-selected');
        }
      }
      const count = root.querySelector('[data-region="jobs-count"]');
      if (count) count.textContent = `${formatCount(jobs.length)} total`;
    }

    function paintDetail(job, { force = false } = {}) {
      if (!job) return;
      currentJob = job;
      detailSlot = root.querySelector('[data-region="detail-slot"]');
      if (!detailSlot) return;
      if (!initialDetailPainted || force) {
        renderInto(detailSlot, detailMarkup(job));
        initialDetailPainted = true;
        logsSignature = (job.logs || []).join('\n');
        const logView = root.querySelector('[data-region="detail-log"]');
        if (logView) logView.scrollTop = logView.scrollHeight;
        return;
      }

      const chrome = root.querySelector('[data-region="detail-chrome"]');
      if (chrome) renderInto(chrome, detailChromeMarkup(job));
      const count = root.querySelector('[data-log-count]');
      if (count) count.textContent = `${formatCount(job.logs?.length || 0)} lines`;
      const signature = (job.logs || []).join('\n');
      if (signature !== logsSignature) {
        const logView = root.querySelector('[data-region="detail-log"]');
        if (logView) {
          const follow =
            logView.scrollHeight - logView.scrollTop - logView.clientHeight < 90;
          renderInto(logView, logMarkup(job));
          if (follow) logView.scrollTop = logView.scrollHeight;
        }
        logsSignature = signature;
      }
    }

    function noteTransitions(nextJobs, { silent = false } = {}) {
      if (silent) {
        lastJobStates = new Map(nextJobs.map((job) => [job.id, job.status]));
        return;
      }
      for (const job of nextJobs) {
        const previous = lastJobStates.get(job.id);
        if (previous && previous !== job.status) {
          if (job.status === 'completed') {
            toast(`${job.title} finished downloading.`, 'success');
          } else if (job.status === 'failed') {
            toast(`${job.title} failed. Open the job for details.`, 'error', 6500);
          }
        }
      }
      lastJobStates = new Map(nextJobs.map((job) => [job.id, job.status]));
    }

    async function loadJobs({ initial = false } = {}) {
      const data = await api.jobs(ctx.signal);
      if (ctx.signal.aborted) return;
      jobs = Array.isArray(data.jobs) ? data.jobs : [];
      worker = data.worker;
      if (initial) {
        renderInto(root, shell());
        paintList();
        if (selectedId) {
          renderInto(
            root.querySelector('[data-region="detail-slot"]'),
            detailSkeleton(),
          );
        }
        initialDetailPainted = false;
      } else {
        paintList();
        const connection = root.querySelector('[data-region="connection"]');
        if (connection) renderInto(connection, connectionMarkup(worker));
      }
      noteTransitions(jobs, { silent: initial });
      ctx.updateStatus?.({ worker, auth: undefined });
    }

    async function loadDetail({ initial = false } = {}) {
      if (!selectedId) return;
      try {
        const data = await api.job(selectedId, { tail: 2000, signal: ctx.signal });
        if (ctx.signal.aborted) return;
        if (!data.job) throw new Error('Job not found.');
        paintDetail(data.job, { force: initial });
      } catch (error) {
        if (ctx.signal.aborted || error?.name === 'AbortError') return;
        if (initial) {
          const slot = root.querySelector('[data-region="detail-slot"]');
          if (slot) {
            renderInto(
              slot,
              html`<aside class="panel job-detail">${emptyState({
                iconName: 'alert',
                title: 'Could not load this job',
                description: error.message,
                action: html`<a class="button button--secondary button--small" href="/jobs">Back to jobs</a>`,
              })}</aside>`,
            );
          }
        }
      }
    }

    async function refreshAll({ initial = false, silent = false } = {}) {
      try {
        await loadJobs({ initial });
        await loadDetail({ initial: initial || !initialDetailPainted });
      } catch (error) {
        if (ctx.signal.aborted || error?.name === 'AbortError') return;
        if (initial) {
          renderInto(
            root,
            html`
              <div class="view">
                ${pageHeader({ eyebrow: 'Activity', title: 'Downloads' })}
                ${emptyState({
                  iconName: 'alert',
                  title: 'Could not load downloads',
                  description: error.message || 'The downloader container may still be starting.',
                  action: html`<button class="button button--secondary button--small" type="button" data-retry-jobs>Try again</button>`,
                })}
              </div>
            `,
          );
        } else if (!silent) {
          const connection = root.querySelector('[data-region="connection"]');
          if (connection) {
            renderInto(
              connection,
              html`<div class="notice notice--warning notice--wide" role="status">${icon('wifiOff', { size: 18 })}<div><strong>Connection lost.</strong><span>${error.message || 'Retrying automatically.'}</span></div></div>`,
            );
          }
        }
      }
    }

    await refreshAll({ initial: true });

    const schedule = () => {
      if (stopped) return;
      const active =
        jobs.some((job) => ACTIVE_STATUSES.has(job.status)) ||
        (currentJob && ACTIVE_STATUSES.has(currentJob.status));
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (stopped) return;
        if (!document.hidden) await refreshAll({ silent: true });
        schedule();
      }, active ? 2000 : 7000);
    };
    schedule();

    const onVisibility = () => {
      if (!document.hidden) refreshAll({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisibility);

    const onClick = async (event) => {
      const filterButton = event.target.closest('[data-filter]');
      if (filterButton) {
        filter = filterButton.dataset.filter;
        paintList();
        return;
      }

      if (event.target.closest('[data-refresh-jobs]')) {
        const button = event.target.closest('[data-refresh-jobs]');
        button.disabled = true;
        button.classList.add('is-spinning');
        try {
          await refreshAll({ silent: true });
          toast('Activity refreshed.', 'success');
        } catch {
          // refreshAll shows its own error
        } finally {
          button.disabled = false;
          button.classList.remove('is-spinning');
        }
        return;
      }

      const retry = event.target.closest('[data-retry-jobs]');
      if (retry) {
        retry.disabled = true;
        await refreshAll({ initial: true });
        return;
      }

      const cancelButton = event.target.closest('[data-cancel-job]');
      if (cancelButton) {
        const jobId = cancelButton.dataset.cancelJob;
        const confirmed = await confirmDialog({
          title: 'Cancel this download?',
          message:
            'The current downloader process will be stopped. Partial course videos already saved will remain in the library.',
          confirmLabel: 'Cancel download',
        });
        if (!confirmed) return;
        cancelButton.disabled = true;
        try {
          await api.cancelJob(jobId);
          toast('Cancellation requested.', 'success');
          await refreshAll({ silent: true });
        } catch (error) {
          toast(error instanceof ApiError ? error.message : 'Could not cancel the job.', 'error');
          cancelButton.disabled = false;
        }
        return;
      }

      const retryButton = event.target.closest('[data-retry-job]');
      if (retryButton) {
        retryButton.disabled = true;
        try {
          const { job } = await api.retryJob(retryButton.dataset.retryJob);
          toast('Download queued again.', 'success');
          ctx.refreshStatus?.();
          ctx.navigate(`/jobs/${job.id}`);
        } catch (error) {
          toast(error instanceof ApiError ? error.message : 'Could not retry the job.', 'error');
          retryButton.disabled = false;
        }
        return;
      }

      const copyButton = event.target.closest('[data-copy-log]');
      if (copyButton) {
        const logs = currentJob?.logs?.join('\n') || '';
        if (!logs) {
          toast('There is no log output to copy yet.', 'info');
          return;
        }
        const copied = await copyText(logs);
        toast(copied ? 'Execution log copied.' : 'Could not copy the log.', copied ? 'success' : 'error');
      }
    };

    root.addEventListener('click', onClick);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      root.removeEventListener('click', onClick);
    };
  },
};
