DROP INDEX IF EXISTS "uidx_arena_staking_points_wallet_period";--> statement-breakpoint
ALTER TABLE "arena_staking_points" DROP CONSTRAINT IF EXISTS "uidx_arena_staking_points_wallet_period";--> statement-breakpoint
ALTER TABLE "arena_staking_points" ADD CONSTRAINT "uidx_arena_staking_points_wallet_period" UNIQUE("wallet","periodStartAt","periodEndAt");