import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "img-src 'self' data:",
      "font-src 'self'",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "media-src 'self'",
      "manifest-src 'self'",
    ].join('; '),
  );
}

export function sendJson(res, status, payload, headers = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', body.length);
  res.setHeader('Cache-Control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  if (res.req?.method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
}

export function sendError(res, error) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
    return;
  }
  sendJson(res, 500, {
    error: 'Something went wrong on the server.',
    code: 'INTERNAL_ERROR',
  });
}

export function parseCookies(header = '') {
  const cookies = {};
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const name = chunk.slice(0, index).trim();
    if (!name) continue;
    const value = chunk.slice(index + 1).trim();
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

export function appendCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const values = Array.isArray(existing) ? existing : existing ? [existing] : [];
  res.setHeader('Set-Cookie', [...values, parts.join('; ')]);
}

export function clearCookie(res, name, options = {}) {
  appendCookie(res, name, '', {
    ...options,
    maxAge: 0,
    httpOnly: true,
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function readJsonBody(req, { limit = 128 * 1024 } = {}) {
  const type = String(req.headers['content-type'] || '').toLowerCase();
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'Expected an application/json request.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }
  if (size === 0) throw new HttpError(400, 'Request body is empty.');
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
  if (!isPlainObject(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  return parsed;
}

export function clientIp(req) {
  return (
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

export function sameOrigin(req, { trustProxy = false } = {}) {
  const origin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && !['same-origin', 'none'].includes(fetchSite)) return false;
  if (!origin) return true;

  let forwardedProto = req.headers['x-forwarded-proto'];
  if (Array.isArray(forwardedProto)) forwardedProto = forwardedProto[0];
  const proto = trustProxy && forwardedProto
    ? String(forwardedProto).split(',')[0].trim()
    : req.socket?.encrypted
      ? 'https'
      : 'http';
  let forwardedHost = req.headers['x-forwarded-host'];
  if (Array.isArray(forwardedHost)) forwardedHost = forwardedHost[0];
  const host = trustProxy && forwardedHost
    ? String(forwardedHost).split(',')[0].trim()
    : req.headers.host;
  if (!host) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === `${proto}:` && parsed.host === host;
  } catch {
    return false;
  }
}

export function safeEqualText(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
