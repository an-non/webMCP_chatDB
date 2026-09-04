const encoder = new TextEncoder();

export const DIALOG_MCP_SCOPES = ['dialog.read', 'dialog.write', 'offline_access'] as const;
export type DialogMcpScope = (typeof DIALOG_MCP_SCOPES)[number];

export type OAuthRuntimeConfig = {
  workspaceId?: string;
  signingSecret?: string;
  allowedEmails: string[];
};

type RegisteredClientClaims = {
  typ: 'oauth_client';
  iat: number;
  redirectUris: string[];
  clientName?: string;
};

type AuthorizationCodeClaims = {
  typ: 'authorization_code';
  iat: number;
  exp: number;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  workspaceId: string;
  email: string;
  nonce: string;
};

type AccessTokenClaims = {
  typ: 'access_token';
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  sub: string;
  scope: string;
  workspaceId: string;
  clientId: string;
};

type RefreshTokenClaims = {
  typ: 'refresh_token';
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  sub: string;
  scope: string;
  workspaceId: string;
  clientId: string;
  nonce: string;
};

export type VerifiedOAuthAccess = {
  email: string;
  workspaceId: string;
  clientId: string;
  scopes: string[];
};

export function getOAuthRuntimeConfig(): OAuthRuntimeConfig {
  const signingSecret = value('REMOTE_MCP_OAUTH_SIGNING_SECRET') ?? value('REMOTE_MCP_BEARER_TOKEN');
  return {
    workspaceId: value('REMOTE_MCP_WORKSPACE_ID'),
    signingSecret,
    allowedEmails: (value('REMOTE_MCP_OAUTH_ALLOWED_EMAILS') ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function oauthRuntimeConfigured(config = getOAuthRuntimeConfig()) {
  return Boolean(config.workspaceId && config.signingSecret);
}

export function canonicalMcpResource(request: Request) {
  const url = new URL(request.url);
  return `${url.origin}/mcp`;
}

export function oauthIssuer(request: Request) {
  return new URL(request.url).origin;
}

export function authenticatedSiteUser(request: Request, config = getOAuthRuntimeConfig()) {
  const email = (request.headers.get('oai-authenticated-user-email') ?? '').trim().toLowerCase();
  if (!email) return null;
  if (config.allowedEmails.length && !config.allowedEmails.includes(email)) return null;
  return {
    email,
    name: (request.headers.get('oai-authenticated-user-full-name') ?? '').trim() || email,
  };
}

export async function issueRegisteredClient(input: { redirectUris: string[]; clientName?: string }, secret: string) {
  const claims: RegisteredClientClaims = {
    typ: 'oauth_client',
    iat: now(),
    redirectUris: input.redirectUris,
    clientName: input.clientName?.slice(0, 160),
  };
  return signCompact(claims, secret, 'DIALOG-OAUTH-CLIENT');
}

export async function verifyRegisteredClient(clientId: string, secret: string): Promise<RegisteredClientClaims | null> {
  const claims = await verifyCompact(clientId, secret, 'DIALOG-OAUTH-CLIENT');
  if (!claims || claims.typ !== 'oauth_client' || !Array.isArray(claims.redirectUris)) return null;
  const redirectUris = claims.redirectUris.filter((uri: unknown): uri is string => typeof uri === 'string' && validRedirectUri(uri));
  if (!redirectUris.length) return null;
  return { typ: 'oauth_client', iat: Number(claims.iat ?? 0), redirectUris, clientName: typeof claims.clientName === 'string' ? claims.clientName : undefined };
}

export async function issueAuthorizationCode(input: {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  workspaceId: string;
  email: string;
}, secret: string) {
  const claims: AuthorizationCodeClaims = {
    typ: 'authorization_code',
    iat: now(),
    exp: now() + 300,
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    resource: input.resource,
    scope: normalizeScope(input.scope).join(' '),
    workspaceId: input.workspaceId,
    email: input.email,
    nonce: crypto.randomUUID(),
  };
  return signCompact(claims, secret, 'DIALOG-OAUTH-CODE');
}

export async function redeemAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource: string;
  issuer: string;
}, secret: string) {
  const claims = await verifyCompact(input.code, secret, 'DIALOG-OAUTH-CODE');
  if (!claims || claims.typ !== 'authorization_code') throw new OAuthError('invalid_grant', 'Invalid authorization code');
  if (Number(claims.exp ?? 0) <= now()) throw new OAuthError('invalid_grant', 'Authorization code expired');
  if (claims.clientId !== input.clientId || claims.redirectUri !== input.redirectUri || claims.resource !== input.resource) {
    throw new OAuthError('invalid_grant', 'Authorization code binding mismatch');
  }
  if (typeof claims.codeChallenge !== 'string' || !(await verifyPkce(input.codeVerifier, claims.codeChallenge))) {
    throw new OAuthError('invalid_grant', 'PKCE verification failed');
  }
  const workspaceId = String(claims.workspaceId ?? '');
  const email = String(claims.email ?? '');
  const scope = normalizeScope(String(claims.scope ?? '')).join(' ');
  if (!workspaceId || !email) throw new OAuthError('invalid_grant', 'Authorization code missing subject');
  return issueTokenPair({ clientId: input.clientId, workspaceId, email, scope, resource: input.resource, issuer: input.issuer }, secret);
}

export async function redeemRefreshToken(input: {
  refreshToken: string;
  clientId: string;
  resource: string;
  issuer: string;
  requestedScope?: string;
}, secret: string) {
  const claims = await verifyCompact(input.refreshToken, secret, 'DIALOG-OAUTH-REFRESH');
  if (!claims || claims.typ !== 'refresh_token') throw new OAuthError('invalid_grant', 'Invalid refresh token');
  if (Number(claims.exp ?? 0) <= now()) throw new OAuthError('invalid_grant', 'Refresh token expired');
  if (claims.clientId !== input.clientId || claims.aud !== input.resource || claims.iss !== input.issuer) {
    throw new OAuthError('invalid_grant', 'Refresh token binding mismatch');
  }
  const originalScopes = normalizeScope(String(claims.scope ?? ''));
  const requested = input.requestedScope ? normalizeScope(input.requestedScope) : originalScopes;
  if (requested.some((scope) => !originalScopes.includes(scope))) throw new OAuthError('invalid_scope', 'Requested scope exceeds original grant');
  return issueTokenPair({
    clientId: input.clientId,
    workspaceId: String(claims.workspaceId ?? ''),
    email: String(claims.sub ?? ''),
    scope: requested.join(' '),
    resource: input.resource,
    issuer: input.issuer,
  }, secret);
}

export async function verifyOAuthAccessToken(token: string, request: Request, secret: string, expectedWorkspaceId?: string): Promise<VerifiedOAuthAccess | null> {
  const claims = await verifyCompact(token, secret, 'DIALOG-OAUTH-ACCESS');
  if (!claims || claims.typ !== 'access_token') return null;
  const issuer = oauthIssuer(request);
  const resource = canonicalMcpResource(request);
  if (claims.iss !== issuer || claims.aud !== resource || Number(claims.exp ?? 0) <= now()) return null;
  const workspaceId = String(claims.workspaceId ?? '');
  if (!workspaceId || (expectedWorkspaceId && workspaceId !== expectedWorkspaceId)) return null;
  const email = String(claims.sub ?? '');
  const clientId = String(claims.clientId ?? '');
  if (!email || !clientId) return null;
  return { email, workspaceId, clientId, scopes: normalizeScope(String(claims.scope ?? '')) };
}

export function normalizeScope(scope: string): string[] {
  const allowed = new Set<string>(DIALOG_MCP_SCOPES);
  return [...new Set(scope.split(/\s+/).map((item) => item.trim()).filter((item) => allowed.has(item)))];
}

export function validRedirectUri(uri: string) {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol === 'https:') return true;
    return parsed.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

async function issueTokenPair(input: {
  clientId: string;
  workspaceId: string;
  email: string;
  scope: string;
  resource: string;
  issuer: string;
}, secret: string) {
  const scopes = normalizeScope(input.scope);
  const accessClaims: AccessTokenClaims = {
    typ: 'access_token',
    iat: now(),
    exp: now() + 3600,
    iss: input.issuer,
    aud: input.resource,
    sub: input.email,
    scope: scopes.join(' '),
    workspaceId: input.workspaceId,
    clientId: input.clientId,
  };
  const accessToken = await signCompact(accessClaims, secret, 'DIALOG-OAUTH-ACCESS');
  const response: Record<string, unknown> = {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: scopes.join(' '),
  };
  if (scopes.includes('offline_access')) {
    const refreshClaims: RefreshTokenClaims = {
      typ: 'refresh_token',
      iat: now(),
      exp: now() + 60 * 60 * 24 * 30,
      iss: input.issuer,
      aud: input.resource,
      sub: input.email,
      scope: scopes.join(' '),
      workspaceId: input.workspaceId,
      clientId: input.clientId,
      nonce: crypto.randomUUID(),
    };
    response.refresh_token = await signCompact(refreshClaims, secret, 'DIALOG-OAUTH-REFRESH');
  }
  return response;
}

async function verifyPkce(verifier: string, expectedChallenge: string) {
  if (!verifier || verifier.length < 43 || verifier.length > 128) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier)));
  return base64url(digest) === expectedChallenge;
}

async function signCompact(payload: Record<string, unknown>, secret: string, purpose: string) {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const signature = await hmac(`${purpose}.${body}`, secret);
  return `${body}.${base64url(signature)}`;
}

async function verifyCompact(token: string, secret: string, purpose: string): Promise<Record<string, unknown> | null> {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) return null;
  const expected = await hmac(`${purpose}.${body}`, secret);
  const actual = fromBase64url(signature);
  if (actual.length !== expected.length) return null;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, actual, encoder.encode(`${purpose}.${body}`));
  if (!ok) return null;
  try {
    return JSON.parse(new TextDecoder().decode(fromBase64url(body)));
  } catch {
    return null;
  }
}

async function hmac(valueToSign: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(valueToSign)));
}

function base64url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(valueToDecode: string) {
  const padded = valueToDecode.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (valueToDecode.length % 4 || 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function now() {
  return Math.floor(Date.now() / 1000);
}

function value(name: string) {
  return process.env[name]?.trim() || undefined;
}
