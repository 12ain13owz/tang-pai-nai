CREATE TABLE `wallet_members` (
	`wallet_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`wallet_id`, `user_id`),
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `wallet_members_user_idx` ON `wallet_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `wallets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`name` text NOT NULL,
	`currency_code` text NOT NULL,
	`initial_balance` integer NOT NULL,
	`icon` text NOT NULL,
	`color` text NOT NULL,
	`exclude_from_total` integer NOT NULL,
	`is_archived` integer NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `wallets_user_seq_idx` ON `wallets` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `wallets_change_seq_idx` ON `wallets` (`change_seq`);--> statement-breakpoint
CREATE INDEX `wallets_profile_idx` ON `wallets` (`profile_id`);