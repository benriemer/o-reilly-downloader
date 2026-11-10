import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const bool = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const appPassword = process.env.APP_PASSWORD || '';
const secureCookies = bool(process.env.COOKIE_SECURE);

export const config = Object.freeze({
  appName: 'Shelf',
  version: process.env.APP_VERSION || '1.0.0',
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  downloadsDir: path.resolve(process.env.DOWNLOADS_DIR || '/downloads'),
  configDir: path.resolve(process.env.CONFIG_DIR || '/config'),
  workerUrl: (process.env.WORKER_URL || 'http://downloader:8081').replace(/\/+$/, ''),
  internalToken: process.env.INTERNAL_API_TOKEN || '',
  appPassword,
  authRequired: Boolean(appPassword),
  sessionSecret:
    (process.env.SESSION_SECRET || '').trim() ||
    crypto.randomBytes(32).toString('hex'),
  sessionTtlSeconds: Math.max(
    900,
    int(process.env.SESSION_TTL_SECONDS, 7 * 24 * 60 * 60),
  ),
  secureCookies,
  trustProxy: bool(process.env.TRUST_PROXY),
  maxConcurrent: Math.max(1, int(process.env.MAX_CONCURRENT, 1)),
  publicDir: path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'public',
  ),
});

export const isLocalOnlyMode = !config.authRequired;
