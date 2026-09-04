import { env } from 'cloudflare:workers';
import { ensureSchema } from './schema';

export type RecordInput = {
  title: string;
  summary?: string;
  content?: string;
  recordType?: string;
  suggestedIndex?: string;
  indexConfidence?: number;
  tags?: string[];
  metadata?: Record<string, unknown>;
  needsReview?: boolean;
};

function path(value?: string): string {
  if (!value?.trim()) return '/inbox';
  const cleaned = `/${value.trim().replace(/^\/+|\/+$/g, '').replace(/\s+/g, '-').replace(/\/{2,}/g, '/')}`;
  return cleaned === '/' ? '/inbox' : cleaned.slice(0, 240);
}

function clamp(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.max(0, Math.min(1, v));
}

function tags(value?: string[]): string[] {
  return [...new Set((value ?? []).map((x) => x.trim()).filter(Boolean))].slice(0, 24);
}

export async function ensureWorkspace(id: string): Promise<void> {
  await ensureSchema();
  await env.DB.prepare('INSERT OR IGNORE INTO workspaces(id) VALUES (?)').bind(id).run();
}

export async function createRecord(workspaceId: string, input: RecordInput, actor = 'web-ui') {
  await ensureWorkspace(workspaceId);
  const id = crypto.randomUUID();
  const index = path(input.suggestedIndex);
  const payload = {
    id,
    title: input.title.trim().slice(0, 240) || 'Untitled',
    summary: (input.summary ?? '').trim().slice(0, 2000),
    content: input.content ?? '',
    recordType: (input.recordType ?? 'text').slice(0, 64),
    index,
    confidence: clamp(input.indexConfidence),
    tags: tags(input.tags),
    metadata: input.metadata ?? {},
    needsReview: input.needsReview || index === '/inbox',
  };
  await env.DB.prepare(`INSERT INTO records(
    id, workspace_id, title, summary, content_text, record_type, suggested_index,
    index_confidence, tags_json, metadata_json, needs_review
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, workspaceId, payload.title, payload.summary, payload.content, payload.recordType,
      payload.index, payload.confidence, JSON.stringify(payload.tags), JSON.stringify(payload.metadata), payload.needsReview ? 1 : 0)
    .run();
  await audit(workspaceId, actor, 'save_and_index_dialog_record', id, { suggestedIndex: payload.index });
  const created = await getRecord(workspaceId, id);
  if (!created) throw new Error('record_create_failed');
  return created;
}

export async function listRecords(workspaceId: string, opts: { q?: string; suggestedIndex?: string; limit?: number } = {}) {
  await ensureWorkspace(workspaceId);
  const limit = Math.max(1, Math.min(100, opts.limit ?? 50));
  const clauses = ['workspace_id = ?', 'deleted_at IS NULL'];
  const binds: unknown[] = [workspaceId];
  if (opts.suggestedIndex) { clauses.push('suggested_index = ?'); binds.push(path(opts.suggestedIndex)); }
  const terms = (opts.q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 8);
  for (const term of terms) {
    clauses.push(`(lower(title) LIKE ? ESCAPE '\\' OR lower(summary) LIKE ? ESCAPE '\\' OR lower(content_text) LIKE ? ESCAPE '\\' OR lower(tags_json) LIKE ? ESCAPE '\\')`);
    const escaped = term.toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`);
    const like = `%${escaped}%`;
    binds.push(like, like, like, like);
  }
  const result = await env.DB.prepare(`SELECT * FROM records WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`)
    .bind(...binds, limit).all();
  return (result.results ?? []).map(normalizeRecord);
}

export async function getRecord(workspaceId: string, id: string) {
  await ensureWorkspace(workspaceId);
  const row = await env.DB.prepare('SELECT * FROM records WHERE workspace_id = ? AND id = ? AND deleted_at IS NULL')
    .bind(workspaceId, id).first();
  return row ? normalizeRecord(row) : null;
}

export async function updateRecord(workspaceId: string, id: string, patch: Partial<RecordInput>, actor = 'web-ui', action?: string) {
  const current = await getRecord(workspaceId, id);
  if (!current) return null;
  const next = {
    title: patch.title ?? current.title,
    summary: patch.summary ?? current.summary,
    content: patch.content ?? current.content,
    recordType: patch.recordType ?? current.recordType,
    suggestedIndex: patch.suggestedIndex ?? current.suggestedIndex,
    indexConfidence: patch.indexConfidence ?? current.indexConfidence,
    tags: patch.tags ?? current.tags,
    metadata: patch.metadata ?? current.metadata,
    needsReview: patch.needsReview ?? current.needsReview,
  };
  await env.DB.prepare(`UPDATE records SET title=?, summary=?, content_text=?, record_type=?, suggested_index=?, index_confidence=?, tags_json=?, metadata_json=?, needs_review=?, updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?`)
    .bind(next.title.slice(0,240), next.summary.slice(0,2000), next.content, next.recordType.slice(0,64), path(next.suggestedIndex), clamp(next.indexConfidence), JSON.stringify(tags(next.tags)), JSON.stringify(next.metadata ?? {}), next.needsReview ? 1 : 0, workspaceId, id).run();
  await audit(workspaceId, actor, action ?? (patch.suggestedIndex ? 'move_dialog_record_index' : 'update_dialog_record'), id, patch);
  return getRecord(workspaceId, id);
}

