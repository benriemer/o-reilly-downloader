import { api, ApiError } from '../api.js';
import { pageHeader } from '../components.js';
import {
  html,
  icon,
  relativeTime,
  renderInto,
  setButtonLoading,
  toast,
} from '../ui.js';

const BOOK_ID_RE = /^\d{10,13}$/;

function statusLabel(status) {
  if (!status?.configured) return 'Not configured';
  if (!status.valid) return status.error || 'Invalid file';
  return `${status.cookieCount} cookies · updated ${relativeTime(status.modifiedAt)}`;
}

function isReady(status) {
  return Boolean(status?.configured && status?.valid);
}

function authBlock(status, iconName, label, readyText) {
  const ready = isReady(status);
  return html`
    <div class="auth-detail">
      <span class="auth-detail__icon ${ready ? 'auth-detail__icon--ready' : ''}">${icon(iconName, { size: 18 })}</span>
      <div class="auth-detail__copy">
        <strong>${label}</strong>
        <span class="${ready ? 'muted' : 'text-warning'}">${ready ? readyText : statusLabel(status)}</span>
      </div>
      <span class="status-dot ${ready ? 'status-dot--success' : 'status-dot--warning'}"></span>
    </div>
  `;
}

function asideMarkup(cookies, error) {
  return html`
    <section class="panel panel--sticky">
      <div class="panel__header">
        <div>
          <p class="eyebrow">Prerequisites</p>
          <h2>Access check</h2>
        </div>
        <button class="icon-button icon-button--subtle" type="button" data-recheck-auth aria-label="Recheck authentication" title="Recheck authentication">${icon('refresh', { size: 16 })}</button>
      </div>
      ${error ? html`<div class="notice notice--warning">${icon('alert', { size: 16 })}<span>Could not check authentication: ${error}</span></div>` : ''}
      <div class="auth-details">
        ${authBlock(cookies?.book, 'book', 'Book cookies', 'Ready for EPUB and PDF')}
        ${authBlock(cookies?.course, 'video', 'Full course cookies', 'Ready for video and transcripts')}
      </div>
      <a class="text-link text-link--full" href="/settings">Manage authentication ${icon('arrowRight', { size: 14 })}</a>
    </section>

    <section class="panel">
      <div class="panel__header">
        <div>
          <p class="eyebrow">Good to know</p>
          <h2>Before you start</h2>
        </div>
      </div>
      <ol class="steps-list">
        <li>
          <span class="step-index">1</span>
          <div>
            <strong>Use your own access</strong>
            <p>Only download content your O'Reilly account is authorized to access.</p>
          </div>
        </li>
        <li>
          <span class="step-index">2</span>
          <div>
            <strong>Keep cookies current</strong>
            <p>Expired cookies are the most common cause of failed downloads.</p>
          </div>
        </li>
        <li>
          <span class="step-index">3</span>
          <div>
            <strong>Everything stays local</strong>
            <p>Downloads are written to the shared Docker volume and served only after signing in.</p>
          </div>
        </li>
      </ol>
    </section>
  `;
}

function authNotice(status, kind) {
  if (isReady(status)) return html``;
  const name = kind === 'book' ? 'Book cookies' : 'Full course cookies';
  return html`
    <div class="notice notice--warning form-auth-notice">
      ${icon('alert', { size: 16 })}
      <span>${name} are not ready. <a href="/settings">Add them in Settings</a> before starting this download.</span>
    </div>
  `;
}

