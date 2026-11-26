CREATE TABLE "fire"."alert_settings" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"large_charge_cents" bigint DEFAULT 50000 NOT NULL,
	"low_balance_cents" bigint DEFAULT 50000 NOT NULL,
	"bill_lead_days" integer DEFAULT 5 NOT NULL,
	"mac_notifications" boolean DEFAULT true NOT NULL,
	"weekly_summary" boolean DEFAULT true NOT NULL,
	"last_weekly_summary_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."alert_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"key" text NOT NULL,
	"dismissed_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"category" text NOT NULL,
	"monthly_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fire"."alert_settings" ADD CONSTRAINT "alert_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."alert_state" ADD CONSTRAINT "alert_state_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."budgets" ADD CONSTRAINT "budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_state_household_key_uq" ON "fire"."alert_state" USING btree ("household_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_household_category_uq" ON "fire"."budgets" USING btree ("household_id","category");--> statement-breakpoint
-- New tables get the same lockdown as every other fire table (see 0001_security).
SELECT fire.lock_down();
