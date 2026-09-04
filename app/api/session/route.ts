import { reply, ws } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const info = ws(request);
  return reply(request, { ok: true, workspaceId: info.id });
}
