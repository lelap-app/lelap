ALTER TABLE `chapters` ADD `found` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `skip_intro_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `skip_outro_ms` integer DEFAULT 0 NOT NULL;