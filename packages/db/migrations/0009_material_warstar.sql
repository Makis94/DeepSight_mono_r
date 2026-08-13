ALTER TABLE "payments" ALTER COLUMN "nowpayments_payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "status" SET DEFAULT 'waiting';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "order_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "nowpayments_invoice_id" text;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_unique" UNIQUE("order_id");