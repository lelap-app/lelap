CREATE TABLE `series_lists` (
	`key` text NOT NULL,
	`language` text NOT NULL,
	`list` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`key`, `language`)
);
