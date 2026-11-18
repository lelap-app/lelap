CREATE TABLE `work_links` (
	`book_key` text NOT NULL,
	`work_type` text NOT NULL,
	`work_id` text NOT NULL,
	`state` text NOT NULL,
	`ids` text NOT NULL,
	`meta` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`book_key`, `work_type`, `work_id`)
);
--> statement-breakpoint
CREATE INDEX `work_links_work_idx` ON `work_links` (`work_type`,`work_id`);--> statement-breakpoint
CREATE INDEX `work_links_state_idx` ON `work_links` (`state`);--> statement-breakpoint
ALTER TABLE `book_files` ADD `ids` text;