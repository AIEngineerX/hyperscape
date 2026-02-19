-- Migration: Convert activePrayers from text to JSONB
--
-- Benefits of JSONB over text:
-- - Native JSON operations (array contains, indexing)
-- - Better query performance for JSON operations
-- - Schema validation (ensures valid JSON)
-- - Can create GIN indexes for containment queries

-- Step 1: Add new JSONB column with the same default
ALTER TABLE "characters" ADD COLUMN IF NOT EXISTS "activePrayers_new" JSONB DEFAULT '[]'::JSONB;

-- Step 2: Migrate existing data (safely cast text to JSONB array)
-- Malformed JSON or non-array JSON values are normalized to [].
CREATE OR REPLACE FUNCTION parse_active_prayers_jsonb(input_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  parsed JSONB;
BEGIN
  IF input_text IS NULL OR btrim(input_text) = '' THEN
    RETURN '[]'::JSONB;
  END IF;

  parsed := input_text::JSONB;
  IF jsonb_typeof(parsed) = 'array' THEN
    RETURN parsed;
  END IF;

  RETURN '[]'::JSONB;
EXCEPTION
  WHEN others THEN
    RETURN '[]'::JSONB;
END;
$$;

UPDATE "characters"
SET "activePrayers_new" = parse_active_prayers_jsonb("activePrayers");

DROP FUNCTION parse_active_prayers_jsonb(TEXT);

-- Step 3: Drop old column
ALTER TABLE "characters" DROP COLUMN IF EXISTS "activePrayers";

-- Step 4: Rename new column to old name
ALTER TABLE "characters" RENAME COLUMN "activePrayers_new" TO "activePrayers";

-- Step 5: Create GIN index for array containment queries (optional but recommended)
-- This enables efficient queries like: WHERE activePrayers @> '["prayer_id"]'
CREATE INDEX IF NOT EXISTS "idx_characters_active_prayers_gin"
ON "characters" USING GIN ("activePrayers");
