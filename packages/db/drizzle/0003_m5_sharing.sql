DROP INDEX `idx_lyrics_catalog_norm`;--> statement-breakpoint
ALTER TABLE `lyrics_catalog` ADD `canonical_source` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lyrics_catalog_norm` ON `lyrics_catalog` (`title_norm`,`artist_norm`);--> statement-breakpoint
ALTER TABLE `decks` ADD `contribute_to_catalog` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `origin` text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE `decks` ADD `forked_from_author_name` text;--> statement-breakpoint
ALTER TABLE `decks` ADD `published_at` integer;--> statement-breakpoint
ALTER TABLE `decks` ADD `takedown_at` integer;--> statement-breakpoint
CREATE INDEX `idx_decks_forked_from` ON `decks` (`user_id`,`forked_from`);--> statement-breakpoint
ALTER TABLE `reports` ADD `details` text;--> statement-breakpoint
ALTER TABLE `reports` ADD `resolved_at` integer;--> statement-breakpoint
ALTER TABLE `reports` ADD `resolution_note` text;--> statement-breakpoint
CREATE INDEX `idx_reports_status_created` ON `reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_target` ON `reports` (`target_type`,`target_id`);
