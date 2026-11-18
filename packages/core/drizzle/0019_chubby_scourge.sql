CREATE TABLE `addon_settings` (
	`url` text PRIMARY KEY NOT NULL,
	`settings` text NOT NULL,
	`secret` text NOT NULL,
	`code_sha` text,
	`updated_at` integer NOT NULL
);
