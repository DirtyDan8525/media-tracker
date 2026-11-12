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
    headers: hasBody ? { 'content-type': 'application/json' } : undefined,
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (res.status === 401) {
    // Cloudflare Access session expired: a full reload of / lets Access show its sign-in.
    location.assign('/');
    throw new ApiError(401, 'unauthorized', data);
  }
  if (!res.ok) {
    const code = typeof (data as { error?: unknown })?.error === 'string' ? (data as { error: string }).error : `http_${res.status}`;
    throw new ApiError(res.status, code, data);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: <T = void>(path: string) => request<T>('DELETE', path),
};
