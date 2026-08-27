-- The old market-wide TWAP detector (pattern-match over public trades + REST confirmation,
-- see apps/worker/src/market-watcher/twap-heuristic.ts, now removed) is replaced by a direct
-- feed from QuickNode's HyperCore TWAP dataset (marketTwapPayloadSchema). Its rows have a
-- different, incompatible payload shape (no address/size/minutes/reduceOnly/randomize/status)
-- that cannot be reshaped into the new schema, so they're dropped rather than migrated.
DELETE FROM "public"."events" WHERE "type" = 'market_twap_suspected';--> statement-breakpoint
ALTER TABLE "public"."events" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."event_type";--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('wallet_open_long', 'wallet_open_short', 'wallet_close_position', 'wallet_twap', 'wallet_twap_slice_fill', 'wallet_large_position_change', 'wallet_deposit', 'wallet_withdrawal', 'wallet_funding', 'market_trade', 'market_twap', 'global_deposit');--> statement-breakpoint
ALTER TABLE "public"."events" ALTER COLUMN "type" SET DATA TYPE "public"."event_type" USING "type"::"public"."event_type";