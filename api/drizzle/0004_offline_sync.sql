CREATE TABLE `currencies` (
	`code` text PRIMARY KEY NOT NULL,
	`minor_unit` integer NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`change_seq` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `currencies_change_seq_idx` ON `currencies` (`change_seq`);--> statement-breakpoint
CREATE TABLE `change_history` (
	`id` text PRIMARY KEY NOT NULL,
	`table` text NOT NULL,
	`row_id` text NOT NULL,
	`wallet_id` text,
	`overwritten_by` text NOT NULL,
	`overwritten_by_device` text NOT NULL,
	`previous` text NOT NULL,
	`loser_user_id` text NOT NULL,
	`loser_device_id` text,
	`change_seq` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`loser_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `change_history_loser_seq_idx` ON `change_history` (`loser_user_id`,`change_seq`);--> statement-breakpoint
CREATE TABLE `sync_ops` (
	`op_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`applied_at` integer NOT NULL,
	`result` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_ops_applied_at_idx` ON `sync_ops` (`applied_at`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_seq` integer DEFAULT 0 NOT NULL,
	`purged_seq` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sync_state_single_row" CHECK("sync_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `sync_probes` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sync_probes_user_seq_idx` ON `sync_probes` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `sync_probes_change_seq_idx` ON `sync_probes` (`change_seq`);