import { handleSignedOut } from './auth';

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
    // Same-origin only: the session cookie rides along, and the browser adds Origin on writes (the Worker checks it).
    credentials: 'same-origin',
    // Every mutation says it is JSON (a bodyless DELETE too): the Worker refuses anything else (CSRF hardening).
    headers: hasBody || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  const code = typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : `http_${res.status}`;
  // A 401 anywhere sends the app back to sign-in, except from /api/auth/* (a wrong password is just an error).
  if (res.status === 401 && !path.startsWith('/api/auth/')) handleSignedOut(code === 'removed');
  if (!res.ok) throw new ApiError(res.status, code, data);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};