function baseMarkup(activeType, cookies, authError) {
  return html`
    <div class="view view--download">
      ${pageHeader({
        eyebrow: 'New download',
        title: 'Bring something offline.',
        description: 'Queue a book or a video course. The downloader does the rest in the background.',
      })}
      <div class="download-layout">
        <div class="download-main">
          <div class="type-switch" role="tablist" aria-label="Download type">
            <button class="type-tab ${activeType === 'book' ? 'is-active' : ''}" type="button" role="tab" aria-selected="${activeType === 'book'}" data-type-tab="book">
              <span class="type-tab__icon">${icon('book', { size: 17 })}</span>
              <span><strong>Book</strong><small>EPUB or PDF</small></span>
            </button>
            <button class="type-tab ${activeType === 'course' ? 'is-active' : ''}" type="button" role="tab" aria-selected="${activeType === 'course'}" data-type-tab="course">
              <span class="type-tab__icon">${icon('video', { size: 17 })}</span>
              <span><strong>Video course</strong><small>Videos + transcripts</small></span>
            </button>
          </div>

          <section class="panel form-panel ${activeType === 'book' ? '' : 'is-hidden'}" data-panel="book" role="tabpanel" aria-label="Book download">
            <div class="panel__header">
              <div>
                <p class="eyebrow">Book</p>
                <h2>Download a book</h2>
              </div>
              <span class="format-chip format-chip--muted">EPUB · PDF</span>
            </div>
            <div data-auth-notice="book">${authNotice(cookies?.book, 'book')}</div>
            <div class="form-alert" data-form-error="book" hidden></div>
            <form data-book-form novalidate>
              <div class="form-grid">
                <label class="field field--full">
                  <span class="field__label">Book ID</span>
                  <input class="input" name="bookId" inputmode="numeric" autocomplete="off" placeholder="9780321635754" pattern="[0-9]{10,13}" />
                  <span class="field__hint">The 10–13 digit ID found in the O'Reilly book URL.</span>
                </label>
                <label class="field field--full">
                  <span class="field__label">Title</span>
                  <input class="input" name="title" autocomplete="off" maxlength="100" placeholder="e.g. The Art of Computer Programming" />
                  <span class="field__hint">Used as the filename. Slashes and glob characters are not allowed.</span>
                </label>
              </div>
              <fieldset class="field">
                <legend class="field__label">Format</legend>
                <div class="segmented">
                  <label class="segmented__option">
                    <input type="radio" name="format" value="epub" />
                    <span>EPUB</span>
                  </label>
                  <label class="segmented__option">
                    <input type="radio" name="format" value="pdf" />
                    <span>PDF</span>
                  </label>
                  <label class="segmented__option">
                    <input type="radio" name="format" value="both" checked />
                    <span>Both</span>
                  </label>
                </div>
                <span class="field__hint">PDF conversion can take a few extra minutes.</span>
              </fieldset>
              <div class="form-actions">
                <button class="button button--primary" type="submit" data-book-submit ${isReady(cookies?.book) || authError ? '' : 'disabled'}>
                  ${icon('download', { size: 16 })}<span>Start book download</span>
                </button>
                <span class="form-actions__note">Runs as an asynchronous job.</span>
              </div>
            </form>
          </section>

          <section class="panel form-panel ${activeType === 'course' ? '' : 'is-hidden'}" data-panel="course" role="tabpanel" aria-label="Course download">
            <div class="panel__header">
              <div>
                <p class="eyebrow">Video course</p>
                <h2>Download a course</h2>
              </div>
              <span class="format-chip format-chip--muted">MP4 · TXT</span>
            </div>
            <div data-auth-notice="course">${authNotice(cookies?.course, 'course')}</div>
            <div class="form-alert" data-form-error="course" hidden></div>
            <form data-course-form novalidate>
              <div class="form-grid">
                <label class="field field--full">
                  <span class="field__label">Course URL</span>
                  <input class="input" name="courseUrl" type="url" autocomplete="off" placeholder="https://learning.oreilly.com/course/building-ai-agents/0642572077884/" />
                  <span class="field__hint">Paste the full course URL. It must end with the course's 10–13 digit ID.</span>
                </label>
                <label class="field field--full">
                  <span class="field__label">Label <span class="field__optional">optional</span></span>
                  <input class="input" name="label" autocomplete="off" maxlength="120" placeholder="A friendly name for your library" />
                  <span class="field__hint">Only used for display. The course folder is named from its ID.</span>
                </label>
              </div>
              <label class="switch-row">
                <span class="switch">
                  <input type="checkbox" name="transcriptsOnly" />
                  <span class="switch__track" aria-hidden="true"><span class="switch__thumb"></span></span>
                </span>
                <span class="switch-row__copy">
                  <strong>Transcripts only</strong>
                  <span>Skip video files and save just the lesson transcripts.</span>
                </span>
              </label>
              <div class="form-actions">
                <button class="button button--primary" type="submit" data-course-submit ${isReady(cookies?.course) || authError ? '' : 'disabled'}>
                  ${icon('download', { size: 16 })}<span>Start course download</span>
                </button>
                <span class="form-actions__note">Videos download one lesson at a time.</span>
              </div>
            </form>
          </section>

          <p class="download-legal">
            ${icon('shield', { size: 14 })}
            Use only with content you are authorized to access and in line with O'Reilly's terms.
          </p>
        </div>
        <aside class="download-aside" data-auth-aside>${asideMarkup(cookies, authError)}</aside>
      </div>
    </div>
  `;
}

