CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`actor` text NOT NULL,
	`tool_name` text NOT NULL,
	`record_id` text,
	`detail_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_workspace_created` ON `audit_events` (`workspace_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `index_aliases` (
	`workspace_id` text NOT NULL,
	`suggested_index` text NOT NULL,
	`alias` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`workspace_id`, `suggested_index`, `alias`)
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`content_text` text DEFAULT '' NOT NULL,
	`record_type` text DEFAULT 'text' NOT NULL,
	`suggested_index` text DEFAULT '/inbox' NOT NULL,
	`index_confidence` real DEFAULT 0 NOT NULL,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`file_object_key` text,
	`mime_type` text,
	`size_bytes` integer,
	`needs_review` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_records_workspace_updated` ON `records` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_records_workspace_index` ON `records` (`workspace_id`,`suggested_index`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
