CREATE TABLE `ingredients` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`unit_of_measurement` text,
	`base_value` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ingredients_title_unique` ON `ingredients` (`title`);