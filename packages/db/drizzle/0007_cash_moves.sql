CREATE TABLE "fire"."cash_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"from_account_id" uuid NOT NULL,
	"to_account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"move_date" date NOT NULL,
	"shortfall_date" date NOT NULL,
	"fees_avoided_cents" bigint NOT NULL,
	"fee_per_item_cents" bigint NOT NULL,
	"fee_source" text NOT NULL,
	"basis" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fire"."alert_settings" ADD COLUMN "overdraft_fee_cents" bigint;--> statement-breakpoint
ALTER TABLE "fire"."cash_moves" ADD CONSTRAINT "cash_moves_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."cash_moves" ADD CONSTRAINT "cash_moves_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "fire"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."cash_moves" ADD CONSTRAINT "cash_moves_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "fire"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cash_moves_household_idx" ON "fire"."cash_moves" USING btree ("household_id");--> statement-breakpoint
-- New tables get the same lockdown as every other fire table (see 0001_security).
SELECT fire.lock_down();
