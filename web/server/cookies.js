import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';

const MAX_COOKIE_FILE_BYTES = 1024 * 1024;
const MAX_COOKIE_ENTRIES = 400;

export const COOKIE_DEFINITIONS = Object.freeze({
  book: {
    kind: 'book',
    fileName: 'cookies.json',
    label: 'Book cookies',
    requiredFor: 'EPUB and PDF downloads',
  },
  course: {
    kind: 'course',
    fileName: 'cookies_full.json',
    label: 'Full course cookies',
    requiredFor: 'Video and transcript downloads',
  },
});

function definitionFor(kind) {
  const definition = COOKIE_DEFINITIONS[kind];
  if (!definition) throw new HttpError(404, 'Unknown cookie type.');
  return definition;
}

async function inspectCookieFile(definition) {
  const filePath = path.join(config.configDir, definition.fileName);
  const status = {
    ...definition,
    configured: false,
    valid: false,
    cookieCount: 0,
    sizeBytes: 0,
    modifiedAt: null,
    error: null,
  };
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') status.error = 'Unable to read the cookie file.';
    return status;
  }
  if (!stat.isFile()) {
    status.error = 'Expected a regular file.';
    return status;
  }
  status.configured = true;
  status.sizeBytes = stat.size;
  status.modifiedAt = stat.mtime.toISOString();
  if (stat.size > MAX_COOKIE_FILE_BYTES) {
    status.error = 'Cookie file is unexpectedly large.';
    return status;
  }
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      status.error = 'Expected a JSON object of cookie names and values.';
      return status;
    }
    const entries = Object.entries(parsed);
    if (entries.length === 0) {
      status.error = 'The cookie file is empty.';
      return status;
    }
    if (
      entries.length > MAX_COOKIE_ENTRIES ||
      !entries.every(
        ([name, value]) =>
          typeof name === 'string' &&
          name.length > 0 &&
          typeof value === 'string',
      )
    ) {
      status.error = 'Cookie names and values must be strings.';
      return status;
    }
    status.valid = true;
    status.cookieCount = entries.length;
  } catch {
    status.error = 'File is not valid JSON.';
  }
  return status;
}

export async function getCookieStatuses() {
  const [book, course] = await Promise.all([
    inspectCookieFile(COOKIE_DEFINITIONS.book),
    inspectCookieFile(COOKIE_DEFINITIONS.course),
  ]);
  return { book, course };
}

function parseCookieText(text) {
  if (typeof text !== 'string') {
    throw new HttpError(400, 'Paste the cookie JSON into the text field.');
  }
  const trimmed = text.trim();
  if (!trimmed) throw new HttpError(400, 'Paste the cookie JSON into the text field.');
  if (Buffer.byteLength(trimmed, 'utf8') > MAX_COOKIE_FILE_BYTES) {
    throw new HttpError(413, 'Cookie JSON is too large.');
  }
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
    // The browser console snippet is sometimes copied with an extra layer of
    // JSON string encoding. Accept that common form.
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
  } catch {
    throw new HttpError(400, 'That is not valid JSON. Copy the object produced by the console snippet.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Cookie JSON must be an object of names and values.');
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new HttpError(400, 'The cookie JSON is empty.');
  }
  if (entries.length > MAX_COOKIE_ENTRIES) {
    throw new HttpError(400, 'There are too many cookie entries.');
  }
  if (
    !entries.every(
      ([name, value]) =>
        typeof name === 'string' &&
        name.length > 0 &&
        name.length <= 256 &&
        typeof value === 'string',
    )
  ) {
    throw new HttpError(400, 'Cookie names and values must be strings.');
  }
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export async function saveCookies(kind, cookiesText) {
  const definition = definitionFor(kind);
  const serialized = parseCookieText(cookiesText);
  const directory = config.configDir;
  const destination = path.join(directory, definition.fileName);
  const temporary = path.join(
    directory,
    `.${definition.fileName}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  let handle;
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(serialized, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, destination);
    await fs.chmod(destination, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    if (['EACCES', 'EPERM', 'EROFS'].includes(error.code)) {
      throw new HttpError(
        422,
        'The config directory is not writable by the web container. Check LOCAL_UID/LOCAL_GID or place the cookie file in ./config manually.',
        'CONFIG_NOT_WRITABLE',
      );
    }
    throw new HttpError(500, 'Could not save the cookie file.');
  }
  console.log(`Updated ${definition.fileName} (${kind} cookies).`);
  return inspectCookieFile(definition);
}

export async function deleteCookies(kind) {
  const definition = definitionFor(kind);
  const destination = path.join(config.configDir, definition.fileName);
  try {
    await fs.unlink(destination);
    console.log(`Removed ${definition.fileName}.`);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new HttpError(422, 'Could not remove the cookie file.');
    }
  }
  return inspectCookieFile(definition);
}
