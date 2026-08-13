ALTER TABLE "users" ADD COLUMN "exclude_btc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "exclude_eth" boolean DEFAULT false NOT NULL;