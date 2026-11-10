import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';

const CACHE_TTL_MS = 3500;
const MAX_FILES_PER_SCAN = 5000;
const MAX_LIBRARY_PATH_LENGTH = 2048;

const MIME_TYPES = new Map([
  ['.epub', 'application/epub+zip'],
  ['.pdf', 'application/pdf'],
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.mp3', 'audio/mpeg'],
  ['.m4a', 'audio/mp4'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.vtt', 'text/vtt; charset=utf-8'],
  ['.srt', 'text/plain; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.zip', 'application/zip'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
]);

const INLINE_TYPES = new Set([
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'audio/mpeg',
  'audio/mp4',
  'text/plain; charset=utf-8',
  'text/vtt; charset=utf-8',
]);

let cache = { at: 0, root: null, data: null, promise: null };

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function relativePath(root, absolute) {
  return toPosix(path.relative(root, absolute));
}

function classify(extension) {
  if (['.mp4', '.m4v', '.webm', '.mkv', '.mov'].includes(extension)) return 'video';
  if (['.txt', '.vtt', '.srt'].includes(extension)) return 'transcript';
  if (extension === '.pdf') return 'pdf';
  if (['.mp3', '.m4a'].includes(extension)) return 'audio';
  return 'other';
}

async function readDir(directory) {
  try {
    return await fsp.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

async function scanBookFiles(root) {
  const groups = new Map();
  const seen = new Set();
  const directories = ['epub', 'pdf', '.'];
  for (const directoryName of directories) {
    const directory = path.resolve(root, directoryName);
    for (const entry of await readDir(directory)) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const extension = path.extname(entry.name).toLowerCase();
      if (extension !== '.epub' && extension !== '.pdf') continue;
      const absolute = path.join(directory, entry.name);
      const rel = relativePath(root, absolute);
      if (seen.has(rel)) continue;
      seen.add(rel);
      let stat;
      try {
        stat = await fsp.stat(absolute);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.size <= 0) continue;
      const basename = path.basename(entry.name, extension);
      const key = basename.toLocaleLowerCase('en-US');
      const format = extension.slice(1);
      if (!groups.has(key)) {
        groups.set(key, {
          id: `book-${key}`,
          title: basename,
          formats: [],
          sizeBytes: 0,
          modifiedAt: stat.mtime.toISOString(),
        });
      }
      const group = groups.get(key);
      group.formats.push({
        format,
        fileName: entry.name,
        relativePath: rel,
        sizeBytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      });
      group.sizeBytes += stat.size;
      if (stat.mtime > new Date(group.modifiedAt)) {
        group.modifiedAt = stat.mtime.toISOString();
      }
    }
  }
  const books = [...groups.values()];
  for (const book of books) {
    book.formats.sort((a, b) => a.format.localeCompare(b.format));
  }
  books.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return books;
}

async function walkCourseFiles(directory, root, state, files) {
  const entries = await readDir(directory);
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkCourseFiles(absolute, root, state, files);
      if (state.truncated) return;
      continue;
    }
    if (!entry.isFile()) continue;
    if (state.files >= MAX_FILES_PER_SCAN) {
      state.truncated = true;
      return;
    }
    let stat;
    try {
      stat = await fsp.stat(absolute);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size <= 0) continue;
    const rel = relativePath(root, absolute);
    const relWithinCourse = relativePath(
      path.join(root, 'courses', state.courseDir),
      absolute,
    );
    const segments = relWithinCourse.split('/');
    const extension = path.extname(entry.name).toLowerCase();
    files.push({
      name: entry.name,
      relativePath: rel,
      chapter: segments.length > 1 ? segments[0] : 'Course files',
      kind: classify(extension),
      extension: extension.replace('.', ''),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
    });
    state.files += 1;
  }
}

async function scanCourses(root) {
  const courses = [];
  const coursesRoot = path.join(root, 'courses');
  const entries = await readDir(coursesRoot);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const courseDirectory = path.join(coursesRoot, entry.name);
    const state = { files: 0, truncated: false, courseDir: entry.name };
    const files = [];
    try {
      await walkCourseFiles(courseDirectory, root, state, files);
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    files.sort((a, b) => {
      const chapter = a.chapter.localeCompare(b.chapter, undefined, { numeric: true });
      return chapter || a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    const idMatch = entry.name.match(/^course-(\d{10,13})$/);
    const courseId = idMatch ? idMatch[1] : null;
    const sizeBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
    const modifiedAt = files.reduce(
      (latest, file) => (file.modifiedAt > latest ? file.modifiedAt : latest),
      files[0].modifiedAt,
    );
    courses.push({
      id: entry.name,
      courseId,
      title: courseId ? `Course ${courseId}` : entry.name.replace(/^course-/, 'Course '),
      relativeDir: `courses/${entry.name}`,
      files,
      fileCount: files.length,
      videoCount: files.filter((file) => file.kind === 'video').length,
      transcriptCount: files.filter((file) => file.kind === 'transcript').length,
      pdfCount: files.filter((file) => file.kind === 'pdf').length,
      sizeBytes,
      modifiedAt,
      truncated: state.truncated,
    });
  }
  courses.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  return courses;
}

export async function scanLibrary(root = config.downloadsDir) {
  const [books, courses] = await Promise.all([scanBookFiles(root), scanCourses(root)]);
  const totalBytes =
    books.reduce((sum, book) => sum + book.sizeBytes, 0) +
    courses.reduce((sum, course) => sum + course.sizeBytes, 0);
  const fileCount =
    books.reduce((sum, book) => sum + book.formats.length, 0) +
    courses.reduce((sum, course) => sum + course.fileCount, 0);
  return {
    books,
    courses,
    stats: {
      libraryItems: books.length + courses.length,
      bookCount: books.length,
      courseCount: courses.length,
      fileCount,
      totalBytes,
      scannedAt: new Date().toISOString(),
    },
  };
}

export async function getLibrary({ force = false } = {}) {
  const root = config.downloadsDir;
  const fresh = Date.now() - cache.at < CACHE_TTL_MS && cache.root === root;
  if (!force && fresh && cache.data) return cache.data;
  if (!force && cache.promise) return cache.promise;
  cache.promise = scanLibrary(root)
    .then((data) => {
      cache = { at: Date.now(), root, data, promise: null };
      return data;
    })
    .catch((error) => {
      cache.promise = null;
      throw error;
    });
  return cache.promise;
}

export function invalidateLibrary() {
  cache = { at: 0, root: null, data: null, promise: null };
}

export function applyCourseLabels(library, jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return library;
  const labels = new Map();
  for (const job of jobs) {
    if (job?.type !== 'course') continue;
    const id = job.input?.courseId;
    const label = job.input?.label;
    if (id && label && !labels.has(id)) labels.set(id, label);
  }
  if (labels.size === 0) return library;
  return {
    ...library,
    courses: library.courses.map((course) =>
      course.courseId && labels.has(course.courseId)
        ? { ...course, title: labels.get(course.courseId) }
        : course,
    ),
  };
}

async function realRoot(root) {
  try {
    return await fsp.realpath(root);
  } catch {
    return path.resolve(root);
  }
}

export async function resolveLibraryFile(relative, root = config.downloadsDir) {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new HttpError(400, 'A file path is required.');
  }
  if (relative.length > MAX_LIBRARY_PATH_LENGTH || relative.includes('\0')) {
    throw new HttpError(400, 'Invalid file path.');
  }
  if (relative.includes('\\') || relative.startsWith('/') || relative.startsWith('~')) {
    throw new HttpError(400, 'Invalid file path.');
  }
  const normalized = path.posix.normalize(relative);
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.startsWith('/')
  ) {
    throw new HttpError(400, 'Invalid file path.');
  }
  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, normalized);
  if (candidate !== rootResolved && !candidate.startsWith(rootResolved + path.sep)) {
    throw new HttpError(400, 'Invalid file path.');
  }
  let absolutePath;
  try {
    absolutePath = await fsp.realpath(candidate);
  } catch {
    throw new HttpError(404, 'File not found.');
  }
  const rootReal = await realRoot(rootResolved);
  if (absolutePath !== rootReal && !absolutePath.startsWith(rootReal + path.sep)) {
    throw new HttpError(403, 'That file is outside the downloads directory.');
  }
  let stat;
  try {
    stat = await fsp.stat(absolutePath);
  } catch {
    throw new HttpError(404, 'File not found.');
  }
  if (!stat.isFile()) throw new HttpError(404, 'File not found.');
  return { absolutePath, stat, relativePath: normalized };
}

