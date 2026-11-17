CREATE TABLE `scrobble_outbox` (
	`event_id` text NOT NULL,
	`addon_url` text NOT NULL,
	`profile_id` text NOT NULL,
	`event` text NOT NULL,
	`at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	PRIMARY KEY(`event_id`, `addon_url`)
);
--> statement-breakpoint
CREATE INDEX `scrobble_outbox_due` ON `scrobble_outbox` (`next_attempt_at`);