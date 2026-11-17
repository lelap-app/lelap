CREATE TABLE `listening_log` (
	`profile_id` text NOT NULL,
	`day` text NOT NULL,
	`book_id` text NOT NULL,
	`title` text NOT NULL,
	`ms` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `day`, `book_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE no action
);
