CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`id_token` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lyrics_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`artist` text DEFAULT '',
	`title_norm` text NOT NULL,
	`artist_norm` text NOT NULL,
	`lyrics_canonical` text NOT NULL,
	`version_count` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'single' NOT NULL,
	`normalized_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX `idx_lyrics_catalog_norm` ON `lyrics_catalog` (`title_norm`,`artist_norm`);--> statement-breakpoint
CREATE INDEX `idx_lyrics_catalog_status` ON `lyrics_catalog` (`status`);--> statement-breakpoint
CREATE TABLE `lyrics_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`catalog_id` text NOT NULL,
	`user_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`lyrics` text NOT NULL,
	`source` text DEFAULT 'user',
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`catalog_id`) REFERENCES `lyrics_catalog`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_lyrics_versions_catalog` ON `lyrics_versions` (`catalog_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_lyrics_versions_user_catalog` ON `lyrics_versions` (`user_id`,`catalog_id`);--> statement-breakpoint
CREATE TABLE `backgrounds` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`r2_key` text NOT NULL,
	`poster_key` text NOT NULL,
	`duration_sec` integer NOT NULL,
	`license` text NOT NULL,
	`tags` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `decks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`catalog_id` text,
	`scope` text DEFAULT 'library' NOT NULL,
	`presentation_id` text,
	`title` text NOT NULL,
	`artist` text DEFAULT '',
	`lyrics_raw` text NOT NULL,
	`slides` text NOT NULL,
	`background_id` text,
	`style` text NOT NULL,
	`visibility` text DEFAULT 'private' NOT NULL,
	`forked_from` text,
	`fork_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`catalog_id`) REFERENCES `lyrics_catalog`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`background_id`) REFERENCES `backgrounds`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_decks_user_scope` ON `decks` (`user_id`,`scope`);--> statement-breakpoint
CREATE INDEX `idx_decks_presentation` ON `decks` (`presentation_id`);--> statement-breakpoint
CREATE INDEX `idx_decks_visibility_forks` ON `decks` (`visibility`,`fork_count`);--> statement-breakpoint
CREATE INDEX `idx_decks_catalog` ON `decks` (`catalog_id`);--> statement-breakpoint
CREATE TABLE `presentation_items` (
	`id` text PRIMARY KEY NOT NULL,
	`presentation_id` text NOT NULL,
	`deck_id` text NOT NULL,
	`order` integer NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deck_id`) REFERENCES `decks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_presentation_items_order` ON `presentation_items` (`presentation_id`,`order`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_presentation_items_unique` ON `presentation_items` (`presentation_id`,`deck_id`);--> statement-breakpoint
CREATE TABLE `presentations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`service_date` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_presentations_user_date` ON `presentations` (`user_id`,`service_date`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
