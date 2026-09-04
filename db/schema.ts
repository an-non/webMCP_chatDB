import { sql } from 'drizzle-orm';
import { index, primaryKey, real, sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const records = sqliteTable('records', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  contentText: text('content_text').notNull().default(''),
  recordType: text('record_type').notNull().default('text'),
  suggestedIndex: text('suggested_index').notNull().default('/inbox'),
  indexConfidence: real('index_confidence').notNull().default(0),
  tagsJson: text('tags_json').notNull().default('[]'),
  metadataJson: text('metadata_json').notNull().default('{}'),
  fileObjectKey: text('file_object_key'),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  needsReview: integer('needs_review').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  deletedAt: text('deleted_at'),
}, (table) => [
  index('idx_records_workspace_updated').on(table.workspaceId, table.updatedAt),
  index('idx_records_workspace_index').on(table.workspaceId, table.suggestedIndex),
]);

export const indexAliases = sqliteTable('index_aliases', {
  workspaceId: text('workspace_id').notNull(),
  suggestedIndex: text('suggested_index').notNull(),
  alias: text('alias').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.workspaceId, table.suggestedIndex, table.alias] })]);

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  actor: text('actor').notNull(),
  toolName: text('tool_name').notNull(),
  recordId: text('record_id'),
  detailJson: text('detail_json').notNull().default('{}'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index('idx_audit_workspace_created').on(table.workspaceId, table.createdAt)]);
