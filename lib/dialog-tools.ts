export const DIALOG_TOOL_NAMES = [
  'get_dialog_index_overview',
  'list_suggested_indexes',
  'search_dialog_records',
  'get_dialog_record',
  'save_and_index_dialog_record',
  'update_dialog_record',
  'move_dialog_record_index',
  'delete_dialog_record',
  'get_dialog_index_activity',
  'save_dialog_file_base64',
  'organize_text_with_external_ai',
] as const;

export type DialogToolName = (typeof DIALOG_TOOL_NAMES)[number];
export type DialogToolInput = Record<string, unknown>;

const empty = { type: 'object', properties: {}, additionalProperties: false } as const;
const str = { type: 'string' } as const;

export type DialogToolDefinition = {
  name: DialogToolName;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; openWorldHint?: boolean };
};

export const DIALOG_TOOL_DEFINITIONS: readonly DialogToolDefinition[] = [
  { name: 'get_dialog_index_overview', title: 'Inspect saved dialog data', description: 'Get counts and configuration for the current Dialog Index workspace. Use this before broad data-management tasks.', inputSchema: empty, annotations: { readOnlyHint: true } },
  { name: 'list_suggested_indexes', title: 'List suggested indexes', description: 'List non-authoritative logical index suggestions currently used by saved records. Users do not need to know these paths.', inputSchema: empty, annotations: { readOnlyHint: true } },
  { name: 'search_dialog_records', title: 'Search saved records', description: 'Search the user-owned data store by natural keywords across titles, summaries, content, and tags. Prefer this over requiring an exact logical path.', inputSchema: { type: 'object', properties: { query: str, suggestedIndex: str, limit: { type: 'number', minimum: 1, maximum: 100 } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'get_dialog_record', title: 'Get saved record', description: 'Read one saved record by stable ID, independent of its current suggested index.', inputSchema: { type: 'object', properties: { id: str }, required: ['id'], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'save_and_index_dialog_record', title: 'Save and index dialog data', description: 'Persist user-requested text or structured notes. ChatGPT should infer a helpful title, summary, tags and optional suggestedIndex from the conversation. The index is only a suggestion; stable IDs and search remain authoritative. Use /inbox when uncertain.', inputSchema: { type: 'object', properties: { title: str, summary: str, content: str, recordType: str, suggestedIndex: str, indexConfidence: { type: 'number', minimum: 0, maximum: 1 }, tags: { type: 'array', items: str, maxItems: 24 }, metadata: { type: 'object' }, needsReview: { type: 'boolean' } }, required: ['title', 'content'], additionalProperties: false } },
  { name: 'update_dialog_record', title: 'Update saved record', description: 'Update fields of one record by stable ID without requiring knowledge of its current index.', inputSchema: { type: 'object', properties: { id: str, patch: { type: 'object' } }, required: ['id', 'patch'], additionalProperties: false } },
  { name: 'move_dialog_record_index', title: 'Change suggested index', description: 'Change only the non-authoritative suggested logical index for a record. The stable record ID and file object remain unchanged.', inputSchema: { type: 'object', properties: { id: str, suggestedIndex: str, indexConfidence: { type: 'number', minimum: 0, maximum: 1 }, needsReview: { type: 'boolean' } }, required: ['id', 'suggestedIndex'], additionalProperties: false } },
  { name: 'delete_dialog_record', title: 'Delete saved record', description: 'Soft-delete one record by stable ID. Use only when the user explicitly asks to delete it.', inputSchema: { type: 'object', properties: { id: str }, required: ['id'], additionalProperties: false }, annotations: { destructiveHint: true } },
  { name: 'get_dialog_index_activity', title: 'Inspect agent activity', description: 'Read recent human and agent storage activity for auditability.', inputSchema: empty, annotations: { readOnlyHint: true } },
  { name: 'save_dialog_file_base64', title: 'Save a small file', description: 'Save a small file (up to 2 MiB) into R2 and index its metadata in D1. For larger files, ask the user to use the site upload control.', inputSchema: { type: 'object', properties: { filename: str, mimeType: str, base64: str, title: str, summary: str, content: str, suggestedIndex: str, indexConfidence: { type: 'number', minimum: 0, maximum: 1 }, tags: { type: 'array', items: str } }, required: ['filename', 'base64'], additionalProperties: false } },
  { name: 'organize_text_with_external_ai', title: 'Organize text with configured AI', description: 'Optionally call the server-configured external AI provider to propose a title, summary, tags, and suggested logical index. This tool does not save anything by itself.', inputSchema: { type: 'object', properties: { content: str, hint: str }, required: ['content'], additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: true } },
] as const;

export function isDialogToolName(value: unknown): value is DialogToolName {
  return typeof value === 'string' && (DIALOG_TOOL_NAMES as readonly string[]).includes(value);
}
