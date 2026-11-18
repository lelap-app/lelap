CREATE TABLE `own_chapters` (
	`profile_id` text NOT NULL,
	`book_key` text NOT NULL,
	`chapters` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `book_key`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
