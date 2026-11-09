CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`start_on` text NOT NULL,
	`end_on` text,
	`is_closed` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `events_user_seq_idx` ON `events` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `events_change_seq_idx` ON `events` (`change_seq`);--> statement-breakpoint
CREATE INDEX `events_profile_idx` ON `events` (`profile_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `event_id` text;--> statement-breakpoint
CREATE INDEX `transactions_event_idx` ON `transactions` (`event_id`);