CREATE TABLE IF NOT EXISTS "duel_settlements" (
	"duelId" text PRIMARY KEY NOT NULL,
	"winnerId" text NOT NULL,
	"loserId" text NOT NULL,
	"settledAt" bigint NOT NULL,
	"stakesTransferred" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duel_settlements_winnerId_characters_id_fk') THEN
    ALTER TABLE "duel_settlements" ADD CONSTRAINT "duel_settlements_winnerId_characters_id_fk" FOREIGN KEY ("winnerId") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'duel_settlements_loserId_characters_id_fk') THEN
    ALTER TABLE "duel_settlements" ADD CONSTRAINT "duel_settlements_loserId_characters_id_fk" FOREIGN KEY ("loserId") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_duel_settlements_winner" ON "duel_settlements" USING btree ("winnerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_duel_settlements_loser" ON "duel_settlements" USING btree ("loserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_duel_settlements_settled_at" ON "duel_settlements" USING btree ("settledAt");
