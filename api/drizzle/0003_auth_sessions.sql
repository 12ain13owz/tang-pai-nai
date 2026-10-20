-- Hand-edited: SQLite can't add a NOT NULL column without a default to a table with rows. Existing
-- sessions get their sign-in time back from the absolute expiry (sign-in + 180 days).
ALTER TABLE `sessions` ADD `signed_in_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `sessions` SET `signed_in_at` = `absolute_expires_at` - 15552000000;
