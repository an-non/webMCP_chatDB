import { env } from 'cloudflare:workers';
import { getRecord } from '@/lib/server/db';
import { invokeDialogTool } from '@/lib/server/dialog-service';
import { fail, readJson, reply, ws } from '@/lib/server/http';
import { sourceFromRequest } from '@/lib/server/source';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const info = ws(request); const body = await readJson(request, 3_000_000);
    const record = await invokeDialogTool({ workspaceId: info.id, source: sourceFromRequest(request) }, 'save_dialog_file_base64', body);
    return reply(request, { ok: true, record }, { status: 201 });
  } catch (error) { return fail(request, error); }
}

export async function GET(request: Request) {
  try {
    const info = ws(request); const id = new URL(request.url).searchParams.get('id'); if (!id) throw new Error('id_required');
    const record = await getRecord(info.id, id); if (!record?.fileObjectKey) return reply(request, { ok: false, error: 'file_not_found' }, { status: 404 });
    const object = await env.FILES.get(record.fileObjectKey); if (!object) return reply(request, { ok: false, error: 'file_not_found' }, { status: 404 });
    const filename = typeof record.metadata?.filename === 'string' ? record.metadata.filename : 'download.bin';
    const headers = new Headers(); object.writeHttpMetadata(headers); headers.set('etag', object.httpEtag); headers.set('cache-control', 'private, no-store');
    headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    headers.set('content-security-policy', 'sandbox');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(object.body, { headers });
  } catch (error) { return fail(request, error); }
}
