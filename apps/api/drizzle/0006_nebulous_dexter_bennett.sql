CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_id` text NOT NULL,
	`addressee_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`addressee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friendships_pair_uq` ON `friendships` (`requester_id`,`addressee_id`);--> statement-breakpoint
CREATE INDEX `friendships_requester_idx` ON `friendships` (`requester_id`);--> statement-breakpoint
CREATE INDEX `friendships_addressee_idx` ON `friendships` (`addressee_id`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_key` text NOT NULL,
	`sender_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_key`,`created_at`);--> statement-breakpoint
CREATE INDEX `messages_recipient_idx` ON `messages` (`recipient_id`);