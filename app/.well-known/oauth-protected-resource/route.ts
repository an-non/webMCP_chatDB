import { canonicalMcpResource, DIALOG_MCP_SCOPES, oauthIssuer } from '@/lib/server/oauth';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  const resource = canonicalMcpResource(request);
  const issuer = oauthIssuer(request);
  return Response.json({
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...DIALOG_MCP_SCOPES],
    bearer_methods_supported: ['header'],
    resource_documentation: `${issuer}/#remote-mcp`,
  }, { headers: { 'cache-control': 'no-store' } });
}
