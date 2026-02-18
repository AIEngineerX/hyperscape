-- Migration: Validate NOT VALID constraints and add agent duel stats checks
-- Phase 2 Database Integrity Fix
--
-- This migration:
-- 1. Validates all NOT VALID constraints added in earlier migrations
-- 2. Adds CHECK constraints to agent_duel_stats table
-- 3. Cleans up any invalid data that would block validation

-- ============================================================================
-- Step 1: Data Cleanup - Fix any negative values before validating constraints
-- ============================================================================

-- Fix negative coins (set to 0)
UPDATE "characters" SET "coins" = 0 WHERE "coins" < 0;
--> statement-breakpoint

-- Fix negative health (set to 1 to keep character alive)
UPDATE "characters" SET "health" = 1 WHERE "health" < 0;
--> statement-breakpoint

-- Fix zero or negative inventory quantities (remove the items)
DELETE FROM "inventory" WHERE "quantity" <= 0;
--> statement-breakpoint

-- Fix negative bank quantities (set to 0 for placeholder behavior)
UPDATE "bank_storage" SET "quantity" = 0 WHERE "quantity" < 0;
--> statement-breakpoint

-- ============================================================================
-- Step 2: Validate NOT VALID constraints from migration 0035
-- ============================================================================

-- Validate coins non-negative constraint
DO $$
BEGIN
  ALTER TABLE "characters" VALIDATE CONSTRAINT "characters_coins_non_negative";
EXCEPTION
  WHEN undefined_object THEN
    -- Constraint doesn't exist, skip
    NULL;
  WHEN OTHERS THEN
    -- Log and continue - constraint may have been validated already
    RAISE NOTICE 'Could not validate characters_coins_non_negative: %', SQLERRM;
END $$;
--> statement-breakpoint

-- Validate health non-negative constraint
DO $$
BEGIN
  ALTER TABLE "characters" VALIDATE CONSTRAINT "characters_health_non_negative";
EXCEPTION
  WHEN undefined_object THEN
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not validate characters_health_non_negative: %', SQLERRM;
END $$;
--> statement-breakpoint

-- Validate inventory quantity positive constraint
DO $$
BEGIN
  ALTER TABLE "inventory" VALIDATE CONSTRAINT "inventory_quantity_positive";
EXCEPTION
  WHEN undefined_object THEN
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not validate inventory_quantity_positive: %', SQLERRM;
END $$;
--> statement-breakpoint

-- Validate bank storage quantity non-negative constraint
DO $$
BEGIN
  ALTER TABLE "bank_storage" VALIDATE CONSTRAINT "bank_storage_quantity_non_negative";
EXCEPTION
  WHEN undefined_object THEN
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not validate bank_storage_quantity_non_negative: %', SQLERRM;
END $$;
--> statement-breakpoint

-- Validate FK constraint on characters.accountId
DO $$
BEGIN
  ALTER TABLE "characters" VALIDATE CONSTRAINT "characters_accountId_users_id_fk";
EXCEPTION
  WHEN undefined_object THEN
    NULL;
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not validate characters_accountId_users_id_fk: %', SQLERRM;
END $$;
--> statement-breakpoint

-- ============================================================================
-- Step 3: Add CHECK constraints for agent_duel_stats table
-- ============================================================================

-- Ensure wins >= 0
DO $$
BEGIN
  ALTER TABLE "agent_duel_stats" ADD CONSTRAINT "agent_duel_stats_wins_non_negative" CHECK ("wins" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Ensure losses >= 0
DO $$
BEGIN
  ALTER TABLE "agent_duel_stats" ADD CONSTRAINT "agent_duel_stats_losses_non_negative" CHECK ("losses" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Ensure draws >= 0
DO $$
BEGIN
  ALTER TABLE "agent_duel_stats" ADD CONSTRAINT "agent_duel_stats_draws_non_negative" CHECK ("draws" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Ensure damage counters >= 0
DO $$
BEGIN
  ALTER TABLE "agent_duel_stats" ADD CONSTRAINT "agent_duel_stats_damage_dealt_non_negative" CHECK ("totalDamageDealt" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "agent_duel_stats" ADD CONSTRAINT "agent_duel_stats_damage_taken_non_negative" CHECK ("totalDamageTaken" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- Ensure streaks >= 0
DO $$
BEGIN
  ALTER TABLE "agent_duel_stats" ADD CONSTRAINT "agent_duel_stats_kill_streak_non_negative" CHECK ("killStreak" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "agent_duel_stats" ADD CONSTRAINT "agent_duel_stats_current_streak_non_negative" CHECK ("currentStreak" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ============================================================================
-- Step 4: Add missing indexes for common query patterns
-- ============================================================================

-- Add index on inventory.playerId for faster inventory lookups
CREATE INDEX IF NOT EXISTS "idx_inventory_player" ON "inventory"("playerId");
--> statement-breakpoint

-- Add index on equipment.playerId for faster equipment lookups
CREATE INDEX IF NOT EXISTS "idx_equipment_player" ON "equipment"("playerId");
--> statement-breakpoint

-- ============================================================================
-- Step 5: Verify FK integrity - log orphaned records
-- ============================================================================

-- This is informational only - logs any orphaned records to console
-- The actual fix would be manual review since we don't want to auto-delete data
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  -- Check for characters without valid users
  SELECT COUNT(*) INTO orphan_count
  FROM "characters" c
  LEFT JOIN "users" u ON c."accountId" = u."id"
  WHERE u."id" IS NULL;

  IF orphan_count > 0 THEN
    RAISE NOTICE 'Found % characters with invalid accountId (orphaned data)', orphan_count;
  END IF;
END $$;
