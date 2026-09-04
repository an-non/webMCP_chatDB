import { invokeDialogTool } from '@/lib/server/dialog-service';
import { fail, readJson, reply, ws } from '@/lib/server/http';
import { sourceFromRequest } from '@/lib/server/source';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try { const info = ws(request); const id = new URL(request.url).searchParams.get('id'); const record = await invokeDialogTool({ workspaceId: info.id, source: sourceFromRequest(request) }, 'get_dialog_record', { id }); return reply(request, { ok: true, record }); }
  catch (error) { return fail(request, error, error instanceof Error && error.message === 'not_found' ? 404 : 400); }
}
export async function PATCH(request: Request) {
  try { const info = ws(request); const body = await readJson(request); const tool = body.operation === 'move_dialog_record_index' ? 'move_dialog_record_index' : 'update_dialog_record'; const input = tool === 'move_dialog_record_index' ? { id: body.id, ...(body.patch ?? {}) } : body; const record = await invokeDialogTool({ workspaceId: info.id, source: sourceFromRequest(request) }, tool, input); return reply(request, { ok: true, record }); }
  catch (error) { return fail(request, error, error instanceof Error && error.message === 'not_found' ? 404 : 400); }
}
export async function DELETE(request: Request) {
  try { const info = ws(request); const body = await readJson(request); return reply(request, { ok: true, result: await invokeDialogTool({ workspaceId: info.id, source: sourceFromRequest(request) }, 'delete_dialog_record', body) }); }
  catch (error) { return fail(request, error); }
}
