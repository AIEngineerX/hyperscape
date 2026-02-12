CREATE TABLE IF NOT EXISTS "anti_cheat_violations" (
	"id" serial PRIMARY KEY NOT NULL,
	"playerId" text NOT NULL,
	"violationType" text NOT NULL,
	"severity" text NOT NULL,
	"details" text NOT NULL,
	"targetId" text,
	"gameTick" integer,
	"score" integer DEFAULT 0 NOT NULL,
	"actionTaken" text,
	"timestamp" bigint NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'anti_cheat_violations_playerId_characters_id_fk'
	) THEN
		ALTER TABLE "anti_cheat_violations"
		ADD CONSTRAINT "anti_cheat_violations_playerId_characters_id_fk"
		FOREIGN KEY ("playerId")
		REFERENCES "public"."characters"("id")
		ON DELETE cascade
		ON UPDATE no action;
	END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anti_cheat_violations_player" ON "anti_cheat_violations" USING btree ("playerId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anti_cheat_violations_timestamp" ON "anti_cheat_violations" USING btree ("timestamp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anti_cheat_violations_severity" ON "anti_cheat_violations" USING btree ("severity");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_anti_cheat_violations_player_timestamp" ON "anti_cheat_violations" USING btree ("playerId","timestamp");
--> statement-breakpoint
CREATE TABLE "arena_agent_whitelist" (
	"characterId" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"minPowerScore" integer DEFAULT 0 NOT NULL,
	"maxPowerScore" integer DEFAULT 10000 NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"cooldownUntil" bigint,
	"notes" text,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_round_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"roundId" text NOT NULL,
	"eventType" text NOT NULL,
	"payload" jsonb NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE "arena_rounds" (
	"id" text PRIMARY KEY NOT NULL,
	"phase" text NOT NULL,
	"agentAId" text NOT NULL,
	"agentBId" text NOT NULL,
	"previewAgentAId" text,
	"previewAgentBId" text,
	"duelId" text,
	"scheduledAt" bigint NOT NULL,
	"bettingOpensAt" bigint NOT NULL,
	"bettingClosesAt" bigint NOT NULL,
	"duelStartsAt" bigint,
	"duelEndsAt" bigint,
	"winnerId" text,
	"winReason" text,
	"damageA" integer DEFAULT 0 NOT NULL,
	"damageB" integer DEFAULT 0 NOT NULL,
	"metadataUri" text,
	"resultHash" text,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solana_bets" (
	"id" text PRIMARY KEY NOT NULL,
	"roundId" text NOT NULL,
	"bettorWallet" text NOT NULL,
	"side" text NOT NULL,
	"sourceAsset" text NOT NULL,
	"sourceAmount" text NOT NULL,
	"goldAmount" text NOT NULL,
	"quoteJson" jsonb,
	"txSignature" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solana_markets" (
	"roundId" text PRIMARY KEY NOT NULL,
	"marketPda" text NOT NULL,
	"oraclePda" text NOT NULL,
	"mint" text NOT NULL,
	"vault" text,
	"feeVault" text,
	"closeSlot" bigint,
	"resolvedSlot" bigint,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"winnerSide" text,
	"resultSignature" text,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE "solana_payout_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"roundId" text NOT NULL,
	"bettorWallet" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"claimSignature" text,
	"nextAttemptAt" bigint,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arena_agent_whitelist" ADD CONSTRAINT "arena_agent_whitelist_characterId_characters_id_fk" FOREIGN KEY ("characterId") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_round_events" ADD CONSTRAINT "arena_round_events_roundId_arena_rounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."arena_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_agentAId_characters_id_fk" FOREIGN KEY ("agentAId") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_agentBId_characters_id_fk" FOREIGN KEY ("agentBId") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_previewAgentAId_characters_id_fk" FOREIGN KEY ("previewAgentAId") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_previewAgentBId_characters_id_fk" FOREIGN KEY ("previewAgentBId") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_rounds" ADD CONSTRAINT "arena_rounds_winnerId_characters_id_fk" FOREIGN KEY ("winnerId") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solana_bets" ADD CONSTRAINT "solana_bets_roundId_arena_rounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."arena_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solana_markets" ADD CONSTRAINT "solana_markets_roundId_arena_rounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."arena_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "solana_payout_jobs" ADD CONSTRAINT "solana_payout_jobs_roundId_arena_rounds_id_fk" FOREIGN KEY ("roundId") REFERENCES "public"."arena_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_arena_whitelist_enabled" ON "arena_agent_whitelist" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_arena_whitelist_cooldown" ON "arena_agent_whitelist" USING btree ("cooldownUntil");--> statement-breakpoint
CREATE INDEX "idx_arena_whitelist_priority" ON "arena_agent_whitelist" USING btree ("priority");--> statement-breakpoint
CREATE INDEX "idx_arena_round_events_round" ON "arena_round_events" USING btree ("roundId");--> statement-breakpoint
CREATE INDEX "idx_arena_round_events_type" ON "arena_round_events" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX "idx_arena_round_events_created" ON "arena_round_events" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "idx_arena_rounds_phase" ON "arena_rounds" USING btree ("phase");--> statement-breakpoint
CREATE INDEX "idx_arena_rounds_scheduled" ON "arena_rounds" USING btree ("scheduledAt");--> statement-breakpoint
CREATE INDEX "idx_arena_rounds_duel_id" ON "arena_rounds" USING btree ("duelId");--> statement-breakpoint
CREATE INDEX "idx_arena_rounds_winner" ON "arena_rounds" USING btree ("winnerId");--> statement-breakpoint
CREATE INDEX "idx_solana_bets_round" ON "solana_bets" USING btree ("roundId");--> statement-breakpoint
CREATE INDEX "idx_solana_bets_wallet" ON "solana_bets" USING btree ("bettorWallet");--> statement-breakpoint
CREATE INDEX "idx_solana_bets_status" ON "solana_bets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_solana_bets_signature" ON "solana_bets" USING btree ("txSignature");--> statement-breakpoint
CREATE INDEX "idx_solana_markets_status" ON "solana_markets" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_solana_markets_market_pda" ON "solana_markets" USING btree ("marketPda");--> statement-breakpoint
CREATE UNIQUE INDEX "uidx_solana_markets_oracle_pda" ON "solana_markets" USING btree ("oraclePda");--> statement-breakpoint
CREATE INDEX "idx_solana_payout_jobs_round" ON "solana_payout_jobs" USING btree ("roundId");--> statement-breakpoint
CREATE INDEX "idx_solana_payout_jobs_status" ON "solana_payout_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_solana_payout_jobs_next_attempt" ON "solana_payout_jobs" USING btree ("nextAttemptAt");
