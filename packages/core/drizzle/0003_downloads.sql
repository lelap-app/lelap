CREATE TABLE `downloads` (
	`book_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`bytes_total` integer NOT NULL,
	`error` text,
	`meta` text,
	`requested_at` integer NOT NULL,
	`completed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `book_files` ADD `download_path` text;