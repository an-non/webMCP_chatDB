import { consumeOAuthAuthorizationCode } from '@/lib/server/db';
import {
  canonicalMcpResource,
  getOAuthRuntimeConfig,
  oauthIssuer,
  OAuthError,
  redeemAuthorizationCode,
  redeemRefreshToken,
  verifyRegisteredClient,
} from '@/lib/server/oauth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = getOAuthRuntimeConfig();
  if (!config.signingSecret || !config.workspaceId) return oauthError('temporarily_unavailable', 'OAuth is not configured', 503);

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/x-www-form-urlencoded')) {
    return oauthError('invalid_request', 'token endpoint requires application/x-www-form-urlencoded', 415);
  }

  const form = await request.formData();
  const grantType = String(form.get('grant_type') ?? '');
  const clientId = String(form.get('client_id') ?? '');
  const resource = String(form.get('resource') ?? '');
  const expectedResource = canonicalMcpResource(request);
  if (!clientId) return oauthError('invalid_client', 'client_id is required', 401);
  const client = await verifyRegisteredClient(clientId, config.signingSecret);
  if (!client) return oauthError('invalid_client', 'Unknown client', 401);
  if (resource !== expectedResource) return oauthError('invalid_target', 'resource does not match this MCP endpoint', 400);

  try {
    if (grantType === 'authorization_code') {
      const code = String(form.get('code') ?? '');
      const redirectUri = String(form.get('redirect_uri') ?? '');
      const codeVerifier = String(form.get('code_verifier') ?? '');
      if (!code || !redirectUri || !codeVerifier) throw new OAuthError('invalid_request', 'code, redirect_uri and code_verifier are required');
      if (!client.redirectUris.includes(redirectUri)) throw new OAuthError('invalid_grant', 'redirect_uri is not registered');
      const token = await redeemAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
        resource,
        issuer: oauthIssuer(request),
        consumeNonce: consumeOAuthAuthorizationCode,
      }, config.signingSecret);
      return Response.json(token, { headers: noStore() });
    }

    if (grantType === 'refresh_token') {
      const refreshToken = String(form.get('refresh_token') ?? '');
      if (!refreshToken) throw new OAuthError('invalid_request', 'refresh_token is required');
      const token = await redeemRefreshToken({
        refreshToken,
        clientId,
        resource,
        issuer: oauthIssuer(request),
        requestedScope: form.get('scope') == null ? undefined : String(form.get('scope')),
      }, config.signingSecret);
      return Response.json(token, { headers: noStore() });
    }

    return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported', 400);
  } catch (error) {
    if (error instanceof OAuthError) return oauthError(error.code, error.message, error.status);
    return oauthError('server_error', error instanceof Error ? error.message : 'token exchange failed', 500);
  }
}

function oauthError(error: string, description: string, status: number) {
  return Response.json({ error, error_description: description }, { status, headers: noStore() });
}

function noStore() {
  return { 'cache-control': 'no-store', pragma: 'no-cache' };
}
