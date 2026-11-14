import { clearReauthFlag, handleSignedOut } from './auth';

/** A failed API call. `error` is the server's `{error}` code (e.g. 'taken'), or `http_<status>`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly body?: unknown,
  ) {
    super(`API ${status}: ${error}`);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const hasBody = body !== undefined;
  const res = await fetch(path, {
    method,
    credentials: 'include',
    // Access answers an expired session with a redirect to its login domain. Followed, that is
    // a CORS TypeError indistinguishable from offline; unfollowed, it is an 'opaqueredirect'.
    redirect: 'manual',
    // Every mutation says it is JSON (a bodyless DELETE too): the Worker refuses anything else (CSRF hardening).
    headers: hasBody || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  if (res.type === 'opaqueredirect' || res.status === 401) {
    handleSignedOut();
    throw new ApiError(401, 'unauthorized');
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const code = typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : `http_${res.status}`;
    throw new ApiError(res.status, code, data);
  }
  if (method === 'GET' && path === '/api/me') clearReauthFlag();
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};
