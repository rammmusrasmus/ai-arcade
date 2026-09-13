CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text DEFAULT 'login' NOT NULL,
	`token_hash` text NOT NULL,
	`code_hash` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`resends` integer DEFAULT 0 NOT NULL,
	`max_resends` integer DEFAULT 3 NOT NULL,
	`last_sent_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_challenges_token_uq` ON `auth_challenges` (`token_hash`);--> statement-breakpoint
CREATE INDEX `auth_challenges_user_idx` ON `auth_challenges` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `email_verified_at` integer;