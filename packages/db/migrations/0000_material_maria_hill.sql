CREATE TYPE "public"."event_type" AS ENUM('wallet_open_long', 'wallet_open_short', 'wallet_close_position', 'wallet_twap', 'wallet_large_position_change', 'wallet_deposit', 'wallet_withdrawal', 'wallet_funding', 'market_trade');--> statement-breakpoint
CREATE TABLE "users" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"username" text,
	"first_name" text,
	"min_deposit_amount" numeric DEFAULT '0' NOT NULL,
	"min_trade_amount" numeric DEFAULT '0' NOT NULL,
	"notify_deposits" boolean DEFAULT true NOT NULL,
	"notify_withdrawals" boolean DEFAULT true NOT NULL,
	"notify_trades" boolean DEFAULT true NOT NULL,
	"notify_wallet_fills" boolean DEFAULT true NOT NULL,
	"notify_wallet_funding" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watched_wallets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"address" text NOT NULL,
	"label" text,
	"shard_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watched_wallets_user_id_address_unique" UNIQUE("user_id","address")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" "event_type" NOT NULL,
	"wallet_address" text,
	"coin" text,
	"side" text,
	"amount_usd" numeric,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_cursors" (
	"consumer" text PRIMARY KEY NOT NULL,
	"last_event_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coin_registry" (
	"symbol" text PRIMARY KEY NOT NULL,
	"hyperliquid_name" text,
	"cmc_rank" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trader_stats" (
	"wallet_address" text PRIMARY KEY NOT NULL,
	"total_pnl" numeric DEFAULT '0' NOT NULL,
	"win_rate" numeric DEFAULT '0' NOT NULL,
	"volume" numeric DEFAULT '0' NOT NULL,
	"fills_count" integer DEFAULT 0 NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "watched_wallets" ADD CONSTRAINT "watched_wallets_user_id_users_telegram_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("telegram_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watched_wallets_address_idx" ON "watched_wallets" USING btree ("address");--> statement-breakpoint
CREATE INDEX "events_wallet_address_idx" ON "events" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "events_occurred_at_idx" ON "events" USING btree ("occurred_at");