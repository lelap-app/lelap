CREATE TABLE `addons` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`manifest` text NOT NULL,
	`position` integer NOT NULL,
	`builtin` integer DEFAULT false NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `addons_url_unique` ON `addons` (`url`);--> statement-breakpoint
CREATE TABLE `removed_addons` (
	`url` text PRIMARY KEY NOT NULL,
	`removed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_book_files` (
	`id` text PRIMARY KEY NOT NULL,
	`location` text NOT NULL,
	`root_id` text,
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
INSERT INTO `__new_book_files`("id", "location", "root_id", "book_id", "idx", "uri", "rel_path", "name", "size", "modified_at", "duration_ms", "title", "album", "artist", "album_artist", "cover_path", "chapters_json", "missing_since", "updated_at") SELECT "id", "location", "root_id", "book_id", "idx", "uri", "rel_path", "name", "size", "modified_at", "duration_ms", "title", "album", "artist", "album_artist", "cover_path", "chapters_json", "missing_since", "updated_at" FROM `book_files`;--> statement-breakpoint
DROP TABLE `book_files`;--> statement-breakpoint
ALTER TABLE `__new_book_files` RENAME TO `book_files`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `book_files_location_unique` ON `book_files` (`location`);--> statement-breakpoint
CREATE INDEX `book_files_book_idx` ON `book_files` (`book_id`,`idx`);--> statement-breakpoint
CREATE TABLE `__new_books` (
	`id` text PRIMARY KEY NOT NULL,
	`root_id` text,
	`location` text NOT NULL,
	`kind` text NOT NULL,
	`source` text DEFAULT 'local' NOT NULL,
	`title` text NOT NULL,
	`author` text,
	`cover_path` text,
	`cover_url` text,
	`addon_item` text,
	`duration_ms` integer NOT NULL,
	`missing_since` integer,
	`added_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`root_id`) REFERENCES `library_roots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_books`("id", "root_id", "location", "kind", "title", "author", "cover_path", "duration_ms", "missing_since", "added_at", "updated_at") SELECT "id", "root_id", "location", "kind", "title", "author", "cover_path", "duration_ms", "missing_since", "added_at", "updated_at" FROM `books`;--> statement-breakpoint
DROP TABLE `books`;--> statement-breakpoint
ALTER TABLE `__new_books` RENAME TO `books`;--> statement-breakpoint
CREATE UNIQUE INDEX `books_location_unique` ON `books` (`location`);