import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import test from 'node:test';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'shelf-server-'));
const configDir = path.join(temp, 'config');
const downloadsDir = path.join(temp, 'downloads');
await fs.mkdir(configDir, { recursive: true });
await fs.mkdir(path.join(downloadsDir, 'epub'), { recursive: true });
await fs.mkdir(path.join(downloadsDir, 'courses', 'course-5555555555', 'Chapter'), {
  recursive: true,
});
await fs.writeFile(
  path.join(downloadsDir, 'epub', 'Integration Book.epub'),
  'integration-epub-content',
);
await fs.writeFile(
  path.join(downloadsDir, 'courses', 'course-5555555555', 'Chapter', 'Lesson.txt'),
  'transcript',
);

const secret = 'integration-cookie-secret-value';
const password = 'integration-password';
const stdout = [];
const stderr = [];
let child;
let base;
let sessionCookie = '';

test.before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: '0',
      HOST: '127.0.0.1',
      DOWNLOADS_DIR: downloadsDir,
      CONFIG_DIR: configDir,
      WORKER_URL: 'http://127.0.0.1:1',
      APP_PASSWORD: password,
      SESSION_SECRET: 'integration-session-secret',
      COOKIE_SECURE: '0',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
  const lines = readline.createInterface({ input: child.stdout });
  const listening = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Server did not start in time.')),
      8000,
    );
    lines.on('line', (line) => {
      stdout.push(line);
      const match = /listening on 127\.0\.0\.1:(\d+)/.exec(line);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}.`));
    });
  });
  const port = await listening;
  base = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (child && child.exitCode == null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
    if (child.exitCode == null) child.kill('SIGKILL');
  }
  await fs.rm(temp, { recursive: true, force: true });
});

async function request(route, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { Accept: 'application/json', ...headers };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (sessionCookie) requestHeaders.Cookie = sessionCookie;
  return fetch(`${base}${route}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
}

test('serves the SPA shell and security headers', async () => {
  const response = await request('/', { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  const html = await response.text();
  assert.match(html, /<div id="app">/);
  assert.match(html, /src="\/js\/app.js"/);
});

test('SPA routes fall back to index.html', async () => {
  const response = await request('/library', { headers: { Accept: 'text/html' } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<div id="app">/);
});

test('API requires authentication when a password is configured', async () => {
  const response = await request('/api/overview');
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.code, 'AUTH_REQUIRED');
});

test('rejects an incorrect password', async () => {
  const response = await request('/api/login', {
    method: 'POST',
    body: { password: 'wrong' },
  });
  assert.equal(response.status, 401);
});

test('signs in and sets an HttpOnly session cookie', async () => {
  const response = await request('/api/login', {
    method: 'POST',
    body: { password },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.auth.authenticated, true);
  const setCookie = response.headers.getSetCookie?.() || [];
  assert.equal(setCookie.length, 1);
  assert.match(setCookie[0], /HttpOnly/);
  assert.match(setCookie[0], /SameSite=Lax/);
  sessionCookie = setCookie[0].split(';')[0];
  assert.match(sessionCookie, /^shelf_session=/);
});

test('loads the dashboard and library for an authenticated session', async () => {
  const overview = await request('/api/overview');
  assert.equal(overview.status, 200);
  const payload = await overview.json();
  assert.equal(payload.stats.bookCount, 1);
  assert.equal(payload.stats.courseCount, 1);

  const library = await request('/api/library');
  assert.equal(library.status, 200);
  const data = await library.json();
  assert.equal(data.books[0].title, 'Integration Book');
  assert.equal(data.courses[0].fileCount, 1);
});

test('streams library files and supports byte ranges', async () => {
  const encoded = encodeURIComponent('epub/Integration Book.epub');
  const response = await request(`/api/library/file?path=${encoded}`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'integration-epub-content');

  const range = await request(`/api/library/file?path=${encoded}`, {
    headers: { Range: 'bytes=0-10' },
  });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get('content-range'), 'bytes 0-10/24');
  assert.equal(await range.text(), 'integration');
});

test('blocks path traversal in the file endpoint', async () => {
  const response = await request(
    `/api/library/file?path=${encodeURIComponent('../cookies.json')}`,
  );
  assert.equal(response.status, 400);
});

test('stores cookies without ever returning their values', async () => {
  const response = await request('/api/auth/cookies/book', {
    method: 'PUT',
    body: { cookiesText: JSON.stringify({ sessionid: secret }) },
  });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes(secret), false);
  assert.match(text, /"valid":true/);

  const status = await request('/api/auth/cookies');
  assert.equal(status.status, 200);
  assert.equal((await status.text()).includes(secret), false);

  const settings = await request('/api/settings');
  assert.equal(settings.status, 200);
  assert.equal((await settings.text()).includes(secret), false);
});

test('blocks cross-origin mutations', async () => {
  const response = await request('/api/jobs', {
    method: 'POST',
    body: { type: 'book' },
    headers: { Origin: 'https://evil.example' },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'CSRF_BLOCKED');
});

test('reports worker status without failing the UI', async () => {
  const response = await request('/api/status');
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.worker.online, false);
});

test('signs out and invalidates authorization', async () => {
  const response = await request('/api/logout', { method: 'POST' });
  assert.equal(response.status, 200);
  const setCookie = response.headers.getSetCookie?.() || [];
  assert.match(setCookie[0], /Max-Age=0/);
  sessionCookie = '';
  assert.equal((await request('/api/overview')).status, 401);
});

test('never writes cookie values or request bodies to logs', async () => {
  const logs = [...stdout, ...stderr].join('\n');
  assert.equal(logs.includes(secret), false);
  assert.equal(logs.includes(password), false);
});
