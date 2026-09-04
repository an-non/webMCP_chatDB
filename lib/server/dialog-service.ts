import { env } from 'cloudflare:workers';
import type { DialogToolInput, DialogToolName } from '../dialog-tools';
import { organizeWithAI } from './ai';
import { activity, attachFile, createRecord, deleteRecord, getRecord, listIndexes, listRecords, overview, updateRecord } from './db';
import type { InvocationSource } from './source';

export type DialogServiceContext = { workspaceId: string; source: InvocationSource };
const WEBMCP_FILE_LIMIT = 2 * 1024 * 1024;
const UI_FILE_LIMIT = 25 * 1024 * 1024;

function stringValue(value: unknown): string { return typeof value === 'string' ? value : ''; }
function objectValue(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export async function invokeDialogTool(context: DialogServiceContext, name: DialogToolName, input: DialogToolInput = {}) {
  switch (name) {
    case 'get_dialog_index_overview':
      return overview(context.workspaceId);
    case 'list_suggested_indexes':
      return listIndexes(context.workspaceId);
    case 'search_dialog_records':
      return listRecords(context.workspaceId, {
        q: stringValue(input.query) || undefined,
        suggestedIndex: stringValue(input.suggestedIndex) || undefined,
        limit: typeof input.limit === 'number' ? input.limit : undefined,
      });
    case 'get_dialog_record': {
      const id = stringValue(input.id); if (!id) throw new Error('id_required');
      const record = await getRecord(context.workspaceId, id); if (!record) throw new Error('not_found');
      return record;
    }
    case 'save_and_index_dialog_record': {
      if (!stringValue(input.title)) throw new Error('title_required');
      return createRecord(context.workspaceId, input as any, context.source);
    }
    case 'update_dialog_record': {
      const id = stringValue(input.id); if (!id) throw new Error('id_required');
      const record = await updateRecord(context.workspaceId, id, objectValue(input.patch), context.source, 'update_dialog_record');
      if (!record) throw new Error('not_found'); return record;
    }
    case 'move_dialog_record_index': {
      const id = stringValue(input.id); const suggestedIndex = stringValue(input.suggestedIndex);
      if (!id) throw new Error('id_required'); if (!suggestedIndex) throw new Error('suggested_index_required');
      const record = await updateRecord(context.workspaceId, id, { suggestedIndex, indexConfidence: input.indexConfidence, needsReview: input.needsReview } as any, context.source, 'move_dialog_record_index');
      if (!record) throw new Error('not_found'); return record;
    }
    case 'delete_dialog_record': {
      const id = stringValue(input.id); if (!id) throw new Error('id_required');
      return deleteRecord(context.workspaceId, id, context.source);
    }
    case 'get_dialog_index_activity':
      return activity(context.workspaceId, 50);
    case 'save_dialog_file_base64':
      return saveBase64File(context, input);
    case 'organize_text_with_external_ai': {
      const content = stringValue(input.content); if (!content.trim()) throw new Error('content_required');
      return organizeWithAI({ content, hint: stringValue(input.hint) || undefined });
    }
  }
}

export async function saveUploadedFile(context: DialogServiceContext, file: File, input: { title?: string; suggestedIndex?: string }) {
  if (file.size > UI_FILE_LIMIT) throw new Error('ui_upload_limit_25mb');
  const index = input.suggestedIndex || '/inbox';
  const record = await createRecord(context.workspaceId, { title: input.title || file.name, summary: '', recordType: 'file', suggestedIndex: index, needsReview: index === '/inbox', metadata: { filename: file.name } }, context.source);
  const key = objectKey(context.workspaceId, record.id, file.name);
  try {
    await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
    return await attachFile(context.workspaceId, record.id, { key, mimeType: file.type || 'application/octet-stream', size: file.size }, context.source, 'upload_dialog_file');
  } catch (error) {
    await Promise.allSettled([env.FILES.delete(key), deleteRecord(context.workspaceId, record.id, 'web-ui')]);
    throw error;
  }
}

async function saveBase64File(context: DialogServiceContext, input: DialogToolInput) {
  const filename = stringValue(input.filename); const base64 = stringValue(input.base64);
  if (!filename || !base64) throw new Error('filename_and_base64_required');
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)); }
  catch { throw new Error('invalid_base64'); }
  if (bytes.byteLength > WEBMCP_FILE_LIMIT) throw new Error('webmcp_file_limit_2mb_use_ui_upload_for_larger_files');
  const record = await createRecord(context.workspaceId, {
    title: stringValue(input.title) || filename,
    summary: stringValue(input.summary), content: stringValue(input.content), recordType: 'file',
    suggestedIndex: stringValue(input.suggestedIndex) || undefined,
    indexConfidence: typeof input.indexConfidence === 'number' ? input.indexConfidence : undefined,
    tags: Array.isArray(input.tags) ? input.tags.map(String) : undefined,
    metadata: { filename },
  }, context.source);
  const key = objectKey(context.workspaceId, record.id, filename);
  const mimeType = stringValue(input.mimeType) || 'application/octet-stream';
  try {
    await env.FILES.put(key, bytes, { httpMetadata: { contentType: mimeType } });
    return await attachFile(context.workspaceId, record.id, { key, mimeType, size: bytes.byteLength }, context.source, 'save_dialog_file_base64');
  } catch (error) {
    await Promise.allSettled([env.FILES.delete(key), deleteRecord(context.workspaceId, record.id, context.source)]);
    throw error;
  }
}

function objectKey(workspaceId: string, recordId: string, filename: string) {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-180) || 'file.bin';
  return `objects/${workspaceId}/${recordId}/${safeName}`;
}
