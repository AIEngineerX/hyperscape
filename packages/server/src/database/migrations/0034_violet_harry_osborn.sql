CREATE TABLE IF NOT EXISTS "duel_settlements" (
	"duelId" text PRIMARY KEY NOT NULL,
	"winnerId" text NOT NULL,
	"loserId" text NOT NULL,
	"settledAt" bigint NOT NULL,
	"stakesTransferred" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "duel_settlements" ADD CONSTRAINT "duel_settlements_winnerId_characters_id_fk" FOREIGN KEY ("winnerId") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duel_settlements" ADD CONSTRAINT "duel_settlements_loserId_characters_id_fk" FOREIGN KEY ("loserId") REFERENCES "public"."characters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_duel_settlements_winner" ON "duel_settlements" USING btree ("winnerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_duel_settlements_loser" ON "duel_settlements" USING btree ("loserId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_duel_settlements_settled_at" ON "duel_settlements" USING btree ("settledAt");
