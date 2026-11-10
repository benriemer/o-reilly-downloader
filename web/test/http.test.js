import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseCookies,
  sameOrigin,
  safeEqualText,
} from '../server/http.js';

function request(headers, { encrypted = false } = {}) {
  return {
    headers,
    socket: { remoteAddress: '127.0.0.1', encrypted },
  };
}

test('sameOrigin allows requests without browser origins', () => {
  assert.equal(sameOrigin(request({})), true);
  assert.equal(
    sameOrigin(request({ 'sec-fetch-site': 'same-origin' })),
    true,
  );
  assert.equal(sameOrigin(request({ 'sec-fetch-site': 'none' })), true);
});

test('sameOrigin blocks cross-site requests', () => {
  assert.equal(
    sameOrigin(request({ 'sec-fetch-site': 'cross-site' })),
    false,
  );
  assert.equal(
    sameOrigin(
      request({
        origin: 'https://evil.example',
        host: 'shelf.example',
      }),
    ),
    false,
  );
});

test('sameOrigin matches host and protocol', () => {
  assert.equal(
    sameOrigin(
      request({
        origin: 'http://shelf.example:3000',
        host: 'shelf.example:3000',
      }),
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      request({
        origin: 'http://shelf.example',
        host: 'shelf.example',
      }),
      { trustProxy: true },
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      request({
        origin: 'https://shelf.example',
        host: 'internal:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'shelf.example',
      }),
      { trustProxy: true },
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      request({
        origin: 'https://shelf.example',
        host: 'internal:3000',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'shelf.example',
      }),
      { trustProxy: false },
    ),
    false,
  );
});

test('parseCookies decodes values and survives malformed input', () => {
  const cookies = parseCookies('a=one; b=two%20words; broken; c=%E0%A4%A');
  assert.equal(cookies.a, 'one');
  assert.equal(cookies.b, 'two words');
  assert.equal(cookies.c, '%E0%A4%A');
});

test('safeEqualText compares without throwing', () => {
  assert.equal(safeEqualText('same', 'same'), true);
  assert.equal(safeEqualText('same', 'different'), false);
  assert.equal(safeEqualText('', ''), true);
});
