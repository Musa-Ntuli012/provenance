/** API client, same-origin /api via the Vite (or production reverse) proxy.
 *  Access token lives in memory only; the refresh cookie is httpOnly.
 *  A single in-flight refresh guards against parallel 401s stampeding. */

/** API origin: '' (default) = same-origin /api via the Vite/proxy or the
 *  production reverse proxy; set VITE_API_BASE_URL only for split deploys. */
const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

export class ApiError extends Error {
  status: number;
  code: string;
  details?: { field: string; message: string }[];
  constructor(status: number, code: string, message: string, details?: { field: string; message: string }[]) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type OnUnauthorized = () => void;
let onUnauthorized: OnUnauthorized = () => {};
export function setUnauthorizedHandler(fn: OnUnauthorized) {
  onUnauthorized = fn;
}

let accessToken: string | null = null;
export function setAccessToken(token: string | null) {
  accessToken = token;
}

async function refreshTokens(): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/api/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!res.ok) return false;
  const data = await res.json();
  accessToken = data.accessToken;
  return true;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; formData?: FormData } = {},
): Promise<T> {
  async function call(): Promise<Response> {
    const headers: Record<string, string> = {};
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    let body: BodyInit | undefined;
    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    return fetch(`${BASE_URL}/api${path}`, {
      method: options.method ?? (body !== undefined || options.formData ? 'POST' : 'GET'),
      headers,
      body,
      credentials: 'same-origin',
    });
  }

  let res = await call();
  if (res.status === 401 && accessToken) {
    const ok = await refreshTokens();
    if (!ok) {
      accessToken = null;
      onUnauthorized();
      throw new ApiError(401, 'UNAUTHENTICATED', 'Please sign in again');
    }
    res = await call();
  }

  if (res.status === 204) return undefined as T;

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    /* empty body */
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: { field: string; message: string }[] } })?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'ERROR',
      err?.message ?? 'Something went wrong. Please try again.',
      err?.details,
    );
  }
  return payload as T;
}

/** Used only by the auth context bootstrap (no access token yet). */
export async function bootstrapRefresh(): Promise<{ accessToken: string; user: import('../types').User } | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/auth/refresh`, { method: 'POST', credentials: 'same-origin' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
