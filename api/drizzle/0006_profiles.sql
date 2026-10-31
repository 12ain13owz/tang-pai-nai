CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `profiles_user_seq_idx` ON `profiles` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `profiles_change_seq_idx` ON `profiles` (`change_seq`);