-- Add CHECK constraints for economic integrity
-- Prevents negative coins, invalid quantities, and negative health at DB level
-- NOT VALID skips checking existing rows so the migration won't fail on legacy data;
-- run ALTER TABLE ... VALIDATE CONSTRAINT afterwards during a maintenance window.
ALTER TABLE "characters" ADD CONSTRAINT "characters_coins_non_negative" CHECK ("coins" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_health_non_negative" CHECK ("health" >= 0) NOT VALID;
--> statement-breakpoint
-- Inventory uses > 0: items are removed when consumed, never stored with quantity 0.
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_quantity_positive" CHECK ("quantity" > 0) NOT VALID;
--> statement-breakpoint
-- Bank uses >= 0: empty slots are kept as placeholders to preserve slot positions.
ALTER TABLE "bank_storage" ADD CONSTRAINT "bank_storage_quantity_non_negative" CHECK ("quantity" >= 0) NOT VALID;
--> statement-breakpoint
-- Add FK from characters.accountId to users.id (was missing)
-- NOT VALID: skip validation of existing rows so orphaned data won't block the migration.
ALTER TABLE "characters" ADD CONSTRAINT "characters_accountId_users_id_fk" FOREIGN KEY ("accountId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action NOT VALID;
--> statement-breakpoint
-- Add index on characters.name for name lookups
CREATE INDEX IF NOT EXISTS "idx_characters_name" ON "characters" USING btree ("name");