function showError(root, formName, message) {
  const box = root.querySelector(`[data-form-error="${formName}"]`);
  if (!box) return;
  box.hidden = !message;
  box.textContent = message || '';
}

function setAuthNotices(root, cookies, authError) {
  const notices = {
    book: root.querySelector('[data-auth-notice="book"]'),
    course: root.querySelector('[data-auth-notice="course"]'),
  };
  for (const kind of ['book', 'course']) {
    if (notices[kind]) renderInto(notices[kind], authNotice(cookies?.[kind], kind));
  }
  root.querySelectorAll('[data-book-submit]').forEach((button) => {
    button.disabled = !isReady(cookies?.book) && !authError;
  });
  root.querySelectorAll('[data-course-submit]').forEach((button) => {
    button.disabled = !isReady(cookies?.course) && !authError;
  });
  const aside = root.querySelector('[data-auth-aside]');
  if (aside) renderInto(aside, asideMarkup(cookies, authError));
}

function validateBook(values) {
  if (!BOOK_ID_RE.test(values.bookId.trim())) {
    return 'Enter a book ID containing 10 to 13 digits.';
  }
  const title = values.title.trim();
  if (!title) return 'Add a title for the downloaded file.';
  if (title.length > 100) return 'Titles must be 100 characters or fewer.';
  if (/^[.-]/.test(title)) return 'Titles cannot start with a dot or a hyphen.';
  if (/[/\\\x00-\x1f\x7f*?[\]]/.test(title)) {
    return 'Titles cannot contain slashes, control characters, or * ? [ ].';
  }
  if (!['epub', 'pdf', 'both'].includes(values.format)) {
    return 'Choose EPUB, PDF, or both.';
  }
  return null;
}

function parseCourseUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'learning.oreilly.com') {
      return null;
    }
    if (url.username || url.password) return null;
    const path = url.pathname.replace(/\/+$/, '');
    if (!path.includes('/course/')) return null;
    const match = path.match(/\/(\d{10,13})$/);
    if (!match) return null;
    return { url, courseId: match[1] };
  } catch {
    return null;
  }
}

