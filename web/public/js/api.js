export class ApiError extends Error {
  constructor(message, status = 0, code = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let unauthorizedHandler = null;

export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
      cache: 'no-store',
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError('Cannot reach the Shelf server. Is the container running?', 0, 'NETWORK');
  }

  let payload = null;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (
      response.status === 401 &&
      !path.startsWith('/api/login') &&
      !path.startsWith('/api/session')
    ) {
      unauthorizedHandler?.();
    }
    throw new ApiError(
      payload?.error || `Request failed (${response.status}).`,
      response.status,
      payload?.code,
    );
  }
  return payload;
}

export const api = {
  session(signal) {
    return request('/api/session', { signal });
  },
  login(password) {
    return request('/api/login', { method: 'POST', body: { password } });
  },
  logout() {
    return request('/api/logout', { method: 'POST' });
  },
  overview(signal) {
    return request('/api/overview', { signal });
  },
  status(signal) {
    return request('/api/status', { signal });
  },
  jobs(signal) {
    return request('/api/jobs', { signal });
  },
  job(id, { tail = 1500, signal } = {}) {
    return request(`/api/jobs/${encodeURIComponent(id)}?tail=${tail}`, { signal });
  },
  createJob(input) {
    return request('/api/jobs', { method: 'POST', body: input });
  },
  cancelJob(id) {
    return request(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },
  retryJob(id) {
    return request(`/api/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' });
  },
  library({ refresh = false, signal } = {}) {
    return request(`/api/library${refresh ? '?refresh=1' : ''}`, { signal });
  },
  settings(signal) {
    return request('/api/settings', { signal });
  },
  cookies(signal) {
    return request('/api/auth/cookies', { signal });
  },
  saveCookies(kind, cookiesText) {
    return request(`/api/auth/cookies/${encodeURIComponent(kind)}`, {
      method: 'PUT',
      body: { cookiesText },
    });
  },
  removeCookies(kind) {
    return request(`/api/auth/cookies/${encodeURIComponent(kind)}`, {
      method: 'DELETE',
    });
  },
};
