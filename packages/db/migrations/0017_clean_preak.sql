CREATE TYPE "public"."trading_link_status" AS ENUM('pending', 'linked', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."trading_mode" AS ENUM('paper', 'live');--> statement-breakpoint
CREATE TYPE "public"."trust_score_event_type" AS ENUM('fully_executed', 'cancelled_before_execution', 'cancelled_mid_execution');--> statement-breakpoint
CREATE TYPE "public"."trigger_decision" AS ENUM('opened', 'skipped', 'reduced');--> statement-breakpoint
CREATE TYPE "public"."auto_trade_status" AS ENUM('open', 'closed_tp', 'closed_sl', 'closed_manual', 'error');--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"telegram_id" bigint NOT NULL,
	"exchange" text DEFAULT 'hyperliquid' NOT NULL,
	"wallet_address" text NOT NULL,
	"agent_address" text NOT NULL,
	"agent_private_key_encrypted" text NOT NULL,
	"link_status" "trading_link_status" DEFAULT 'pending' NOT NULL,
	"agent_expires_at" timestamp with time zone,
	"trading_enabled" boolean DEFAULT false NOT NULL,
	"mode" "trading_mode" DEFAULT 'paper' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_accounts_telegram_id_exchange_unique" UNIQUE("telegram_id","exchange")
);
--> statement-breakpoint
CREATE TABLE "trust_scores" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"exchange" text DEFAULT 'hyperliquid' NOT NULL,
	"wallet_address" text NOT NULL,
	"score" numeric DEFAULT '0' NOT NULL,
	"total_signals" integer DEFAULT 0 NOT NULL,
	"fully_executed_count" integer DEFAULT 0 NOT NULL,
	"cancelled_count" integer DEFAULT 0 NOT NULL,
	"last_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_scores_exchange_wallet_address_unique" UNIQUE("exchange","wallet_address")
);
--> statement-breakpoint
CREATE TABLE "trust_score_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"exchange" text DEFAULT 'hyperliquid' NOT NULL,
	"wallet_address" text NOT NULL,
	"external_twap_id" text NOT NULL,
	"event_type" "trust_score_event_type" NOT NULL,
	"coin" text NOT NULL,
	"notional_usd" numeric NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_score_events_exchange_external_twap_id_event_type_unique" UNIQUE("exchange","external_twap_id","event_type")
);
--> statement-breakpoint
CREATE TABLE "trigger_evaluations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"exchange" text DEFAULT 'hyperliquid' NOT NULL,
	"external_twap_id" text NOT NULL,
	"wallet_address" text NOT NULL,
	"coin" text NOT NULL,
	"tier" text NOT NULL,
	"side" text NOT NULL,
	"trigger_notional_usd" numeric NOT NULL,
	"threshold_usd" numeric NOT NULL,
	"trust_score_at_eval" numeric NOT NULL,
	"counter_flow_net_usd" numeric NOT NULL,
	"decision" "trigger_decision" NOT NULL,
	"detail" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_trades" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trading_account_id" bigint NOT NULL,
	"trigger_evaluation_id" bigint,
	"exchange" text DEFAULT 'hyperliquid' NOT NULL,
	"external_twap_id" text NOT NULL,
	"trigger_wallet_address" text NOT NULL,
	"coin" text NOT NULL,
	"side" text NOT NULL,
	"size_usd" numeric NOT NULL,
	"trust_score_at_entry" numeric NOT NULL,
	"entry_px" numeric,
	"stop_loss_px" numeric NOT NULL,
	"take_profit_px" numeric NOT NULL,
	"external_order_id" text,
	"external_stop_loss_order_id" text,
	"external_take_profit_order_id" text,
	"status" "auto_trade_status" DEFAULT 'open' NOT NULL,
	"realized_pnl_usd" numeric,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "risk_limits" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"trading_account_id" bigint NOT NULL,
	"max_position_usd" numeric NOT NULL,
	"max_daily_loss_usd" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risk_limits_trading_account_id_unique" UNIQUE("trading_account_id")
);
--> statement-breakpoint
CREATE TABLE "auto_trader_global_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"kill_switch_active" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_trades" ADD CONSTRAINT "auto_trades_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_limits" ADD CONSTRAINT "risk_limits_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trust_score_events_wallet_idx" ON "trust_score_events" USING btree ("exchange","wallet_address");--> statement-breakpoint
CREATE INDEX "auto_trades_account_idx" ON "auto_trades" USING btree ("trading_account_id");--> statement-breakpoint
CREATE INDEX "auto_trades_status_idx" ON "auto_trades" USING btree ("status");