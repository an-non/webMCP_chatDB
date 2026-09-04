import { workspaceFromRequest } from './workspace';

export function ws(request: Request) { return workspaceFromRequest(request); }

export function reply(request: Request, data: unknown, init: ResponseInit = {}) {
  const info = workspaceFromRequest(request);
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'private, no-store');
  if (info.setCookie) headers.append('set-cookie', info.setCookie);
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function readJson(request: Request, maxBytes = 2_000_000): Promise<any> {
  const length = Number(request.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new Error('request_too_large');
  const text = await request.text();
  if (text.length > maxBytes) throw new Error('request_too_large');
  return text ? JSON.parse(text) : {};
}

export function fail(request: Request, error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : 'request_failed';
  return reply(request, { ok: false, error: message }, { status });
}
