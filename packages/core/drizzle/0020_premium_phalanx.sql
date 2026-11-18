CREATE TABLE `hidden_books` (
	`profile_id` text NOT NULL,
	`book_key` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`not_music` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `book_key`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `book_files` ADD `kind_tags` text;