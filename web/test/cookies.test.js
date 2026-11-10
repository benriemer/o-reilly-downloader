import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shelf-config-'));
process.env.CONFIG_DIR = configDir;

const {
  deleteCookies,
  getCookieStatuses,
  saveCookies,
} = await import('../server/cookies.js');

const SECRET = 'super-secret-cookie-value-123';

test.after(async () => {
  await fs.rm(configDir, { recursive: true, force: true });
});

test('cookie files start unconfigured', async () => {
  const statuses = await getCookieStatuses();
  assert.equal(statuses.book.configured, false);
  assert.equal(statuses.course.valid, false);
});

test('saving cookies returns metadata only and writes a 0600 file', async () => {
  const saved = await saveCookies('book', JSON.stringify({ sessionid: SECRET }));
  assert.equal(saved.configured, true);
  assert.equal(saved.valid, true);
  assert.equal(saved.cookieCount, 1);
  assert.equal(JSON.stringify(saved).includes(SECRET), false);

  const filePath = path.join(configDir, 'cookies.json');
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
  const written = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(written.sessionid, SECRET);

  const statuses = await getCookieStatuses();
  assert.equal(JSON.stringify(statuses).includes(SECRET), false);
});

test('saving accepts a double-encoded JSON string from the console', async () => {
  const payload = JSON.stringify({ name: 'value' });
  await saveCookies('course', JSON.stringify(payload));
  const statuses = await getCookieStatuses();
  assert.equal(statuses.course.valid, true);
  assert.equal(statuses.course.cookieCount, 1);
});

test('invalid cookie payloads are rejected', async () => {
  await assert.rejects(() => saveCookies('book', 'not json'), { status: 400 });
  await assert.rejects(() => saveCookies('book', '[]'), { status: 400 });
  await assert.rejects(() => saveCookies('book', '{}'), { status: 400 });
  await assert.rejects(
    () => saveCookies('book', JSON.stringify({ name: 42 })),
    { status: 400 },
  );
  await assert.rejects(() => saveCookies('unknown', '{}'), { status: 404 });
});

test('deleting cookies removes the file', async () => {
  await deleteCookies('book');
  const statuses = await getCookieStatuses();
  assert.equal(statuses.book.configured, false);
  assert.equal(statuses.book.valid, false);
});
