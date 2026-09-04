import { invokeDialogTool } from '@/lib/server/dialog-service';
import { fail, reply, ws } from '@/lib/server/http';
import { sourceFromRequest } from '@/lib/server/source';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { const info = ws(request); return reply(request, { ok: true, activity: await invokeDialogTool({ workspaceId: info.id, source: sourceFromRequest(request) }, 'get_dialog_index_activity') }); }
  catch (error) { return fail(request, error, 500); }
}
