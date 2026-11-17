CREATE TABLE `local_addon_code` (
	`url` text PRIMARY KEY NOT NULL,
	`source_url` text NOT NULL,
	`code` text NOT NULL,
	`sha256` text NOT NULL,
	`updated_at` integer NOT NULL
);
