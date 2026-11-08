CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`kind` text NOT NULL,
	`wallet_id` text NOT NULL,
	`category_id` text,
	`to_wallet_id` text,
	`amount` integer NOT NULL,
	`note` text NOT NULL,
	`exclude_from_report` integer NOT NULL,
	`start_on` text NOT NULL,
	`frequency` text NOT NULL,
	`interval` integer NOT NULL,
	`end_on` text,
	`end_count` integer,
	`confirm` integer NOT NULL,
	`next_on` text,
	`is_paused` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`change_seq` integer NOT NULL,
	`updated_by` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_wallet_id`) REFERENCES `wallets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `recurring_rules_user_seq_idx` ON `recurring_rules` (`user_id`,`change_seq`);--> statement-breakpoint
CREATE INDEX `recurring_rules_change_seq_idx` ON `recurring_rules` (`change_seq`);--> statement-breakpoint
CREATE INDEX `recurring_rules_profile_idx` ON `recurring_rules` (`profile_id`);--> statement-breakpoint
CREATE INDEX `recurring_rules_wallet_idx` ON `recurring_rules` (`wallet_id`);--> statement-breakpoint
CREATE INDEX `recurring_rules_category_idx` ON `recurring_rules` (`category_id`);--> statement-breakpoint
CREATE INDEX `recurring_rules_to_wallet_idx` ON `recurring_rules` (`to_wallet_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_id` text;--> statement-breakpoint
ALTER TABLE `transfers` ADD `recurring_id` text;