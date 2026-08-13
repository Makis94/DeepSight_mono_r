CREATE TABLE "coin_prices" (
	"symbol" text PRIMARY KEY NOT NULL,
	"mid_price" numeric NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
