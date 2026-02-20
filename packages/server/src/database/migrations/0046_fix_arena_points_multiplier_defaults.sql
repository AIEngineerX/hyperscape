ALTER TABLE "arena_points"
  ALTER COLUMN "multiplier" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "arena_referral_points"
  ALTER COLUMN "multiplier" SET DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "arena_staking_points"
  ALTER COLUMN "multiplier" SET DEFAULT 1;
--> statement-breakpoint

UPDATE "arena_points"
SET "multiplier" = 1,
    "totalPoints" = "basePoints"
WHERE "multiplier" < 1;
--> statement-breakpoint
UPDATE "arena_referral_points"
SET "multiplier" = 1,
    "totalPoints" = "basePoints"
WHERE "multiplier" < 1;
--> statement-breakpoint
UPDATE "arena_staking_points"
SET "multiplier" = 1,
    "totalPoints" = "basePoints"
WHERE "multiplier" < 1;
--> statement-breakpoint

WITH ranked_points AS (
  SELECT
    "id",
    "betId",
    ROW_NUMBER() OVER (PARTITION BY "betId" ORDER BY "id" ASC) AS rn
  FROM "arena_points"
  WHERE "betId" IS NOT NULL
)
UPDATE "arena_points" AS ap
SET "betId" = NULL
FROM ranked_points rp
WHERE ap."id" = rp."id"
  AND rp.rn > 1;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_points_bet"
  ON "arena_points" USING btree ("betId");
