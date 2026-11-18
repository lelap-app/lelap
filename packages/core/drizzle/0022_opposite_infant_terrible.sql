ALTER TABLE `library_entries` ADD `voice_eq` integer;--> statement-breakpoint
ALTER TABLE `library_entries` ADD `skip_silence` integer;--> statement-breakpoint
ALTER TABLE `library_entries` ADD `even_loudness` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `voice_eq` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `skip_silence` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `even_loudness` integer;