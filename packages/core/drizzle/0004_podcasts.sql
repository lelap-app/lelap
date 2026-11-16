CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`podcast_id` text NOT NULL,
	`guid` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`published_at` integer,
	`season` integer,
	`number` integer,
	`duration_ms` integer NOT NULL,
	`url` text NOT NULL,
	`mime` text,
	`size` integer NOT NULL,
	`book_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_podcast_guid` ON `episodes` (`podcast_id`,`guid`);--> statement-breakpoint
CREATE INDEX `episodes_podcast_published` ON `episodes` (`podcast_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `podcasts` (
	`id` text PRIMARY KEY NOT NULL,
	`feed_url` text NOT NULL,
	`guid` text,
	`title` text NOT NULL,
	`author` text,
	`description` text,
	`cover_url` text,
	`link` text,
	`etag` text,
	`last_modified` text,
	`fetched_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `podcasts_feed_url_unique` ON `podcasts` (`feed_url`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`profile_id` text NOT NULL,
	`podcast_id` text NOT NULL,
	`subscribed_at` integer NOT NULL,
	`auto_download` integer DEFAULT false NOT NULL,
	`keep_latest` integer DEFAULT 3 NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `podcast_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`podcast_id`) REFERENCES `podcasts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `up_next` (
	`profile_id` text NOT NULL,
	`book_id` text NOT NULL,
	`position` real NOT NULL,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `book_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
