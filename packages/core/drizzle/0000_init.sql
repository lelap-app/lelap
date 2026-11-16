CREATE TABLE `book_files` (
	`id` text PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	`root_id` text NOT NULL,
	`book_id` text,
	`idx` integer NOT NULL,
	`uri` text NOT NULL,
	`rel_path` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`modified_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`title` text,
	`album` text,
	`artist` text,
	`album_artist` text,
	`cover_path` text,
	`chapters_json` text NOT NULL,
	`missing_since` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `book_files_location_unique` ON `book_files` (`location`);--> statement-breakpoint
CREATE INDEX `book_files_book_idx` ON `book_files` (`book_id`,`idx`);--> statement-breakpoint
CREATE TABLE `bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`book_id` text NOT NULL,
	`file_location` text NOT NULL,
	`file_position_ms` integer NOT NULL,
	`book_position_ms` integer NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmarks_book_idx` ON `bookmarks` (`profile_id`,`book_id`);--> statement-breakpoint
CREATE TABLE `books` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text NOT NULL,
	`location` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`cover_path` text,
	`duration_ms` integer NOT NULL,
	`missing_since` integer,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_location_unique` ON `books` (`location`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` text NOT NULL,
	`idx` integer NOT NULL,
	`title` text NOT NULL,
	`start_ms` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chapters_book_idx` ON `chapters` (`book_id`,`idx`);--> statement-breakpoint
CREATE TABLE `library_entries` (
	`profile_id` text NOT NULL,
	`book_id` text NOT NULL,
	`speed` real DEFAULT 1 NOT NULL,
	`last_played_at` integer,
	`finished_at` integer,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `book_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `library_roots` (
	`id` text PRIMARY KEY NOT NULL,
	`uri` text NOT NULL,
	`name` text NOT NULL,
	`location` text NOT NULL,
	`added_at` integer NOT NULL,
	`last_scan_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `progress` (
	`profile_id` text NOT NULL,
	`book_id` text NOT NULL,
	`file_location` text NOT NULL,
	`file_position_ms` integer NOT NULL,
	`book_position_ms` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `book_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`profile_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `key`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
