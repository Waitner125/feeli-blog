ALTER TABLE `blog_posts` ADD `background_mode` text NOT NULL DEFAULT 'global';
--> statement-breakpoint
ALTER TABLE `blog_posts` ADD `background_image_key` text;
--> statement-breakpoint
ALTER TABLE `blog_posts` ADD `background_opacity` integer NOT NULL DEFAULT 72;
--> statement-breakpoint
ALTER TABLE `blog_posts` ADD `background_blur` integer NOT NULL DEFAULT 24;
--> statement-breakpoint
ALTER TABLE `blog_posts` ADD `background_scale` integer NOT NULL DEFAULT 112;
--> statement-breakpoint
ALTER TABLE `blog_posts` ADD `background_position_x` integer NOT NULL DEFAULT 50;
--> statement-breakpoint
ALTER TABLE `blog_posts` ADD `background_position_y` integer NOT NULL DEFAULT 50;
