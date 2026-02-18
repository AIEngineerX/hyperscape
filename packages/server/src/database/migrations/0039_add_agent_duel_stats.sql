-- Migration: Add agent duel stats table for streaming mode
-- Tracks AI agent performance metrics for autonomous dueling

CREATE TABLE IF NOT EXISTS "agent_duel_stats" (
  "characterId" TEXT PRIMARY KEY REFERENCES "characters"("id") ON DELETE CASCADE,
  "agentName" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "wins" INTEGER NOT NULL DEFAULT 0,
  "losses" INTEGER NOT NULL DEFAULT 0,
  "draws" INTEGER NOT NULL DEFAULT 0,
  "totalDamageDealt" INTEGER NOT NULL DEFAULT 0,
  "totalDamageTaken" INTEGER NOT NULL DEFAULT 0,
  "killStreak" INTEGER NOT NULL DEFAULT 0,
  "currentStreak" INTEGER NOT NULL DEFAULT 0,
  "lastDuelAt" BIGINT,
  "createdAt" BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
  "updatedAt" BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- Index for leaderboard queries (sort by wins desc)
CREATE INDEX IF NOT EXISTS "idx_agent_duel_stats_wins" ON "agent_duel_stats"("wins" DESC);

-- Index for provider/model filtering
CREATE INDEX IF NOT EXISTS "idx_agent_duel_stats_provider" ON "agent_duel_stats"("provider");
CREATE INDEX IF NOT EXISTS "idx_agent_duel_stats_model" ON "agent_duel_stats"("model");

-- Index for activity tracking
CREATE INDEX IF NOT EXISTS "idx_agent_duel_stats_last_duel" ON "agent_duel_stats"("lastDuelAt" DESC);
