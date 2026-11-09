CREATE TABLE `debt_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`debt_id` text NOT NULL,
	`kind` text NOT NULL,
	`wallet_id` text,
	`amount` integer NOT NULL,
	`occurred_on` text NOT NULL,
	`note` text NOT NULL,
	`recurring_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `debt_entries_user_seq_idx` ON `debt_entries` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `debt_entries_change_seq_idx` ON `debt_entries` (`change_seq`);--> statement-breakpoint
CREATE INDEX `debt_entries_profile_idx` ON `debt_entries` (`profile_id`);--> statement-breakpoint
CREATE INDEX `debt_entries_debt_idx` ON `debt_entries` (`debt_id`);--> statement-breakpoint
CREATE INDEX `debt_entries_wallet_idx` ON `debt_entries` (`wallet_id`);--> statement-breakpoint
CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`direction` text NOT NULL,
	`person` text NOT NULL,
	`note` text NOT NULL,
	`currency_code` text NOT NULL,
	`count_as` text NOT NULL,
	`category_id` text,
	`due_on` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `debts_user_seq_idx` ON `debts` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `debts_change_seq_idx` ON `debts` (`change_seq`);--> statement-breakpoint
CREATE INDEX `debts_profile_idx` ON `debts` (`profile_id`);--> statement-breakpoint
CREATE INDEX `debts_category_idx` ON `debts` (`category_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `debt_id` text;--> statement-breakpoint
CREATE INDEX `transactions_debt_idx` ON `transactions` (`debt_id`);--> statement-breakpoint
ALTER TABLE `recurring_rules` ADD `debt_id` text;--> statement-breakpoint
CREATE INDEX `recurring_rules_debt_idx` ON `recurring_rules` (`debt_id`);