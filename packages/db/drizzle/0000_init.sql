CREATE SCHEMA "fire";
--> statement-breakpoint
CREATE TYPE "fire"."account_source" AS ENUM('plaid', 'manual');--> statement-breakpoint
CREATE TYPE "fire"."apr_source" AS ENUM('plaid', 'user', 'unknown');--> statement-breakpoint
CREATE TYPE "fire"."bucket" AS ENUM('cash', 'taxable', 'traditional', 'roth', 'hsa', 'excluded');--> statement-breakpoint
CREATE TYPE "fire"."debt_kind" AS ENUM('credit_card', 'student', 'mortgage', 'auto', 'personal', 'heloc', 'medical', 'other');--> statement-breakpoint
CREATE TYPE "fire"."item_status" AS ENUM('healthy', 'login_required', 'pending_disconnect', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "fire"."tx_class" AS ENUM('living_expense', 'income', 'transfer', 'debt_payment', 'investment_contribution', 'refund', 'ignore');--> statement-breakpoint
CREATE TABLE "fire"."accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"source" "fire"."account_source" NOT NULL,
	"item_id" uuid,
	"plaid_account_id" text,
	"name" text NOT NULL,
	"official_name" text,
	"mask" text,
	"type" text NOT NULL,
	"subtype" text,
	"bucket" "fire"."bucket" NOT NULL,
	"bucket_overridden" boolean DEFAULT false NOT NULL,
	"include_in_fi" boolean DEFAULT true NOT NULL,
	"current_cents" bigint DEFAULT 0 NOT NULL,
	"available_cents" bigint,
	"cost_basis_cents" bigint,
	"roth_basis_cents" bigint,
	"iso_currency" text DEFAULT 'USD' NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."audit_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"rows_deleted" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."balance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"current_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"pfc_detailed" text NOT NULL,
	"class" "fire"."tx_class" NOT NULL,
	"essential" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."contribution_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"bucket" "fire"."bucket" NOT NULL,
	"monthly_cents" bigint NOT NULL,
	"growth" text DEFAULT 'raise' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid,
	"name" text NOT NULL,
	"kind" "fire"."debt_kind" NOT NULL,
	"balance_cents" bigint NOT NULL,
	"apr" double precision,
	"apr_source" "fire"."apr_source" DEFAULT 'user' NOT NULL,
	"min_payment_rule" jsonb NOT NULL,
	"promo_apr" double precision,
	"promo_ends_month" integer,
	"maturity_date" date,
	"escrow_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"security_id" text NOT NULL,
	"ticker" text,
	"name" text,
	"security_type" text,
	"quantity" double precision NOT NULL,
	"value_cents" bigint NOT NULL,
	"cost_basis_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."household_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."households" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."income_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"monthly_cents" bigint NOT NULL,
	"growth" text DEFAULT 'inflation' NOT NULL,
	"phase" text NOT NULL,
	"start_age" double precision,
	"end_age" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"birth_month" integer NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"plaid_item_id" text NOT NULL,
	"institution_id" text,
	"institution_name" text,
	"access_token_ciphertext" text NOT NULL,
	"access_token_iv" text NOT NULL,
	"key_version" integer NOT NULL,
	"transactions_cursor" text,
	"status" "fire"."item_status" DEFAULT 'healthy' NOT NULL,
	"error_code" text,
	"consent_expires_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_baseline" boolean DEFAULT false NOT NULL,
	"assumptions" jsonb NOT NULL,
	"debt_plan" jsonb NOT NULL,
	"policy" text DEFAULT 'payoffAtFI' NOT NULL,
	"retirement_adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"extra_income" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"spending_override_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."spending_profiles" (
	"household_id" uuid PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"manual_annual_cents" bigint DEFAULT 0 NOT NULL,
	"manual_essential_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."sync_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid,
	"item_id" uuid,
	"kind" text NOT NULL,
	"payload_hash" text,
	"status" text NOT NULL,
	"error_code" text,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."transaction_overrides" (
	"transaction_id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"class" "fire"."tx_class",
	"essential" boolean,
	"one_time" boolean DEFAULT false NOT NULL,
	"amortize_years" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fire"."transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"plaid_transaction_id" text NOT NULL,
	"posted_date" date NOT NULL,
	"authorized_date" date,
	"amount_cents" bigint NOT NULL,
	"name" text NOT NULL,
	"merchant" text,
	"pfc_primary" text,
	"pfc_detailed" text,
	"pending" boolean DEFAULT false NOT NULL,
	"transfer_pair_id" uuid,
	"iso_currency" text DEFAULT 'USD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fire"."accounts" ADD CONSTRAINT "accounts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."accounts" ADD CONSTRAINT "accounts_item_id_plaid_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "fire"."plaid_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."balance_snapshots" ADD CONSTRAINT "balance_snapshots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."balance_snapshots" ADD CONSTRAINT "balance_snapshots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "fire"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."category_rules" ADD CONSTRAINT "category_rules_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."contribution_streams" ADD CONSTRAINT "contribution_streams_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."debts" ADD CONSTRAINT "debts_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."debts" ADD CONSTRAINT "debts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "fire"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."holdings" ADD CONSTRAINT "holdings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."holdings" ADD CONSTRAINT "holdings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "fire"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."income_streams" ADD CONSTRAINT "income_streams_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."income_streams" ADD CONSTRAINT "income_streams_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "fire"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."people" ADD CONSTRAINT "people_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."plaid_items" ADD CONSTRAINT "plaid_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."scenarios" ADD CONSTRAINT "scenarios_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."spending_profiles" ADD CONSTRAINT "spending_profiles_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."sync_events" ADD CONSTRAINT "sync_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."sync_events" ADD CONSTRAINT "sync_events_item_id_plaid_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "fire"."plaid_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."transaction_overrides" ADD CONSTRAINT "transaction_overrides_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "fire"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."transaction_overrides" ADD CONSTRAINT "transaction_overrides_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."transactions" ADD CONSTRAINT "transactions_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fire"."transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "fire"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_plaid_account_uq" ON "fire"."accounts" USING btree ("plaid_account_id");--> statement-breakpoint
CREATE INDEX "accounts_household_idx" ON "fire"."accounts" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "balance_snapshots_account_day_uq" ON "fire"."balance_snapshots" USING btree ("account_id","as_of_date");--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_household_cat_uq" ON "fire"."category_rules" USING btree ("household_id","pfc_detailed");--> statement-breakpoint
CREATE INDEX "contribution_streams_household_idx" ON "fire"."contribution_streams" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "debts_account_uq" ON "fire"."debts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "debts_household_idx" ON "fire"."debts" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_account_security_uq" ON "fire"."holdings" USING btree ("account_id","security_id");--> statement-breakpoint
CREATE UNIQUE INDEX "household_members_user_uq" ON "fire"."household_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "income_streams_household_idx" ON "fire"."income_streams" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "people_household_idx" ON "fire"."people" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "plaid_items_item_uq" ON "fire"."plaid_items" USING btree ("plaid_item_id");--> statement-breakpoint
CREATE INDEX "plaid_items_household_idx" ON "fire"."plaid_items" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "scenarios_household_idx" ON "fire"."scenarios" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_events_payload_uq" ON "fire"."sync_events" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "sync_events_item_idx" ON "fire"."sync_events" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_plaid_uq" ON "fire"."transactions" USING btree ("plaid_transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_household_date_idx" ON "fire"."transactions" USING btree ("household_id","posted_date");