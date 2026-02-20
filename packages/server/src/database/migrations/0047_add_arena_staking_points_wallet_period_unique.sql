CREATE UNIQUE INDEX IF NOT EXISTS "uidx_arena_staking_points_wallet_period"
  ON "arena_staking_points" USING btree ("wallet", "periodStartAt", "periodEndAt");