export const downloadView = {
  id: 'download',
  title: 'New download',
  async mount(root, ctx) {
    document.title = 'New download · Shelf';
    let activeType = new URLSearchParams(window.location.search).get('type') === 'course'
      ? 'course'
      : 'book';
    let cookies = { book: null, course: null };
    let authError = null;

    renderInto(root, html`<div class="view" aria-busy="true"><div class="skeleton skeleton--panel skeleton--tall"></div></div>`);
    try {
      const data = await api.cookies(ctx.signal);
      cookies = data.cookies;
    } catch (error) {
      if (error?.name === 'AbortError') return undefined;
      authError = error.message;
    }
    if (ctx.signal.aborted) return undefined;
    renderInto(root, baseMarkup(activeType, cookies, authError));

    const bookForm = root.querySelector('[data-book-form]');
    const courseForm = root.querySelector('[data-course-form]');
    const bookSubmit = root.querySelector('[data-book-submit]');
    const courseSubmit = root.querySelector('[data-course-submit]');

    const setType = (type, { updateUrl = true } = {}) => {
      activeType = type === 'course' ? 'course' : 'book';
      root.querySelectorAll('[data-type-tab]').forEach((tab) => {
        const selected = tab.dataset.typeTab === activeType;
        tab.classList.toggle('is-active', selected);
        tab.setAttribute('aria-selected', String(selected));
      });
      root.querySelectorAll('[data-panel]').forEach((panel) => {
        panel.classList.toggle('is-hidden', panel.dataset.panel !== activeType);
      });
      if (updateUrl) {
        history.replaceState(null, '', `/download?type=${activeType}`);
      }
    };

    root.querySelectorAll('[data-type-tab]').forEach((tab) => {
      tab.addEventListener('click', () => setType(tab.dataset.typeTab));
    });

    const onSubmit = async (event, type) => {
      event.preventDefault();
      const isBook = type === 'book';
      const form = isBook ? bookForm : courseForm;
      const submit = isBook ? bookSubmit : courseSubmit;
      if (!form || !submit || submit.disabled) return;
      showError(root, type, '');
      const formData = new FormData(form);
      let payload;
      if (isBook) {
        const values = {
          bookId: String(formData.get('bookId') || ''),
          title: String(formData.get('title') || ''),
          format: String(formData.get('format') || 'both'),
        };
        const error = validateBook(values);
        if (error) {
          showError(root, type, error);
          return;
        }
        payload = { type: 'book', ...values, bookId: values.bookId.trim(), title: values.title.trim() };
      } else {
        const courseUrl = String(formData.get('courseUrl') || '').trim();
        const parsed = parseCourseUrl(courseUrl);
        if (!parsed) {
          showError(root, type, 'Paste a valid https://learning.oreilly.com/course/… URL ending with the course ID.');
          return;
        }
        payload = {
          type: 'course',
          courseUrl,
          label: String(formData.get('label') || '').trim() || undefined,
          transcriptsOnly: formData.get('transcriptsOnly') === 'on',
        };
      }
      setButtonLoading(submit, true, 'Queueing…');
      try {
        const { job } = await api.createJob(payload);
        toast('Download queued.', 'success');
        ctx.refreshStatus?.();
        ctx.navigate(`/jobs/${job.id}`);
      } catch (error) {
        showError(root, type, error instanceof ApiError ? error.message : 'Could not queue the download.');
      } finally {
        setButtonLoading(submit, false);
        submit.disabled = !isReady(cookies?.[type]) && !authError;
      }
    };

    bookForm?.addEventListener('submit', (event) => onSubmit(event, 'book'));
    courseForm?.addEventListener('submit', (event) => onSubmit(event, 'course'));

    const bindRecheck = () => {
      root.querySelectorAll('[data-recheck-auth]').forEach((button) => {
        button.addEventListener('click', async () => {
          button.disabled = true;
          button.classList.add('is-spinning');
          try {
            const data = await api.cookies();
            cookies = data.cookies;
            authError = null;
            setAuthNotices(root, cookies, authError);
            bindRecheck();
            toast('Authentication status refreshed.', 'success');
          } catch (error) {
            authError = error.message;
            setAuthNotices(root, cookies, authError);
            bindRecheck();
            toast(error.message || 'Could not recheck authentication.', 'error');
          }
        });
      });
    };
    bindRecheck();

    root.querySelector('[data-book-form] input[name="bookId"]')?.focus();
    return undefined;
  },
};
