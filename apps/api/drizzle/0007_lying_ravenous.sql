ALTER TABLE `password_resets` ADD `code_hash` text;--> statement-breakpoint
ALTER TABLE `password_resets` ADD `attempts` integer DEFAULT 0 NOT NULL;