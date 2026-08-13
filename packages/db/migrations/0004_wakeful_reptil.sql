ALTER TYPE "public"."event_type" ADD VALUE 'market_twap_suspected';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "min_twap_amount" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "notify_twaps" boolean DEFAULT true NOT NULL;