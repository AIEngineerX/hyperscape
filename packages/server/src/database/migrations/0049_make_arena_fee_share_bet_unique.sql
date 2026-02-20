WITH ranked_fee_shares AS (
  SELECT
    "id",
    "betId",
    ROW_NUMBER() OVER (PARTITION BY "betId" ORDER BY "id" ASC) AS rn
  FROM "arena_fee_shares"
  WHERE "betId" IS NOT NULL
)
UPDATE "arena_fee_shares" AS afs
SET "betId" = NULL
FROM ranked_fee_shares rfs
WHERE afs."id" = rfs."id"
  AND rfs.rn > 1;
--> statement-breakpoint

DROP INDEX IF EXISTS "idx_arena_fee_shares_bet";
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_fee_shares_bet"
  ON "arena_fee_shares" USING btree ("betId");
