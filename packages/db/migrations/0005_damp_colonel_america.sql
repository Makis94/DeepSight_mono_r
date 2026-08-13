CREATE TYPE "public"."tracking_mode" AS ENUM('common', 'precise');--> statement-breakpoint
CREATE TABLE "precise_slot_queue" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"watched_wallet_id" bigint NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "precise_slot_queue_watched_wallet_id_unique" UNIQUE("watched_wallet_id")
);
--> statement-breakpoint
CREATE TABLE "precise_slots" (
	"slot_id" integer PRIMARY KEY NOT NULL,
	"watched_wallet_id" bigint
);
--> statement-breakpoint
CREATE TABLE "wallet_position_state" (
	"address" text NOT NULL,
	"coin" text NOT NULL,
	"signed_size" numeric DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_position_state_address_coin_pk" PRIMARY KEY("address","coin")
);
--> statement-breakpoint
ALTER TABLE "watched_wallets" ADD COLUMN "tracking_mode" "tracking_mode" DEFAULT 'common' NOT NULL;--> statement-breakpoint
ALTER TABLE "precise_slot_queue" ADD CONSTRAINT "precise_slot_queue_watched_wallet_id_watched_wallets_id_fk" FOREIGN KEY ("watched_wallet_id") REFERENCES "public"."watched_wallets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "precise_slots" ADD CONSTRAINT "precise_slots_watched_wallet_id_watched_wallets_id_fk" FOREIGN KEY ("watched_wallet_id") REFERENCES "public"."watched_wallets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "precise_slot_queue_requested_at_idx" ON "precise_slot_queue" USING btree ("requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "precise_slots_watched_wallet_id_unique" ON "precise_slots" USING btree ("watched_wallet_id") WHERE "precise_slots"."watched_wallet_id" is not null;--> statement-breakpoint
-- Seed the fixed capacity pool: 10 empty slots, matching
-- HYPERLIQUID_WS_LIMITS.maxUniqueUsersForUserSubscriptions (packages/hyperliquid-sdk). The
-- row count here IS the platform-wide precise-tracking capacity for this shard.
INSERT INTO "precise_slots" ("slot_id") SELECT generate_series(1, 10);