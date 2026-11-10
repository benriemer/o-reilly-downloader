import { api } from '../api.js';
import { emptyState, pageHeader } from '../components.js';
import {
  courseFileIcon,
  html,
  icon,
  libraryFileUrl,
  plural,
  relativeTime,
  renderInto,
  setButtonLoading,
  toast,
  formatBytes,
  formatCount,
} from '../ui.js';

const BOOK_FILTERS = new Set(['epub', 'pdf']);
const INLINE_KINDS = new Set(['video', 'transcript', 'pdf', 'audio']);

function hashTone(title) {
  let hash = 0;
  for (const character of String(title)) hash = (hash + character.charCodeAt(0)) % 5;
  return hash;
}

function summaryMarkup(library) {
  return html`
    <span class="summary-chip">${icon('book', { size: 15 })}${formatCount(library.stats.bookCount)} ${plural(library.stats.bookCount, 'book')}</span>
    <span class="summary-chip">${icon('video', { size: 15 })}${formatCount(library.stats.courseCount)} ${plural(library.stats.courseCount, 'course')}</span>
    <span class="summary-chip">${icon('hardDrive', { size: 15 })}${formatBytes(library.stats.totalBytes)}</span>
  `;
}

function bookCard(book) {
  const tone = hashTone(book.title);
  return html`
    <article class="book-card book-card--tone-${tone}">
      <div class="book-card__visual">
        <span class="book-card__spine"></span>
        <span class="book-card__icon">${icon('book', { size: 24 })}</span>
        <div class="book-card__formats">
          ${book.formats.map((format) => html`<span class="format-chip format-chip--${format.format}">${format.format.toUpperCase()}</span>`)}
        </div>
      </div>
      <div class="book-card__body">
        <h3 title="${book.title}">${book.title}</h3>
        <p>${formatBytes(book.sizeBytes)} · ${relativeTime(book.modifiedAt)}</p>
        <div class="book-card__actions">
          ${book.formats.map((format) =>
            format.format === 'pdf'
              ? html`<a class="button button--small button--secondary" href="${libraryFileUrl(format.relativePath)}" target="_blank" rel="noopener">${icon('external', { size: 14 })}Open PDF</a>`
              : html`<a class="button button--small button--ghost" href="${libraryFileUrl(format.relativePath, { download: true })}" download>${icon('download', { size: 14 })}EPUB</a>`,
          )}
        </div>
      </div>
    </article>
  `;
}

function groupFiles(files) {
  const groups = new Map();
  for (const file of files) {
    if (!groups.has(file.chapter)) groups.set(file.chapter, []);
    groups.get(file.chapter).push(file);
  }
  return [...groups.entries()];
}

function fileRow(file) {
  const canOpen = INLINE_KINDS.has(file.kind);
  return html`
    <div class="file-row">
      <span class="file-row__icon file-row__icon--${file.kind}">${courseFileIcon(file.kind)}</span>
      <span class="file-row__name" title="${file.name}">${file.name}</span>
      <span class="file-row__meta">${formatBytes(file.sizeBytes)}</span>
      <span class="file-row__actions">
        ${canOpen
          ? html`<a class="icon-button icon-button--subtle" href="${libraryFileUrl(file.relativePath)}" target="_blank" rel="noopener" aria-label="Open ${file.name}" title="Open">${icon('external', { size: 15 })}</a>`
          : ''}
        <a class="icon-button icon-button--subtle" href="${libraryFileUrl(file.relativePath, { download: true })}" download aria-label="Download ${file.name}" title="Download">${icon('download', { size: 15 })}</a>
      </span>
    </div>
  `;
}

