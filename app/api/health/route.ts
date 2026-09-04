import { env } from 'cloudflare:workers';
import { DIALOG_TOOL_DEFINITIONS } from '@/lib/dialog-tools';
import { aiStatus } from '@/lib/server/ai';
import { getOAuthRuntimeConfig, oauthRuntimeConfigured } from '@/lib/server/oauth';
import { getRemoteMcpConfig, remoteMcpConfigured } from '@/lib/server/remote-mcp';
import { reply, ws } from '@/lib/server/http';
import { ensureSchema } from '@/lib/server/schema';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = ws(request);
  const [dbResult, filesResult] = await Promise.allSettled([
    ensureSchema(),
    env.FILES ? env.FILES.list({ limit: 1 }) : Promise.reject(new Error('R2 binding FILES is unavailable')),
  ]);
  const db = state('DB', dbResult);
  const files = state('FILES', filesResult);
  const config = getRemoteMcpConfig();
  const oauth = getOAuthRuntimeConfig();
  const remoteConfigured = remoteMcpConfigured(config);
  const oauthConfigured = oauthRuntimeConfigured(oauth);
  const origin = new URL(request.url).origin;
  const workspaceMatchesSession = remoteConfigured ? config.workspaceId === session.id : null;
  const modes = [config.token ? 'static-bearer' : null, oauthConfigured ? 'oauth2-pkce' : null].filter(Boolean);

  return reply(request, {
    ok: db.ok && files.ok,
    db,
    files,
    webmcp: { ok: true, registration: 'browser', toolCount: DIALOG_TOOL_DEFINITIONS.length },
    remoteMcp: {
      ok: remoteConfigured,
      enabled: remoteConfigured,
      endpoint: `${origin}/mcp`,
      toolCount: remoteConfigured ? DIALOG_TOOL_DEFINITIONS.length : 0,
      authentication: {
        modes,
        staticBearerConfigured: Boolean(config.token),
        oauthConfigured,
        protectedResourceMetadata: `${origin}/.well-known/oauth-protected-resource`,
        authorizationServerMetadata: `${origin}/.well-known/oauth-authorization-server`,
        workspaceConfigured: Boolean(config.workspaceId),
        workspaceMatchesSession,
      },
    },
    session: {
      workspaceId: session.id,
      persistence: 'http-only-cookie',
    },
    ai: aiStatus(),
  }, {
    status: db.ok && files.ok ? 200 : 503,
  });
}

function state(binding: string, result: PromiseSettledResult<unknown>) {
  return result.status === 'fulfilled'
    ? { binding, ok: true }
    : { binding, ok: false, error: result.reason instanceof Error ? result.reason.message : 'unavailable' };
}
