ALTER TABLE `profiles` ADD `avatar` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `pin_hash` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `kids` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `hidden_addons` text DEFAULT '[]' NOT NULL;