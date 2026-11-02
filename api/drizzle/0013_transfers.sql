CREATE TABLE `transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`from_wallet_id` text NOT NULL,
	`to_wallet_id` text NOT NULL,
	`amount` integer NOT NULL,
	`occurred_on` text NOT NULL,
	`note` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transfers_user_seq_idx` ON `transfers` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `transfers_change_seq_idx` ON `transfers` (`change_seq`);--> statement-breakpoint
CREATE INDEX `transfers_profile_idx` ON `transfers` (`profile_id`);--> statement-breakpoint
CREATE INDEX `transfers_from_wallet_idx` ON `transfers` (`from_wallet_id`);--> statement-breakpoint
CREATE INDEX `transfers_to_wallet_idx` ON `transfers` (`to_wallet_id`);