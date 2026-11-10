import fs from 'node:fs/promises';
import http from 'node:http';
import { config } from './config.js';
import {
  HttpError,
  readJsonBody,
  sameOrigin,
  securityHeaders,
  sendError,
  sendJson,
} from './http.js';
import {
  handleLogin,
  handleLogout,
  handleSession,
  isAuthenticated,
  sessionInfo,
} from './auth.js';
import {
  deleteCookies,
  getCookieStatuses,
  saveCookies,
} from './cookies.js';
import {
  applyCourseLabels,
  getLibrary,
  serveLibraryFile,
} from './library.js';
import { serveStatic } from './static.js';
import { workerClient } from './worker-client.js';

const JOB_ROUTE = /^\/api\/jobs\/([a-f0-9]{6,32})$/;
const CANCEL_ROUTE = /^\/api\/jobs\/([a-f0-9]{6,32})\/cancel$/;
const RETRY_ROUTE = /^\/api\/jobs\/([a-f0-9]{6,32})\/retry$/;
const COOKIE_ROUTE = /^\/api\/auth\/cookies\/(book|course)$/;

function emptyLibrary() {
  return {
    books: [],
    courses: [],
    stats: {
      libraryItems: 0,
      bookCount: 0,
      courseCount: 0,
      fileCount: 0,
      totalBytes: 0,
      scannedAt: new Date().toISOString(),
    },
  };
}

function courseSummary(course) {
  const { files, ...summary } = course;
  return summary;
}

async function overview() {
  const [libraryResult, jobsResult, worker] = await Promise.all([
    getLibrary().catch(() => emptyLibrary()),
    workerClient.listJobs().catch(() => []),
    workerClient.health(),
  ]);
  const library = applyCourseLabels(libraryResult, jobsResult);
  const cookies = await getCookieStatuses();
  const jobs = [...jobsResult].sort((a, b) =>
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  );
  const activeJobs = jobs.filter((job) =>
    ['queued', 'running', 'cancelling'].includes(job.status),
  ).length;
  const completedJobs = jobs.filter((job) => job.status === 'completed').length;
  const failedJobs = jobs.filter((job) => job.status === 'failed').length;

  return {
    stats: {
      ...library.stats,
      activeJobs,
      completedJobs,
      failedJobs,
      totalJobs: jobs.length,
    },
    recentJobs: jobs.slice(0, 5),
    recentBooks: library.books.slice(0, 3),
    recentCourses: library.courses.slice(0, 2).map(courseSummary),
    auth: cookies,
    worker,
    serverTime: new Date().toISOString(),
  };
}

async function retryJob(id) {
  const original = await workerClient.getJob(id, 100);
  if (!original?.input?.type) {
    throw new HttpError(400, 'This job cannot be retried.');
  }
  return workerClient.createJob({ ...original.input });
}

