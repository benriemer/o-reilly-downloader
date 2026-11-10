import { config } from './config.js';
import { HttpError } from './http.js';

const JOB_ID_RE = /^[a-f0-9]{6,32}$/;

function assertJobId(id) {
  if (!JOB_ID_RE.test(String(id || ''))) {
    throw new HttpError(404, 'Job not found.');
  }
  return id;
}

async function workerRequest(path, { method = 'GET', body, timeout = 6000 } = {}) {
  const headers = { Accept: 'application/json' };
  if (config.internalToken) {
    headers.Authorization = `Bearer ${config.internalToken}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${config.workerUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      cache: 'no-store',
    });
  } catch {
    throw new HttpError(
      503,
      'The downloader service is unavailable. Check that the downloader container is running.',
      'WORKER_OFFLINE',
    );
  }

  let payload = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    // The caller will use a safe generic message.
  }

  if (!response.ok) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : response.status === 401
          ? 'The web app could not authenticate with the downloader service.'
          : 'The downloader service returned an error.';
    if (response.status === 400 || response.status === 413) {
      throw new HttpError(response.status, message);
    }
    if (response.status === 404) throw new HttpError(404, message);
    if (response.status === 401) {
      throw new HttpError(502, message, 'WORKER_AUTH');
    }
    throw new HttpError(502, 'The downloader service returned an error.', 'WORKER_ERROR');
  }

  return payload;
}

export const workerClient = {
  async health() {
    try {
      const payload = await workerRequest('/api/health', { timeout: 3000 });
      return {
        online: true,
        status: payload?.status || 'ok',
        version: payload?.version || null,
        active: Number(payload?.active || 0),
        queued: Number(payload?.queued || 0),
        totalJobs: Number(payload?.totalJobs || 0),
        maxConcurrent: Number(payload?.maxConcurrent || config.maxConcurrent),
      };
    } catch {
      return {
        online: false,
        status: 'offline',
        active: 0,
        queued: 0,
        totalJobs: 0,
        maxConcurrent: config.maxConcurrent,
      };
    }
  },

  async listJobs() {
    const payload = await workerRequest('/api/jobs');
    return Array.isArray(payload?.jobs) ? payload.jobs : [];
  },

  async getJob(id, tail = 1500) {
    const safeTail = Math.max(100, Math.min(Number(tail) || 1500, 5000));
    const payload = await workerRequest(
      `/api/jobs/${assertJobId(id)}?tail=${safeTail}`,
    );
    if (!payload?.job) throw new HttpError(404, 'Job not found.');
    return payload.job;
  },

  async createJob(input) {
    const payload = await workerRequest('/api/jobs', {
      method: 'POST',
      body: input,
      timeout: 10000,
    });
    if (!payload?.job) {
      throw new HttpError(502, 'The downloader did not return a job.');
    }
    return payload.job;
  },

  async cancelJob(id) {
    const payload = await workerRequest(
      `/api/jobs/${assertJobId(id)}/cancel`,
      { method: 'POST', timeout: 10000 },
    );
    if (!payload?.job) throw new HttpError(404, 'Job not found.');
    return payload.job;
  },
};
