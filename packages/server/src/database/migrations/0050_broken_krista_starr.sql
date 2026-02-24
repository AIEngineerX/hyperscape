CREATE TABLE IF NOT EXISTS "agent_duel_stats" (
	"characterId" text PRIMARY KEY NOT NULL,
	"agentName" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"draws" integer DEFAULT 0 NOT NULL,
	"totalDamageDealt" integer DEFAULT 0 NOT NULL,
	"totalDamageTaken" integer DEFAULT 0 NOT NULL,
	"killStreak" integer DEFAULT 0 NOT NULL,
	"currentStreak" integer DEFAULT 0 NOT NULL,
	"lastDuelAt" bigint,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arena_fee_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"roundId" text,
	"betId" text,
	"bettorWallet" text NOT NULL,
	"inviterWallet" text,
	"inviteCode" text,
	"chain" text DEFAULT 'SOLANA' NOT NULL,
	"feeBps" integer DEFAULT 0 NOT NULL,
	"totalFeeGold" text DEFAULT '0' NOT NULL,
	"inviterFeeGold" text DEFAULT '0' NOT NULL,
	"treasuryFeeGold" text DEFAULT '0' NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arena_invite_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"inviterWallet" text NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arena_invited_wallets" (
	"id" serial PRIMARY KEY NOT NULL,
	"inviteCode" text NOT NULL,
	"inviterWallet" text NOT NULL,
	"invitedWallet" text NOT NULL,
	"firstBetId" text,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arena_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"roundId" text,
	"betId" text,
	"basePoints" integer DEFAULT 0 NOT NULL,
	"multiplier" integer DEFAULT 0 NOT NULL,
	"totalPoints" integer DEFAULT 0 NOT NULL,
	"goldBalance" text,
	"goldHoldDays" integer DEFAULT 0,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "arena_referral_points" (
	"id" serial PRIMARY KEY NOT NULL,
	"roundId" text,
	"betId" text,
	"inviteCode" text NOT NULL,
	"inviterWallet" text NOT NULL,
	"invitedWallet" text NOT NULL,
	"basePoints" integer DEFAULT 0 NOT NULL,
	"multiplier" integer DEFAULT 0 NOT NULL,
	"totalPoints" integer DEFAULT 0 NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
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
CREATE TABLE IF NOT EXISTS "failed_transactions" (
	"dedupeKey" text PRIMARY KEY NOT NULL,
	"callData" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"queuedAt" bigint NOT NULL,
	"failedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "activePrayers" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "characters" ALTER COLUMN "activePrayers" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "agent_duel_stats" ADD CONSTRAINT "agent_duel_stats_characterId_characters_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_fee_shares" ADD CONSTRAINT "arena_fee_shares_roundId_arena_rounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."arena_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_fee_shares" ADD CONSTRAINT "arena_fee_shares_inviteCode_arena_invite_codes_code_fk" FOREIGN KEY ("inviteCode") REFERENCES "public"."arena_invite_codes"("code") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_invited_wallets" ADD CONSTRAINT "arena_invited_wallets_inviteCode_arena_invite_codes_code_fk" FOREIGN KEY ("inviteCode") REFERENCES "public"."arena_invite_codes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_points" ADD CONSTRAINT "arena_points_roundId_arena_rounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."arena_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_referral_points" ADD CONSTRAINT "arena_referral_points_roundId_arena_rounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."arena_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_referral_points" ADD CONSTRAINT "arena_referral_points_inviteCode_arena_invite_codes_code_fk" FOREIGN KEY ("inviteCode") REFERENCES "public"."arena_invite_codes"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_duel_stats_wins" ON "agent_duel_stats" USING btree ("wins");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_duel_stats_provider" ON "agent_duel_stats" USING btree ("provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_duel_stats_model" ON "agent_duel_stats" USING btree ("model");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_agent_duel_stats_last_duel" ON "agent_duel_stats" USING btree ("lastDuelAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_round" ON "arena_fee_shares" USING btree ("roundId");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_fee_shares_bet" ON "arena_fee_shares" USING btree ("betId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_bettor_wallet" ON "arena_fee_shares" USING btree ("bettorWallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_inviter_wallet" ON "arena_fee_shares" USING btree ("inviterWallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_chain" ON "arena_fee_shares" USING btree ("chain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_invite_code" ON "arena_fee_shares" USING btree ("inviteCode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_created" ON "arena_fee_shares" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_invite_codes_inviter_wallet" ON "arena_invite_codes" USING btree ("inviterWallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_invite_codes_created" ON "arena_invite_codes" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_invited_wallets_invited_wallet" ON "arena_invited_wallets" USING btree ("invitedWallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_invited_wallets_invite_code" ON "arena_invited_wallets" USING btree ("inviteCode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_invited_wallets_inviter_wallet" ON "arena_invited_wallets" USING btree ("inviterWallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_invited_wallets_created" ON "arena_invited_wallets" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_points_wallet" ON "arena_points" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_points_round" ON "arena_points" USING btree ("roundId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_points_created" ON "arena_points" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_points_bet" ON "arena_points" USING btree ("betId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_inviter_wallet" ON "arena_referral_points" USING btree ("inviterWallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_invited_wallet" ON "arena_referral_points" USING btree ("invitedWallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_round" ON "arena_referral_points" USING btree ("roundId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_bet" ON "arena_referral_points" USING btree ("betId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_created" ON "arena_referral_points" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_staking_points_wallet" ON "arena_staking_points" USING btree ("wallet");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_staking_points_period_end" ON "arena_staking_points" USING btree ("periodEndAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_staking_points_wallet_period" ON "arena_staking_points" USING btree ("wallet","periodStartAt","periodEndAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_staking_points_created" ON "arena_staking_points" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_wallet_links_pair_key" ON "arena_wallet_links" USING btree ("pairKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_wallet_a" ON "arena_wallet_links" USING btree ("walletA");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_wallet_b" ON "arena_wallet_links" USING btree ("walletB");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_wallet_a_platform" ON "arena_wallet_links" USING btree ("walletAPlatform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_wallet_b_platform" ON "arena_wallet_links" USING btree ("walletBPlatform");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_wallet_links_created" ON "arena_wallet_links" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_failed_transactions_status" ON "failed_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_failed_transactions_failed_at" ON "failed_transactions" USING btree ("failedAt");