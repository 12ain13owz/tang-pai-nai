-- #6.2 dropped the dev-only sync_probes table (0008). Its losing versions in change_history would
-- still reach devices as conflict notices for a table they no longer know, so they go too.
DELETE FROM `change_history` WHERE `table` = 'sync_probes';
