const COOKIE = 'dialog_index_workspace';
const MAX_AGE = 60 * 60 * 24 * 365;
const requestWorkspaces = new WeakMap<Request, { id: string; setCookie?: string }>();

function validId(value: string | null): value is string {
  return !!value && /^[0-9a-f-]{36}$/i.test(value);
}

export function workspaceFromRequest(request: Request): { id: string; setCookie?: string } {
  const resolved = requestWorkspaces.get(request);
  if (resolved) return resolved;
  const cookie = request.headers.get('cookie') ?? '';
  const found = cookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE}=`));
  const current = found ? decodeURIComponent(found.slice(COOKIE.length + 1)) : null;
  if (validId(current)) {
    const info = { id: current };
    requestWorkspaces.set(request, info);
    return info;
  }
  const id = crypto.randomUUID();
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const info = {
    id,
    setCookie: `${COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure}`,
  };
  requestWorkspaces.set(request, info);
  return info;
}

export function jsonWithWorkspace(request: Request, body: unknown, init: ResponseInit = {}): Response {
  const ws = workspaceFromRequest(request);
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'private, no-store');
  if (ws.setCookie) headers.append('set-cookie', ws.setCookie);
  return new Response(JSON.stringify(body), { ...init, headers });
}