export async function deleteRecord(workspaceId: string, id: string, actor = 'web-ui') {
  await ensureWorkspace(workspaceId);
  const result = await env.DB.prepare('UPDATE records SET deleted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=? AND deleted_at IS NULL')
    .bind(workspaceId, id).run();
  if (result.meta.changes) await audit(workspaceId, actor, 'delete_dialog_record', id, {});
  return { deleted: Boolean(result.meta.changes), id };
}

export async function listIndexes(workspaceId: string) {
  await ensureWorkspace(workspaceId);
  const result = await env.DB.prepare(`SELECT suggested_index, COUNT(*) AS count, MAX(updated_at) AS updated_at FROM records WHERE workspace_id=? AND deleted_at IS NULL GROUP BY suggested_index ORDER BY count DESC, suggested_index ASC`)
    .bind(workspaceId).all();
  return result.results ?? [];
}

export async function activity(workspaceId: string, limit = 50) {
  await ensureWorkspace(workspaceId);
  const result = await env.DB.prepare('SELECT * FROM audit_events WHERE workspace_id=? ORDER BY created_at DESC LIMIT ?')
    .bind(workspaceId, Math.max(1, Math.min(100, limit))).all();
  return (result.results ?? []).map((row: any) => ({ ...row, detail: safeJson(row.detail_json, {}) }));
}

export async function overview(workspaceId: string) {
  await ensureWorkspace(workspaceId);
  const counts = await env.DB.prepare(`SELECT COUNT(*) AS records, COUNT(DISTINCT suggested_index) AS indexes, SUM(CASE WHEN needs_review=1 THEN 1 ELSE 0 END) AS needs_review FROM records WHERE workspace_id=? AND deleted_at IS NULL`)
    .bind(workspaceId).first<any>();
  return { workspaceId, records: Number(counts?.records ?? 0), indexes: Number(counts?.indexes ?? 0), needsReview: Number(counts?.needs_review ?? 0) };
}

export async function attachFile(workspaceId: string, recordId: string, file: { key: string; mimeType: string; size: number }, actor = 'web-ui', action = 'save_dialog_file_base64') {
  await ensureWorkspace(workspaceId);
  await env.DB.prepare('UPDATE records SET file_object_key=?, mime_type=?, size_bytes=?, record_type=\'file\', updated_at=CURRENT_TIMESTAMP WHERE workspace_id=? AND id=?')
    .bind(file.key, file.mimeType, file.size, workspaceId, recordId).run();
  await audit(workspaceId, actor, action, recordId, { size: file.size, mimeType: file.mimeType });
  return getRecord(workspaceId, recordId);
}

export async function consumeOAuthAuthorizationCode(nonce: string, workspaceId: string) {
  await ensureWorkspace(workspaceId);
  const result = await env.DB.prepare(`
    INSERT INTO audit_events(id, workspace_id, actor, tool_name, record_id, detail_json)
    SELECT ?, ?, 'oauth', 'oauth_authorization_code_redeemed', ?, '{}'
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_events
      WHERE workspace_id=? AND actor='oauth' AND tool_name='oauth_authorization_code_redeemed' AND record_id=?
    )
  `).bind(crypto.randomUUID(), workspaceId, nonce, workspaceId, nonce).run();
  return Boolean(result.meta.changes);
}

async function audit(workspaceId: string, actor: string, toolName: string, recordId: string | null, detail: unknown) {
  await env.DB.prepare('INSERT INTO audit_events(id, workspace_id, actor, tool_name, record_id, detail_json) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), workspaceId, actor, toolName, recordId, JSON.stringify(detail ?? {})).run();
}

function safeJson(value: unknown, fallback: any) {
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeRecord(row: any) {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    content: row.content_text,
    recordType: row.record_type,
    suggestedIndex: row.suggested_index,
    indexConfidence: Number(row.index_confidence ?? 0),
    tags: safeJson(row.tags_json, []),
    metadata: safeJson(row.metadata_json, {}),
    fileObjectKey: row.file_object_key ?? null,
    mimeType: row.mime_type ?? null,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    needsReview: Boolean(row.needs_review),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
