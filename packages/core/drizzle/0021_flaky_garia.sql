CREATE TABLE `place_outbox` (
	`root_id` text NOT NULL,
	`book_id` text NOT NULL,
	`event` text NOT NULL,
	`position_ms` integer NOT NULL,
	`at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	PRIMARY KEY(`root_id`, `book_id`)
);
--> statement-breakpoint
CREATE INDEX `place_outbox_due` ON `place_outbox` (`next_attempt_at`);