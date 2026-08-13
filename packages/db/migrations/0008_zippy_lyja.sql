CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"nowpayments_payment_id" text NOT NULL,
	"telegram_id" bigint NOT NULL,
	"status" text NOT NULL,
	"price_amount" numeric NOT NULL,
	"price_currency" text NOT NULL,
	"pay_currency" text,
	"period_days" integer NOT NULL,
	"raw_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_nowpayments_payment_id_unique" UNIQUE("nowpayments_payment_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'expired' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_claims" (
	"telegram_id" bigint PRIMARY KEY NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_claims" ADD CONSTRAINT "trial_claims_telegram_id_users_telegram_id_fk" FOREIGN KEY ("telegram_id") REFERENCES "public"."users"("telegram_id") ON DELETE no action ON UPDATE no action;