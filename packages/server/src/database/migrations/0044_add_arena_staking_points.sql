ALTER TABLE "arena_points"
  ALTER COLUMN "multiplier" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "arena_referral_points"
  ALTER COLUMN "multiplier" SET DEFAULT 0;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "arena_staking_points" (
  "id" serial PRIMARY KEY NOT NULL,
  "wallet" text NOT NULL,
  "basePoints" integer DEFAULT 0 NOT NULL,
  "multiplier" integer DEFAULT 0 NOT NULL,
  "totalPoints" integer DEFAULT 0 NOT NULL,
  "daysAccrued" integer DEFAULT 0 NOT NULL,
  "liquidGoldBalance" text DEFAULT '0' NOT NULL,
  "stakedGoldBalance" text DEFAULT '0' NOT NULL,
  "goldBalance" text DEFAULT '0' NOT NULL,
  "goldHoldDays" integer DEFAULT 0 NOT NULL,
  "periodStartAt" bigint NOT NULL,
  "periodEndAt" bigint NOT NULL,
  "source" text DEFAULT 'INDEXER' NOT NULL,
  "createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_staking_points_wallet" ON "arena_staking_points" USING btree ("wallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_staking_points_period_end" ON "arena_staking_points" USING btree ("periodEndAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_staking_points_created" ON "arena_staking_points" USING btree ("createdAt");
