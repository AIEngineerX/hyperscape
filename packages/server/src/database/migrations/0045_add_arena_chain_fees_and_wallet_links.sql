ALTER TABLE "arena_fee_shares"
  ADD COLUMN IF NOT EXISTS "chain" text DEFAULT 'SOLANA' NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_chain" ON "arena_fee_shares" USING btree ("chain");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "arena_wallet_links" (
  "id" serial PRIMARY KEY NOT NULL,
  "walletA" text NOT NULL,
  "walletAPlatform" text NOT NULL,
  "walletB" text NOT NULL,
  "walletBPlatform" text NOT NULL,
  "pairKey" text NOT NULL,
  "createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
  "updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_wallet_links_pair_key" ON "arena_wallet_links" USING btree ("pairKey");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_wallet_a" ON "arena_wallet_links" USING btree ("walletA");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_wallet_b" ON "arena_wallet_links" USING btree ("walletB");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_wallet_a_platform" ON "arena_wallet_links" USING btree ("walletAPlatform");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_wallet_b_platform" ON "arena_wallet_links" USING btree ("walletBPlatform");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_created" ON "arena_wallet_links" USING btree ("createdAt");
