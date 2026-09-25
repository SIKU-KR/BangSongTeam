CREATE TABLE `presentation_members` (
	`presentation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch()),
	PRIMARY KEY(`presentation_id`, `user_id`),
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_presentation_members_user` ON `presentation_members` (`user_id`);--> statement-breakpoint
ALTER TABLE `presentations` ADD `link_access` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `presentations` ADD `link_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_presentations_link_token` ON `presentations` (`link_token`);