import { invokeDialogTool } from '@/lib/server/dialog-service';
import { fail, readJson, reply } from '@/lib/server/http';
import { sourceFromRequest } from '@/lib/server/source';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try { const body = await readJson(request); return reply(request, { ok: true, result: await invokeDialogTool({ workspaceId: 'external-ai-no-workspace', source: sourceFromRequest(request) }, 'organize_text_with_external_ai', body) }); }
  catch (error) { return fail(request, error, error instanceof Error && error.message.includes('configured') ? 503 : 400); }
}
