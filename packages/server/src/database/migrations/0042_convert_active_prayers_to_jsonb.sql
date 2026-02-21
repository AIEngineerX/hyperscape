-- Convert activePrayers from text to JSONB
-- Idempotent: skips if column is already jsonb.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'characters'
      AND column_name = 'activePrayers'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE "characters" ALTER COLUMN "activePrayers" DROP DEFAULT;

    ALTER TABLE "characters"
      ALTER COLUMN "activePrayers"
      SET DATA TYPE jsonb
      USING COALESCE(
        CASE
          WHEN "activePrayers" IS NULL OR btrim("activePrayers") = '' THEN '[]'::jsonb
          ELSE "activePrayers"::jsonb
        END,
        '[]'::jsonb
      );

    ALTER TABLE "characters"
      ALTER COLUMN "activePrayers"
      SET DEFAULT '[]'::jsonb;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_characters_active_prayers_gin"
ON "characters" USING GIN ("activePrayers");
