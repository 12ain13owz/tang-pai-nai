CREATE TABLE `wallet_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`wallet_ids` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_sent_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wallet_invites_profile_email_idx` ON `wallet_invites` (`profile_id`,`email`);--> statement-breakpoint
CREATE INDEX `wallet_invites_email_idx` ON `wallet_invites` (`email`);--> statement-breakpoint
CREATE INDEX `wallet_invites_expires_idx` ON `wallet_invites` (`expires_at`);