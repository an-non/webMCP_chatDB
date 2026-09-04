import { invokeDialogTool } from '@/lib/server/dialog-service';
import { fail, readJson, reply, ws } from '@/lib/server/http';
import { sourceFromRequest } from '@/lib/server/source';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const info = ws(request); const url = new URL(request.url);
    const records = await invokeDialogTool({ workspaceId: info.id, source: sourceFromRequest(request) }, 'search_dialog_records', { query: url.searchParams.get('q') ?? undefined, suggestedIndex: url.searchParams.get('index') ?? undefined, limit: Number(url.searchParams.get('limit') ?? 50) });
    return reply(request, { ok: true, records });
  } catch (error) { return fail(request, error, 500); }
}
export async function POST(request: Request) {
  try { const info = ws(request); const body = await readJson(request); return reply(request, { ok: true, record: await invokeDialogTool({ workspaceId: info.id, source: sourceFromRequest(request) }, 'save_and_index_dialog_record', body) }, { status: 201 }); }
  catch (error) { return fail(request, error); }
}
