-- Migration: Add failed_transactions table for Web3 failure recovery
-- This table persists failed blockchain transactions for recovery and dead-letter handling

CREATE TABLE IF NOT EXISTS "failed_transactions" (
    "dedupeKey" TEXT PRIMARY KEY,
    "callData" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "queuedAt" BIGINT NOT NULL,
    "failedAt" BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT,
    "createdAt" BIGINT NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
);

-- Index for querying by status (pending vs dead_letter)
CREATE INDEX IF NOT EXISTS "idx_failed_transactions_status" ON "failed_transactions" ("status");

-- Index for querying by failure time (cleanup, monitoring)
CREATE INDEX IF NOT EXISTS "idx_failed_transactions_failed_at" ON "failed_transactions" ("failedAt");

-- Add check constraints
ALTER TABLE "failed_transactions" ADD CONSTRAINT "failed_transactions_status_check"
    CHECK ("status" IN ('pending', 'dead_letter'));

ALTER TABLE "failed_transactions" ADD CONSTRAINT "failed_transactions_attempt_count_check"
    CHECK ("attemptCount" >= 0);
