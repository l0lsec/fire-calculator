CREATE TABLE "fire"."scheduled_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"cadence" text NOT NULL,
	"next_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fire"."scheduled_bills" ADD CONSTRAINT "scheduled_bills_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."scheduled_bills" ADD CONSTRAINT "scheduled_bills_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "fire"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_bills_household_idx" ON "fire"."scheduled_bills" USING btree ("household_id");--> statement-breakpoint
-- New tables get the same lockdown as every other fire table (see 0001_security).
SELECT fire.lock_down();
