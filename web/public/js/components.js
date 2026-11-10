import {
  html,
  icon,
  progressBar,
  relativeTime,
  statusBadge,
  statusMeta,
  jobTypeIcon,
  durationBetween,
} from './ui.js';

export function pageHeader({ eyebrow = '', title, description = '', actions = '' }) {
  return html`
    <header class="page-header">
      <div class="page-header__copy">
        ${eyebrow ? html`<p class="eyebrow">${eyebrow}</p>` : ''}
        <h1 class="page-title">${title}</h1>
        ${description ? html`<p class="page-description">${description}</p>` : ''}
      </div>
      ${actions ? html`<div class="page-header__actions">${actions}</div>` : ''}
    </header>
  `;
}

export function emptyState({ iconName = 'sparkles', title, description = '', action = '' }) {
  return html`
    <div class="empty-state">
      <span class="empty-state__icon">${icon(iconName, { size: 24 })}</span>
      <h3>${title}</h3>
      ${description ? html`<p>${description}</p>` : ''}
      ${action ? html`<div class="empty-state__action">${action}</div>` : ''}
    </div>
  `;
}

export function jobActivityRow(job, { compact = false } = {}) {
  const active = ['queued', 'running', 'cancelling'].includes(job.status);
  const meta = statusMeta(job.status);
  return html`
    <a class="activity-row ${active ? 'activity-row--active' : ''}" href="/jobs/${job.id}">
      <span class="activity-row__icon activity-row__icon--${job.type}">
        ${jobTypeIcon(job.type)}
      </span>
      <span class="activity-row__body">
        <span class="activity-row__top">
          <span class="activity-row__title">${job.title}</span>
          ${statusBadge(job.status)}
        </span>
        <span class="activity-row__meta">
          <span>${job.subtitle || (job.type === 'book' ? 'Book' : 'Video course')}</span>
          ${job.createdAt ? html`<span class="dot-separator"></span><span>${relativeTime(job.createdAt)}</span>` : ''}
          ${job.startedAt && job.finishedAt && job.status === 'completed' ? html`<span class="dot-separator"></span><span>${durationBetween(job.startedAt, job.finishedAt)}</span>` : ''}
        </span>
        ${active && !compact
          ? html`
              <span class="activity-row__progress">
                ${progressBar(job.progress, { thin: true })}
                <span class="activity-row__stage">${job.stage || meta.label}</span>
                <span class="activity-row__percent">${Math.round(job.progress || 0)}%</span>
              </span>
            `
          : ''}
        ${job.status === 'failed' && job.error && !compact
          ? html`<span class="activity-row__error">${job.error}</span>`
          : ''}
        ${job.warning && !compact
          ? html`<span class="activity-row__warning">${icon('alert', { size: 13 })}${job.warning}</span>`
          : ''}
      </span>
      <span class="activity-row__chevron">${icon('chevronRight', { size: 16 })}</span>
    </a>
  `;
}

export function authStatusPill(status) {
  const configured = status?.configured && status?.valid;
  return html`
    <span class="auth-pill ${configured ? 'auth-pill--ready' : 'auth-pill--missing'}">
      <span class="status-dot ${configured ? 'status-dot--success' : ''}"></span>
      <span>${status?.label || 'Cookies'}</span>
    </span>
  `;
}

export function formatChip(format) {
  return html`<span class="format-chip format-chip--${format}">${format.toUpperCase()}</span>`;
}
