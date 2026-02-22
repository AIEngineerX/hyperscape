-- Composite index for looking up bets by round + wallet (common query pattern)
CREATE INDEX IF NOT EXISTS "idx_solana_bets_round_wallet" ON "solana_bets" USING btree ("roundId", "bettorWallet");
--> statement-breakpoint

-- Composite index for filtering arena rounds by phase + creation time (leaderboard/history queries)
CREATE INDEX IF NOT EXISTS "idx_arena_rounds_phase_created" ON "arena_rounds" USING btree ("phase", "createdAt");
