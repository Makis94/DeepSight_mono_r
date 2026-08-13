CREATE TYPE "public"."payment_status" AS ENUM('waiting', 'confirming', 'confirmed', 'sending', 'partially_paid', 'finished', 'failed', 'refunded', 'expired');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'expired', 'canceled');--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DATA TYPE payment_status USING "status"::payment_status;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'waiting';--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DATA TYPE subscription_status USING "status"::subscription_status;--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "status" SET DEFAULT 'expired';