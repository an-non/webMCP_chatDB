import { getOAuthRuntimeConfig, issueRegisteredClient, oauthIssuer, validRedirectUri } from '@/lib/server/oauth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const config = getOAuthRuntimeConfig();
  if (!config.signingSecret) return Response.json({ error: 'oauth_not_configured' }, { status: 503 });
  let body: any;
  try { body = await request.json(); }
  catch { return Response.json({ error: 'invalid_client_metadata' }, { status: 400 }); }

  const redirectUris = Array.isArray(body?.redirect_uris)
    ? [...new Set(body.redirect_uris.filter((uri: unknown): uri is string => typeof uri === 'string' && validRedirectUri(uri)))]
    : [];
  if (!redirectUris.length) return Response.json({ error: 'invalid_redirect_uri' }, { status: 400 });

  const clientId = await issueRegisteredClient({
    redirectUris,
    clientName: typeof body?.client_name === 'string' ? body.client_name : undefined,
  }, config.signingSecret);

  return Response.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: typeof body?.client_name === 'string' ? body.client_name : 'ChatGPT MCP client',
    redirect_uris: redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'dialog.read dialog.write offline_access',
    registration_client_uri: `${oauthIssuer(request)}/oauth/register`,
  }, { status: 201, headers: { 'cache-control': 'no-store' } });
}
