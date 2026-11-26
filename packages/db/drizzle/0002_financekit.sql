ALTER TYPE "fire"."account_source" ADD VALUE 'financekit';--> statement-breakpoint
CREATE TABLE "fire"."financekit_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"household_id" uuid NOT NULL,
	"pairing_id" text NOT NULL,
	"key_ciphertext" text NOT NULL,
	"key_iv" text NOT NULL,
	"key_version" integer NOT NULL,
	"device_name" text,
	"last_snapshot_at" timestamp with time zone,
	"last_import_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fire"."financekit_devices" ADD CONSTRAINT "financekit_devices_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "fire"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "financekit_devices_household_uq" ON "fire"."financekit_devices" USING btree ("household_id");--> statement-breakpoint
-- New tables get the same lockdown as every other fire table (see 0001_security).
SELECT fire.lock_down();
