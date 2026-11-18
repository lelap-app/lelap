CREATE TABLE `stream_headers` (
	`book_id` text PRIMARY KEY NOT NULL,
	`addon_url` text NOT NULL,
	`headers` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
