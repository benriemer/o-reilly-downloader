import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { HttpError } from './http.js';

const STATIC_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.ico', 'image/x-icon'],
  ['.webmanifest', 'application/manifest+json'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.txt', 'text/plain; charset=utf-8'],
]);

async function sendFile(req, res, absolutePath, stat, { cacheControl, status = 200 }) {
  const extension = path.extname(absolutePath).toLowerCase();
  const mime = STATIC_TYPES.get(extension) || 'application/octet-stream';
  const etag = `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;

  res.setHeader('Content-Type', mime);
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('ETag', etag);
  res.setHeader('Last-Modified', stat.mtime.toUTCString());

  if (req.headers['if-none-match'] === etag) {
    res.statusCode = 304;
    res.removeHeader('Content-Type');
    res.end();
    return;
  }

  res.statusCode = status;
  res.setHeader('Content-Length', stat.size);
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = fs.createReadStream(absolutePath);
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

export async function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    throw new HttpError(405, 'Method not allowed.');
  }
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, 'Malformed URL.');
  }
  if (pathname === '/') pathname = '/index.html';

  const candidate = path.resolve(
    config.publicDir,
    pathname.replace(/^\/+/, ''),
  );
  if (
    candidate !== config.publicDir &&
    !candidate.startsWith(config.publicDir + path.sep)
  ) {
    throw new HttpError(404, 'Not found.');
  }

  let stat = null;
  try {
    stat = await fsp.stat(candidate);
  } catch {
    // SPA routes such as /jobs/abc fall through to index.html below.
  }

  if (stat?.isFile()) {
    const html = candidate.endsWith('.html');
    const font = candidate.endsWith('.woff2') || candidate.endsWith('.woff');
    await sendFile(req, res, candidate, stat, {
      cacheControl: html
        ? 'no-store'
        : font
          ? 'public, max-age=604800'
          : 'no-cache',
    });
    return;
  }

  if (path.extname(pathname)) {
    throw new HttpError(404, 'Not found.');
  }

  const index = path.join(config.publicDir, 'index.html');
  let indexStat;
  try {
    indexStat = await fsp.stat(index);
  } catch {
    throw new HttpError(500, 'The web interface is not installed.');
  }
  await sendFile(req, res, index, indexStat, { cacheControl: 'no-store' });
}
