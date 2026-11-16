CREATE TABLE `sync_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tombstones` (
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`profile_id` text DEFAULT '' NOT NULL,
	`deleted_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `key`, `profile_id`)
);
