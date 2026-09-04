import { env } from 'cloudflare:workers';
import { DIALOG_TOOL_DEFINITIONS } from '@/lib/dialog-tools';
import { aiStatus } from '@/lib/server/ai';
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
  const remoteConfigured = remoteMcpConfigured(config);
  const origin = new URL(request.url).origin;
  const workspaceMatchesSession = remoteConfigured ? config.workspaceId === session.id : null;

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
        scheme: 'static-bearer',
        configured: Boolean(config.token),
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
