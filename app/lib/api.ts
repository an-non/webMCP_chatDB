let sessionReady: Promise<void> | null = null;

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { ...(init?.body && !(init.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(init?.headers ?? {}) } });
  const data: unknown = await response.json().catch(() => ({}));
  const envelope = data && typeof data === 'object' ? data as { ok?: boolean; error?: string } : {};
  if (!response.ok || envelope.ok === false) throw new Error(envelope.error ?? `HTTP ${response.status}`);
  return data as T;
}

async function ensureSession(): Promise<void> {
  sessionReady ??= requestJson('/api/session', { method: 'POST' }).then(() => undefined).catch((error) => {
    sessionReady = null;
    throw error;
  });
  await sessionReady;
}

export async function api<T = any>(path: string, init?: RequestInit, source: 'webmcp' | 'web-ui' = 'web-ui'): Promise<T> {
  if (path !== '/api/session' && path !== '/api/health') await ensureSession();
  return requestJson<T>(path, { ...init, headers: { 'x-dialog-source': source, ...(init?.headers ?? {}) } });
}
