CREATE TABLE `playback_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`book_id` text NOT NULL,
	`action` text NOT NULL,
	`source` text NOT NULL,
	`at` integer NOT NULL,
	`from_ms` integer NOT NULL,
	`to_ms` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `playback_history_book_idx` ON `playback_history` (`profile_id`,`book_id`,`at`);