import crypto from 'node:crypto';
import { config, isLocalOnlyMode } from './config.js';
import {
  HttpError,
  appendCookie,
  clearCookie,
  clientIp,
  parseCookies,
  readJsonBody,
  safeEqualText,
  sendJson,
} from './http.js';

const COOKIE_NAME = 'shelf_session';
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;
const loginAttempts = new Map();

const signingKey = crypto
  .createHmac('sha256', config.sessionSecret)
  .update(config.appPassword)
  .digest();

function pruneAttempts(now) {
  if (loginAttempts.size < 500) return;
  for (const [key, entry] of loginAttempts) {
    if (entry.resetAt <= now) loginAttempts.delete(key);
  }
}

function rateLimitFor(ip, now) {
  const entry = loginAttempts.get(ip);
  if (!entry || entry.resetAt <= now) return { blocked: false, retryAfter: 0 };
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    return {
      blocked: true,
      retryAfter: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  return { blocked: false, retryAfter: 0 };
}

function registerFailure(ip, now) {
  const existing = loginAttempts.get(ip);
  if (!existing || existing.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  } else {
    existing.count += 1;
  }
}

function createSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({
      sub: 'admin',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + config.sessionTtlSeconds,
    }),
  ).toString('base64url');
  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(`v1.${payload}`)
    .digest('base64url');
  return `v1.${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const [, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`v1.${payload}`)
    .digest();
  let provided;
  try {
    provided = Buffer.from(signature, 'base64url');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(provided, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return (
      data &&
      data.sub === 'admin' &&
      Number.isFinite(data.exp) &&
      data.exp > Math.floor(Date.now() / 1000)
    );
  } catch {
    return false;
  }
}

export function isAuthenticated(req) {
  if (isLocalOnlyMode) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  return verifySessionToken(cookies[COOKIE_NAME]);
}

export function sessionInfo(req) {
  return {
    app: { name: config.appName, version: config.version },
    auth: {
      required: config.authRequired,
      authenticated: isAuthenticated(req),
      mode: config.authRequired ? 'password' : 'local',
      user: config.authRequired ? 'admin' : 'local',
    },
    security: {
      secureCookie: config.secureCookies,
    },
  };
}

export function handleSession(req, res) {
  sendJson(res, 200, sessionInfo(req));
}

export async function handleLogin(req, res) {
  if (!config.authRequired) {
    throw new HttpError(400, 'Password authentication is not enabled.', 'AUTH_DISABLED');
  }
  const ip = clientIp(req);
  const now = Date.now();
  pruneAttempts(now);
  const limit = rateLimitFor(ip, now);
  if (limit.blocked) {
    sendJson(
      res,
      429,
      {
        error: 'Too many sign-in attempts. Try again in a few minutes.',
        code: 'RATE_LIMITED',
      },
      { 'Retry-After': String(limit.retryAfter) },
    );
    return;
  }

  const body = await readJsonBody(req, { limit: 8 * 1024 });
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password || password.length > 1024) {
    registerFailure(ip, now);
    throw new HttpError(401, 'Incorrect password.', 'INVALID_CREDENTIALS');
  }

  if (!safeEqualText(password, config.appPassword)) {
    registerFailure(ip, now);
    await new Promise((resolve) => setTimeout(resolve, 250));
    throw new HttpError(401, 'Incorrect password.', 'INVALID_CREDENTIALS');
  }

  loginAttempts.delete(ip);
  appendCookie(res, COOKIE_NAME, createSessionToken(), {
    maxAge: config.sessionTtlSeconds,
    httpOnly: true,
    sameSite: 'Lax',
    secure: config.secureCookies,
  });
  console.log('Sign-in succeeded.');
  const info = sessionInfo(req);
  info.auth.authenticated = true;
  sendJson(res, 200, info);
}

export function handleLogout(req, res) {
  clearCookie(res, COOKIE_NAME, {
    secure: config.secureCookies,
    sameSite: 'Lax',
  });
  sendJson(res, 200, {
    authenticated: false,
    auth: {
      required: config.authRequired,
      authenticated: false,
      mode: config.authRequired ? 'password' : 'local',
      user: config.authRequired ? 'admin' : 'local',
    },
  });
}