function contentDisposition(fileName, disposition) {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

function parseRange(rangeHeader, size) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return { invalid: true };
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return { invalid: true };
  let start;
  let end;
  if (!rawStart) {
    const suffix = Number.parseInt(rawEnd, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { invalid: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number.parseInt(rawStart, 10);
    end = rawEnd ? Number.parseInt(rawEnd, 10) : size - 1;
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return { invalid: true };
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function serveLibraryFile(req, res, url) {
  const relative = url.searchParams.get('path');
  const forceDownload = url.searchParams.get('download') === '1';
  const { absolutePath, stat } = await resolveLibraryFile(relative);

  const fileName = path.basename(absolutePath);
  const extension = path.extname(fileName).toLowerCase();
  const mime = MIME_TYPES.get(extension) || 'application/octet-stream';
  const disposition = forceDownload || !INLINE_TYPES.has(mime) ? 'attachment' : 'inline';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', contentDisposition(fileName, disposition));
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
  res.setHeader('Last-Modified', stat.mtime.toUTCString());
  res.setHeader('ETag', etag);

  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Disposition');
    res.end();
    return;
  }

  const range = parseRange(req.headers.range, stat.size);
  if (range?.invalid) {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${stat.size}`);
    res.setHeader('Content-Length', '0');
    res.end();
    return;
  }

  let start = 0;
  let end = stat.size - 1;
  if (range) {
    start = range.start;
    end = range.end;
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  } else {
    res.statusCode = 200;
  }
  res.setHeader('Content-Length', String(Math.max(0, end - start + 1)));

  if (req.method === 'HEAD' || stat.size === 0) {
    res.end();
    return;
  }

  const stream = fs.createReadStream(absolutePath, { start, end });
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end();
    } else {
      res.destroy();
    }
  });
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
