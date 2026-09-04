import {
  approvalCodeSubject,
  approvalCodeValid,
  authenticatedSiteUser,
  canonicalMcpResource,
  getOAuthRuntimeConfig,
  issueAuthorizationCode,
  normalizeScope,
  oauthRuntimeConfigured,
  verifyRegisteredClient,
} from '@/lib/server/oauth';

export const dynamic = 'force-dynamic';

type Params = {
  responseType: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  scope: string;
  state: string;
};

export async function GET(request: Request) {
  const config = getOAuthRuntimeConfig();
  if (!oauthRuntimeConfigured(config)) return text('OAuth is not configured for this Dialog Index deployment.', 503);
  const params = fromSearch(new URL(request.url).searchParams);
  const validation = await validate(params, request, config.signingSecret!);
  if (validation) return text(validation, 400);

  const siteUser = authenticatedSiteUser(request, config);
  return new Response(renderConsent(params, Boolean(siteUser), siteUser?.name), {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    },
  });
}

export async function POST(request: Request) {
  const config = getOAuthRuntimeConfig();
  if (!oauthRuntimeConfigured(config)) return text('OAuth is not configured for this Dialog Index deployment.', 503);
  const form = await request.formData();
  const params = fromForm(form);
  const validation = await validate(params, request, config.signingSecret!);
  if (validation) return text(validation, 400);

  const siteUser = authenticatedSiteUser(request, config);
  const approvalCode = String(form.get('approval_code') ?? '');
  const approvedByCode = await approvalCodeValid(approvalCode, config);
  const subject = siteUser?.subject ?? (approvedByCode ? approvalCodeSubject(config) : null);
  if (!subject) return text('Authorization denied. Sign in to this Site with an allowed account or enter the configured approval code.', 403);

  const code = await issueAuthorizationCode({
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    resource: params.resource,
    scope: params.scope,
    workspaceId: config.workspaceId!,
    subject,
  }, config.signingSecret!);

  const redirect = new URL(params.redirectUri);
  redirect.searchParams.set('code', code);
  if (params.state) redirect.searchParams.set('state', params.state);
  return Response.redirect(redirect.toString(), 302);
}

function fromSearch(search: URLSearchParams): Params {
  return {
    responseType: search.get('response_type') ?? '',
    clientId: search.get('client_id') ?? '',
    redirectUri: search.get('redirect_uri') ?? '',
    codeChallenge: search.get('code_challenge') ?? '',
    codeChallengeMethod: search.get('code_challenge_method') ?? '',
    resource: search.get('resource') ?? '',
    scope: search.get('scope') ?? 'dialog.read dialog.write offline_access',
    state: search.get('state') ?? '',
  };
}

function fromForm(form: FormData): Params {
  return {
    responseType: String(form.get('response_type') ?? ''),
    clientId: String(form.get('client_id') ?? ''),
    redirectUri: String(form.get('redirect_uri') ?? ''),
    codeChallenge: String(form.get('code_challenge') ?? ''),
    codeChallengeMethod: String(form.get('code_challenge_method') ?? ''),
    resource: String(form.get('resource') ?? ''),
    scope: String(form.get('scope') ?? 'dialog.read dialog.write offline_access'),
    state: String(form.get('state') ?? ''),
  };
}

async function validate(params: Params, request: Request, secret: string) {
  if (params.responseType !== 'code') return 'response_type must be code';
  if (!params.clientId || !params.redirectUri) return 'client_id and redirect_uri are required';
  if (params.codeChallengeMethod !== 'S256' || !params.codeChallenge) return 'PKCE S256 is required';
  if (params.resource !== canonicalMcpResource(request)) return 'resource does not match this MCP endpoint';
  const client = await verifyRegisteredClient(params.clientId, secret);
  if (!client || !client.redirectUris.includes(params.redirectUri)) return 'invalid client_id or redirect_uri';
  const scopes = normalizeScope(params.scope);
  if (!scopes.length || scopes.join(' ') !== params.scope.trim().split(/\s+/).filter(Boolean).join(' ')) return 'invalid_scope';
  return null;
}

function renderConsent(params: Params, alreadyAuthenticated: boolean, name?: string) {
  const fields = [
    ['response_type', params.responseType],
    ['client_id', params.clientId],
    ['redirect_uri', params.redirectUri],
    ['code_challenge', params.codeChallenge],
    ['code_challenge_method', params.codeChallengeMethod],
    ['resource', params.resource],
    ['scope', params.scope],
    ['state', params.state],
  ].map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`).join('');

  const identity = alreadyAuthenticated
    ? `<p class="ok">Signed in as ${escape(name ?? 'allowed user')}.</p>`
    : `<label>Approval code<input name="approval_code" type="password" autocomplete="one-time-code" required></label><p class="hint">Enter the private approval code configured in the Site environment. Do not paste this code into chat or source files.</p>`;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize Dialog Index</title><style>body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f7f7f4;color:#171717;margin:0;padding:32px}.card{max-width:620px;margin:auto;background:white;border:1px solid #d8d8d2;border-radius:18px;padding:28px;box-shadow:0 8px 36px rgba(0,0,0,.06)}h1{font-size:22px;margin-top:0}code{background:#f1f1ec;padding:2px 6px;border-radius:6px}label{display:grid;gap:8px;margin:20px 0;font-weight:600}input{font:inherit;padding:11px;border:1px solid #bdbdb7;border-radius:10px}.scopes{padding:14px;background:#f7f7f4;border-radius:12px;line-height:1.7}.hint{font-size:12px;color:#666}.ok{color:#17643b}.actions{display:flex;gap:10px;margin-top:22px}button{font:inherit;padding:11px 16px;border-radius:10px;border:1px solid #222;background:#111;color:white;cursor:pointer}</style></head><body><main class="card"><h1>Authorize Dialog Index</h1><p>ChatGPT is requesting access to this Dialog Index workspace.</p><div class="scopes"><strong>Requested scopes</strong><br>${escape(params.scope)}</div>${identity}<form method="post">${fields}${alreadyAuthenticated ? '' : '<input type="hidden" name="approval_present" value="1">'}${alreadyAuthenticated ? '' : ''}<div class="actions"><button type="submit">Allow access</button></div></form></main></body></html>`;
}

function escape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function text(message: string, status: number) {
  return new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