function courseCard(course, { query = '' } = {}) {
  const lowered = query.toLowerCase();
  const fileMatches = lowered
    ? course.files.filter((file) => file.name.toLowerCase().includes(lowered))
    : course.files;
  const titleMatches = lowered ? course.title.toLowerCase().includes(lowered) : true;
  const visibleFiles = lowered && !titleMatches && fileMatches.length > 0 ? fileMatches : course.files;
  const forcedOpen = Boolean(lowered) && fileMatches.length > 0;
  const groups = groupFiles(visibleFiles);
  return html`
    <article class="course-card">
      <div class="course-card__header">
        <span class="course-card__cover">
          <span class="course-card__cover-glow"></span>
          ${icon('play', { size: 24 })}
        </span>
        <div class="course-card__copy">
          <div class="course-card__titleline">
            <h3>${course.title}</h3>
            <span class="format-chip format-chip--course">Course</span>
          </div>
          <p>
            ${formatCount(course.videoCount)} ${plural(course.videoCount, 'lesson')}
            <span class="dot-separator"></span>
            ${formatCount(course.transcriptCount)} ${plural(course.transcriptCount, 'transcript')}
            <span class="dot-separator"></span>
            ${formatBytes(course.sizeBytes)}
            <span class="dot-separator"></span>
            ${relativeTime(course.modifiedAt)}
          </p>
        </div>
        <span class="course-card__id mono">${course.courseId ? `#${course.courseId}` : ''}</span>
      </div>
      <details class="course-files" ${forcedOpen ? 'open' : ''}>
        <summary>
          <span>${icon('folder', { size: 15 })}Browse ${formatCount(visibleFiles.length)} ${plural(visibleFiles.length, 'file')}${lowered && fileMatches.length ? ` · ${formatCount(fileMatches.length)} matching` : ''}</span>
          <span class="course-files__chevron">${icon('chevronDown', { size: 15 })}</span>
        </summary>
        <div class="course-files__body">
          ${groups.map(
            ([chapter, files]) => html`
              <div class="file-group">
                <h4>${chapter}<span>${formatCount(files.length)}</span></h4>
                <div class="file-group__rows">${files.map(fileRow)}</div>
              </div>
            `,
          )}
        </div>
      </details>
      ${course.truncated
        ? html`<p class="course-card__truncated">${icon('info', { size: 13 })}This course has more files than Shelf lists at once.</p>`
        : ''}
    </article>
  `;
}

function resultsMarkup(library, { query, filter, sort }) {
  const lowered = query.trim().toLowerCase();
  let books = library.books.filter((book) => {
    if (filter === 'courses') return false;
    if (BOOK_FILTERS.has(filter) && !book.formats.some((format) => format.format === filter)) {
      return false;
    }
    return !lowered || book.title.toLowerCase().includes(lowered);
  });
  let courses = library.courses.filter((course) => {
    if (filter === 'books' || BOOK_FILTERS.has(filter)) return false;
    if (!lowered) return true;
    return (
      course.title.toLowerCase().includes(lowered) ||
      course.files.some((file) => file.name.toLowerCase().includes(lowered))
    );
  });

  const compare = {
    newest: (a, b) => String(b.modifiedAt).localeCompare(String(a.modifiedAt)),
    title: (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true }),
    size: (a, b) => b.sizeBytes - a.sizeBytes,
  }[sort];
  books = [...books].sort(compare);
  courses = [...courses].sort(compare);

  if (books.length === 0 && courses.length === 0) {
    return emptyState({
      iconName: lowered || filter !== 'all' ? 'search' : 'library',
      title: lowered || filter !== 'all' ? 'No matching downloads' : 'Your library is empty',
      description:
        lowered || filter !== 'all'
          ? 'Try a different search or filter.'
          : 'Finished books and courses will be collected here automatically.',
      action:
        lowered || filter !== 'all'
          ? ''
          : html`<a class="button button--secondary button--small" href="/download">${icon('plus', { size: 15 })}New download</a>`,
    });
  }

  return html`
    ${books.length
      ? html`
          <section class="library-section">
            <div class="section-heading">
              <div><p class="eyebrow">Books</p><h2>${formatCount(books.length)} ${plural(books.length, 'book')}</h2></div>
            </div>
            <div class="book-grid">${books.map(bookCard)}</div>
          </section>
        `
      : ''}
    ${courses.length
      ? html`
          <section class="library-section">
            <div class="section-heading">
              <div><p class="eyebrow">Courses</p><h2>${formatCount(courses.length)} ${plural(courses.length, 'course')}</h2></div>
            </div>
            <div class="course-list">${courses.map((course) => courseCard(course, { query: lowered }))}</div>
          </section>
        `
      : ''}
  `;
}

function viewMarkup(library) {
  return html`
    <div class="view view--library">
      ${pageHeader({
        eyebrow: 'Library',
        title: 'Your collection.',
        description: 'Books and courses downloaded by the service, ready to open or take with you.',
        actions: html`
          <button class="button button--secondary" type="button" data-refresh-library>${icon('refresh', { size: 15 })}Refresh</button>
          <a class="button button--primary" href="/download">${icon('plus', { size: 16 })}New download</a>
        `,
      })}
      <div class="library-summary" data-region="library-summary">${summaryMarkup(library)}</div>
      <section class="panel library-panel">
        <div class="library-toolbar">
          <label class="search-field">
            <span class="search-field__icon">${icon('search', { size: 17 })}</span>
            <input class="input" type="search" placeholder="Search titles and files…" aria-label="Search library" data-library-search value="${new URLSearchParams(window.location.search).get('q') || ''}" />
          </label>
          <div class="library-controls">
            <div class="filter-tabs filter-tabs--compact" role="group" aria-label="Filter library">
              <button class="filter-tab is-active" type="button" data-library-filter="all" aria-pressed="true">All</button>
              <button class="filter-tab" type="button" data-library-filter="books" aria-pressed="false">Books</button>
              <button class="filter-tab" type="button" data-library-filter="courses" aria-pressed="false">Courses</button>
              <button class="filter-tab" type="button" data-library-filter="epub" aria-pressed="false">EPUB</button>
              <button class="filter-tab" type="button" data-library-filter="pdf" aria-pressed="false">PDF</button>
            </div>
            <label class="select-field">
              <span>Sort</span>
              <select class="select" data-library-sort aria-label="Sort library">
                <option value="newest">Newest</option>
                <option value="title">Title</option>
                <option value="size">Largest</option>
              </select>
            </label>
          </div>
        </div>
        <div class="library-results" data-region="library-results">${resultsMarkup(library, { query: new URLSearchParams(window.location.search).get('q') || '', filter: 'all', sort: 'newest' })}</div>
      </section>
    </div>
  `;
}

function errorMarkup(error) {
  return html`
    <div class="view">
      ${pageHeader({ eyebrow: 'Library', title: 'Your collection.' })}
      ${emptyState({
        iconName: 'alert',
        title: 'Could not load the library',
        description: error.message || 'Check that the downloads volume is available.',
        action: html`<button class="button button--secondary button--small" type="button" data-retry-library>Try again</button>`,
      })}
    </div>
  `;
}

export const libraryView = {
  id: 'library',
  title: 'Library',
  async mount(root, ctx) {
    document.title = 'Library · Shelf';
    renderInto(root, html`<div class="view" aria-busy="true"><div class="skeleton skeleton--heading"></div><div class="skeleton skeleton--panel skeleton--tall"></div></div>`);
    const forceRefresh =
      new URLSearchParams(window.location.search).get('refresh') === '1';
    let library;
    try {
      library = await api.library({ refresh: forceRefresh, signal: ctx.signal });
    } catch (error) {
      if (error?.name === 'AbortError') return undefined;
      renderInto(root, errorMarkup(error));
      root.querySelector('[data-retry-library]')?.addEventListener('click', () => {
        ctx.navigate('/library?refresh=1', { replace: true });
      });
      return undefined;
    }
    if (ctx.signal.aborted) return undefined;

    let query = new URLSearchParams(window.location.search).get('q') || '';
    let filter = 'all';
    let sort = 'newest';
    if (forceRefresh) {
      const params = new URLSearchParams(window.location.search);
      params.delete('refresh');
      const suffix = params.toString() ? `?${params}` : '';
      history.replaceState(null, '', `/library${suffix}`);
    }
    renderInto(root, viewMarkup(library));

    const results = root.querySelector('[data-region="library-results"]');
    const summary = root.querySelector('[data-region="library-summary"]');
    const search = root.querySelector('[data-library-search]');

    const paint = () => {
      renderInto(results, resultsMarkup(library, { query, filter, sort }));
      renderInto(summary, summaryMarkup(library));
      root.querySelectorAll('[data-library-filter]').forEach((button) => {
        const active = button.dataset.libraryFilter === filter;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      const params = new URLSearchParams(window.location.search);
      params.delete('refresh');
      if (query) params.set('q', query);
      else params.delete('q');
      const suffix = params.toString() ? `?${params}` : '';
      history.replaceState(null, '', `/library${suffix}`);
    };

    let searchTimer = null;
    const onInput = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        query = search.value;
        paint();
      }, 120);
    };

    const onClick = (event) => {
      const filterButton = event.target.closest('[data-library-filter]');
      if (filterButton) {
        filter = filterButton.dataset.libraryFilter;
        paint();
        return;
      }
      if (event.target.closest('[data-refresh-library]')) {
        const button = event.target.closest('[data-refresh-library]');
        setButtonLoading(button, true, 'Refreshing…');
        api
          .library({ refresh: true })
          .then((next) => {
            library = next;
            paint();
            toast('Library refreshed.', 'success');
          })
          .catch((error) => toast(error.message || 'Could not refresh the library.', 'error'))
          .finally(() => setButtonLoading(button, false));
      }
    };

    const onSort = () => {
      sort = root.querySelector('[data-library-sort]').value;
      paint();
    };

    search.addEventListener('input', onInput);
    root.addEventListener('click', onClick);
    root.querySelector('[data-library-sort]').addEventListener('change', onSort);

    return () => {
      clearTimeout(searchTimer);
      search.removeEventListener('input', onInput);
      root.removeEventListener('click', onClick);
    };
  },
};
