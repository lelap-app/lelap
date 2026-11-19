ALTER TABLE `episodes` ADD `added_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `seen_at` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `new_since` integer;