CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`wallet_id` text NOT NULL,
	`category_id` text NOT NULL,
	`amount` integer NOT NULL,
	`occurred_on` text NOT NULL,
	`note` text NOT NULL,
	`exclude_from_report` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transactions_user_seq_idx` ON `transactions` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `transactions_change_seq_idx` ON `transactions` (`change_seq`);--> statement-breakpoint
CREATE INDEX `transactions_profile_idx` ON `transactions` (`profile_id`);--> statement-breakpoint
CREATE INDEX `transactions_wallet_idx` ON `transactions` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `transactions_category_idx` ON `transactions` (`category_id`);