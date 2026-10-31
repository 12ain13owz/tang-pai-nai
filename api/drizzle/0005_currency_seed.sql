-- Master data and the sync counter (docs/features/currency.md → Seed, offline-sync → Data model).
-- A migration, not the dev seeder, because production needs these rows too. Each currency takes
-- the next changeSeq, so devices pull it like any other synced row.
INSERT INTO `sync_state` (`id`, `last_seq`, `purged_seq`) VALUES (1, 0, 0);
--> statement-breakpoint
INSERT INTO `currencies` (`code`, `minor_unit`, `is_active`, `sort_order`, `created_at`, `updated_at`, `change_seq`) VALUES
  ('THB', 2, 1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 1),
  ('USD', 2, 0, 1, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 2),
  ('EUR', 2, 0, 2, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 3),
  ('JPY', 0, 0, 3, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 4),
  ('GBP', 2, 0, 4, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 5),
  ('CNY', 2, 0, 5, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 6),
  ('KRW', 0, 0, 6, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 7),
  ('SGD', 2, 0, 7, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 8),
  ('HKD', 2, 0, 8, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 9),
  ('TWD', 2, 0, 9, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 10),
  ('AUD', 2, 0, 10, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 11),
  ('VND', 0, 0, 11, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 12),
  ('LAK', 2, 0, 12, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 13),
  ('MYR', 2, 0, 13, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000, 14);
--> statement-breakpoint
UPDATE `sync_state` SET `last_seq` = 14 WHERE `id` = 1;
