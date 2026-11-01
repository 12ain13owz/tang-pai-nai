CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`type` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`is_archived` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `categories_user_seq_idx` ON `categories` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `categories_change_seq_idx` ON `categories` (`change_seq`);--> statement-breakpoint
CREATE INDEX `categories_profile_idx` ON `categories` (`profile_id`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`parent_id`);