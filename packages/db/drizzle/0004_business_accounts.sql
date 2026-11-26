ALTER TABLE "fire"."accounts" ADD COLUMN "business" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Re-apply the lockdown so the new column is covered like every other fire column (see 0001_security).
SELECT fire.lock_down();
