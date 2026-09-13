ALTER TABLE `users` ADD `display_name_normalized` text;--> statement-breakpoint
UPDATE `users` SET `display_name_normalized` = lower(trim(display_name)) WHERE `display_name_normalized` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_display_name_uq` ON `users` (`display_name_normalized`);