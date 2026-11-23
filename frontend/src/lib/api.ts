export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

let csrf: string | null = null;
try { csrf = sessionStorage.getItem('mw_csrf'); } catch { /* storage unavailable */ }
export function setCsrf(t: string | null) {
  csrf = t;
  try { t ? sessionStorage.setItem('mw_csrf', t) : sessionStorage.removeItem('mw_csrf'); } catch { /* ignore */ }
}

let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export async function api<T = any>(method: string, path: string, body?: unknown, opts: { idempotent?: boolean; key?: string; query?: Record<string, unknown> } = {}): Promise<T> {
  const qs = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString() : '';
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  if (opts.idempotent || opts.key) headers['Idempotency-Key'] = opts.key ?? newKey();
  const res = await fetch(`/api/v1${path}${qs}`, { method, headers, credentials: 'include', body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const data = text ? safeJson(text) : null;
  if (!res.ok) {
    const e = (data as any)?.error ?? {};
    if (res.status === 401 && !path.startsWith('/auth/login')) onUnauthorized();
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? `Request failed (${res.status})`, e.details);
  }
  return data as T;
}
const safeJson = (t: string) => { try { return JSON.parse(t); } catch { return null; } };

export const get = <T = any>(p: string, query?: Record<string, unknown>) => api<T>('GET', p, undefined, { query });
export const post = <T = any>(p: string, b: unknown = {}, o?: { idempotent?: boolean; key?: string }) => api<T>('POST', p, b, o);
export const patch = <T = any>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);
export const newIdempotencyKey = newKey;

/** Raw-body upload (server sniffs magic bytes; the declared type is not trusted). */
export async function uploadFile(file: File, query: Record<string, string>): Promise<{ id: string }> {
  const qs = new URLSearchParams({ ...query, name: file.name }).toString();
  const headers: Record<string, string> = { 'Content-Type': file.type || 'application/octet-stream' };
  if (csrf) headers['X-CSRF-Token'] = csrf;
  const res = await fetch(`/api/v1/attachments?${qs}`, { method: 'POST', headers, credentials: 'include', body: file });
  const data = safeJson(await res.text());
  if (!res.ok) { const e = (data as any)?.error ?? {}; throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'Upload failed', e.details); }
  return data as { id: string };
}
