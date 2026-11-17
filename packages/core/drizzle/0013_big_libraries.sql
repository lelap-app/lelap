CREATE INDEX `books_root_idx` ON `books` (`root_id`);--> statement-breakpoint
CREATE INDEX `episodes_book_idx` ON `episodes` (`book_id`);--> statement-breakpoint
CREATE INDEX `library_entries_played_idx` ON `library_entries` (`profile_id`,`last_played_at`);