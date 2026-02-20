CREATE TABLE IF NOT EXISTS "arena_points" (
  "id" serial PRIMARY KEY NOT NULL,
  "wallet" text NOT NULL,
  "roundId" text,
  "betId" text,
  "basePoints" integer DEFAULT 0 NOT NULL,
  "multiplier" integer DEFAULT 1 NOT NULL,
  "totalPoints" integer DEFAULT 0 NOT NULL,
  "goldBalance" text,
  "goldHoldDays" integer DEFAULT 0,
  "createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'arena_points_roundId_arena_rounds_id_fk'
  ) THEN
    ALTER TABLE "arena_points"
      ADD CONSTRAINT "arena_points_roundId_arena_rounds_id_fk"
      FOREIGN KEY ("roundId")
      REFERENCES "public"."arena_rounds"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_points_wallet" ON "arena_points" USING btree ("wallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_points_round" ON "arena_points" USING btree ("roundId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_points_created" ON "arena_points" USING btree ("createdAt");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "arena_invite_codes" (
  "code" text PRIMARY KEY NOT NULL,
  "inviterWallet" text NOT NULL,
  "createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
  "updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_invite_codes_inviter_wallet" ON "arena_invite_codes" USING btree ("inviterWallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_invite_codes_created" ON "arena_invite_codes" USING btree ("createdAt");
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
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'arena_invited_wallets_inviteCode_arena_invite_codes_code_fk'
  ) THEN
    ALTER TABLE "arena_invited_wallets"
      ADD CONSTRAINT "arena_invited_wallets_inviteCode_arena_invite_codes_code_fk"
      FOREIGN KEY ("inviteCode")
      REFERENCES "public"."arena_invite_codes"("code")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_invited_wallets_invited_wallet" ON "arena_invited_wallets" USING btree ("invitedWallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_invited_wallets_invite_code" ON "arena_invited_wallets" USING btree ("inviteCode");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_invited_wallets_inviter_wallet" ON "arena_invited_wallets" USING btree ("inviterWallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_invited_wallets_created" ON "arena_invited_wallets" USING btree ("createdAt");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "arena_referral_points" (
  "id" serial PRIMARY KEY NOT NULL,
  "roundId" text,
  "betId" text,
  "inviteCode" text NOT NULL,
  "inviterWallet" text NOT NULL,
  "invitedWallet" text NOT NULL,
  "basePoints" integer DEFAULT 0 NOT NULL,
  "multiplier" integer DEFAULT 1 NOT NULL,
  "totalPoints" integer DEFAULT 0 NOT NULL,
  "createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'arena_referral_points_roundId_arena_rounds_id_fk'
  ) THEN
    ALTER TABLE "arena_referral_points"
      ADD CONSTRAINT "arena_referral_points_roundId_arena_rounds_id_fk"
      FOREIGN KEY ("roundId")
      REFERENCES "public"."arena_rounds"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'arena_referral_points_inviteCode_arena_invite_codes_code_fk'
  ) THEN
    ALTER TABLE "arena_referral_points"
      ADD CONSTRAINT "arena_referral_points_inviteCode_arena_invite_codes_code_fk"
      FOREIGN KEY ("inviteCode")
      REFERENCES "public"."arena_invite_codes"("code")
      ON DELETE restrict
      ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_inviter_wallet" ON "arena_referral_points" USING btree ("inviterWallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_invited_wallet" ON "arena_referral_points" USING btree ("invitedWallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_round" ON "arena_referral_points" USING btree ("roundId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_bet" ON "arena_referral_points" USING btree ("betId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_referral_points_created" ON "arena_referral_points" USING btree ("createdAt");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "arena_fee_shares" (
  "id" serial PRIMARY KEY NOT NULL,
  "roundId" text,
  "betId" text,
  "bettorWallet" text NOT NULL,
  "inviterWallet" text,
  "inviteCode" text,
  "feeBps" integer DEFAULT 0 NOT NULL,
  "totalFeeGold" text DEFAULT '0' NOT NULL,
  "inviterFeeGold" text DEFAULT '0' NOT NULL,
  "treasuryFeeGold" text DEFAULT '0' NOT NULL,
  "createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'arena_fee_shares_roundId_arena_rounds_id_fk'
  ) THEN
    ALTER TABLE "arena_fee_shares"
      ADD CONSTRAINT "arena_fee_shares_roundId_arena_rounds_id_fk"
      FOREIGN KEY ("roundId")
      REFERENCES "public"."arena_rounds"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'arena_fee_shares_inviteCode_arena_invite_codes_code_fk'
  ) THEN
    ALTER TABLE "arena_fee_shares"
      ADD CONSTRAINT "arena_fee_shares_inviteCode_arena_invite_codes_code_fk"
      FOREIGN KEY ("inviteCode")
      REFERENCES "public"."arena_invite_codes"("code")
      ON DELETE set null
      ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_round" ON "arena_fee_shares" USING btree ("roundId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_bet" ON "arena_fee_shares" USING btree ("betId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_bettor_wallet" ON "arena_fee_shares" USING btree ("bettorWallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_inviter_wallet" ON "arena_fee_shares" USING btree ("inviterWallet");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_invite_code" ON "arena_fee_shares" USING btree ("inviteCode");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_arena_fee_shares_created" ON "arena_fee_shares" USING btree ("createdAt");
