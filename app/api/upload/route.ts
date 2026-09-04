import { saveUploadedFile } from '@/lib/server/dialog-service';
import { fail, reply, ws } from '@/lib/server/http';
import { sourceFromRequest } from '@/lib/server/source';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const info = ws(request); const form = await request.formData(); const file = form.get('file');
    if (!(file instanceof File)) throw new Error('file_required');
    const index = String(form.get('suggestedIndex') ?? '/inbox'); const title = String(form.get('title') ?? file.name);
    const record = await saveUploadedFile({ workspaceId: info.id, source: sourceFromRequest(request) }, file, { title, suggestedIndex: index });
    return reply(request, { ok: true, record }, { status: 201 });
  } catch (error) { return fail(request, error); }
}