async function route(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === 'GET' && pathname === '/healthz') {
    sendJson(res, 200, {
      status: 'ok',
      app: config.appName,
      version: config.version,
    });
    return;
  }

  if (pathname === '/api/session' && req.method === 'GET') {
    handleSession(req, res);
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    await handleLogin(req, res);
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (!isAuthenticated(req)) {
      throw new HttpError(401, 'Authentication required.', 'AUTH_REQUIRED');
    }

    if (pathname === '/api/logout' && req.method === 'POST') {
      handleLogout(req, res);
      return;
    }

    if (pathname === '/api/overview' && req.method === 'GET') {
      sendJson(res, 200, await overview());
      return;
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      const [worker, cookies] = await Promise.all([
        workerClient.health(),
        getCookieStatuses(),
      ]);
      sendJson(res, 200, {
        worker,
        auth: cookies,
        serverTime: new Date().toISOString(),
      });
      return;
    }

    if (pathname === '/api/jobs' && req.method === 'GET') {
      const [jobs, worker] = await Promise.all([
        workerClient.listJobs(),
        workerClient.health(),
      ]);
      sendJson(res, 200, { jobs, worker });
      return;
    }

    if (pathname === '/api/jobs' && req.method === 'POST') {
      const body = await readJsonBody(req, { limit: 64 * 1024 });
      const job = await workerClient.createJob(body);
      sendJson(res, 201, { job });
      return;
    }

    const jobMatch = JOB_ROUTE.exec(pathname);
    if (jobMatch && req.method === 'GET') {
      const tail = Number.parseInt(searchParams.get('tail') || '1500', 10);
      const job = await workerClient.getJob(jobMatch[1], tail);
      sendJson(res, 200, { job });
      return;
    }

    const cancelMatch = CANCEL_ROUTE.exec(pathname);
    if (cancelMatch && req.method === 'POST') {
      const job = await workerClient.cancelJob(cancelMatch[1]);
      sendJson(res, 200, { job });
      return;
    }

    const retryMatch = RETRY_ROUTE.exec(pathname);
    if (retryMatch && req.method === 'POST') {
      const job = await retryJob(retryMatch[1]);
      sendJson(res, 201, { job });
      return;
    }

    if (pathname === '/api/library' && req.method === 'GET') {
      const force = searchParams.get('refresh') === '1';
      const library = await getLibrary({ force });
      let jobs = [];
      try {
        jobs = await workerClient.listJobs();
      } catch {
        // Course labels are a nice-to-have; the library works without the worker.
      }
      sendJson(res, 200, applyCourseLabels(library, jobs));
      return;
    }

    if (pathname === '/api/library/file' && ['GET', 'HEAD'].includes(req.method)) {
      await serveLibraryFile(req, res, url);
      return;
    }

    if (pathname === '/api/auth/cookies' && req.method === 'GET') {
      sendJson(res, 200, { cookies: await getCookieStatuses() });
      return;
    }

    const cookieMatch = COOKIE_ROUTE.exec(pathname);
    if (cookieMatch && req.method === 'PUT') {
      const body = await readJsonBody(req, { limit: 1400 * 1024 });
      const status = await saveCookies(cookieMatch[1], body.cookiesText);
      sendJson(res, 200, {
        saved: status,
        cookies: await getCookieStatuses(),
      });
      return;
    }

    if (cookieMatch && req.method === 'DELETE') {
      const status = await deleteCookies(cookieMatch[1]);
      sendJson(res, 200, {
        removed: status,
        cookies: await getCookieStatuses(),
      });
      return;
    }

    if (pathname === '/api/settings' && req.method === 'GET') {
      const [cookies, worker] = await Promise.all([
        getCookieStatuses(),
        workerClient.health(),
      ]);
      sendJson(res, 200, {
        app: {
          name: config.appName,
          version: config.version,
          timezone: process.env.TZ || 'UTC',
          maxConcurrent: config.maxConcurrent,
        },
        security: {
          passwordConfigured: config.authRequired,
          localOnly: !config.authRequired,
          secureCookie: config.secureCookies,
          internalTokenConfigured: Boolean(config.internalToken),
          trustProxy: config.trustProxy,
        },
        paths: {
          downloads: config.downloadsDir,
          config: config.configDir,
        },
        cookies,
        worker,
        session: sessionInfo(req).auth,
      });
      return;
    }

    throw new HttpError(404, 'Not found.');
  }

  if (req.method === 'OPTIONS') {
    throw new HttpError(405, 'Method not allowed.');
  }
  await serveStatic(req, res, url);
}

function logRequest(req, res, pathname, startedAt) {
  res.once('finish', () => {
    const duration = Date.now() - startedAt;
    const noisy = req.method !== 'GET' && req.method !== 'HEAD';
    if (noisy || res.statusCode >= 400) {
      console.log(
        `${req.method} ${pathname} ${res.statusCode} ${duration}ms`,
      );
    }
  });
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  securityHeaders(res);
  let pathname = '/';
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    pathname = url.pathname;
    logRequest(req, res, pathname, startedAt);
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      !sameOrigin(req, { trustProxy: config.trustProxy })
    ) {
      throw new HttpError(403, 'Cross-origin request blocked.', 'CSRF_BLOCKED');
    }
    await route(req, res, url);
  } catch (error) {
    if (!(error instanceof HttpError)) {
      console.error(
        `Request error (${pathname}): ${error?.name || 'Error'}: ${error?.message || 'unknown'}`,
      );
    }
    sendError(res, error);
  }
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 20_000;
server.requestTimeout = 30_000;

async function start() {
  try {
    await fs.mkdir(config.configDir, { recursive: true, mode: 0o700 });
  } catch (error) {
    console.warn(`Config directory is not writable: ${error.code || 'unknown error'}`);
  }
  try {
    await fs.access(config.publicDir);
  } catch {
    console.error(`Web assets missing at ${config.publicDir}`);
    process.exit(1);
  }

  server.listen(config.port, config.host, () => {
    const address = server.address();
    const listeningPort = typeof address === 'object' && address ? address.port : config.port;
    console.log(`${config.appName} web ${config.version} listening on ${config.host}:${listeningPort}`);
    console.log(
      config.authRequired
        ? 'Access: password protected.'
        : 'Access: local-only mode (APP_PASSWORD is not set). Bind this app to loopback.',
    );
    console.log(`Downloader adapter: ${config.workerUrl}`);
    const worker = workerClient.health();
    worker.then((health) => {
      console.log(
        health.online
          ? `Downloader worker online (v${health.version || '?'}; concurrency ${health.maxConcurrent}).`
          : 'Downloader worker is not reachable yet; the UI will retry automatically.',
      );
    });
  });
}

server.on('error', (error) => {
  console.error(`HTTP server error: ${error.code || error.message}`);
  process.exit(1);
});

function shutdown(signal) {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (error) => {
  console.error(`Unhandled rejection: ${error?.name || 'Error'}`);
});
process.on('uncaughtException', (error) => {
  console.error(`Uncaught exception: ${error?.name || 'Error'}: ${error?.message || ''}`);
  process.exit(1);
});

start();
