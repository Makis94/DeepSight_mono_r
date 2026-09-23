ALTER TABLE "trust_scores" ADD COLUMN "confidence" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD COLUMN "effective_score" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "trust_scores" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;