CREATE TABLE `book_changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`book_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_changes_book_id_unique` ON `book_changes` (`book_id`);