-- Product change: at most one watched wallet per user (tracking a new address replaces the
-- old one). Existing users may have accumulated several rows under the old multi-wallet
-- behavior — keep only the most recently added one per user before the unique constraint
-- makes that state impossible.
DELETE FROM "watched_wallets" a USING "watched_wallets" b
  WHERE a.user_id = b.user_id AND a.id < b.id;
--> statement-breakpoint
ALTER TABLE "watched_wallets" DROP CONSTRAINT "watched_wallets_user_id_address_unique";--> statement-breakpoint
ALTER TABLE "watched_wallets" ADD CONSTRAINT "watched_wallets_user_id_unique" UNIQUE("user_id");