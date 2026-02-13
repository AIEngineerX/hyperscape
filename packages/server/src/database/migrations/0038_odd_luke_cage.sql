CREATE TABLE IF NOT EXISTS "combat_stat_events" (
	"eventKey" text PRIMARY KEY NOT NULL,
	"eventType" text NOT NULL,
	"playerId" text NOT NULL,
	"secondaryPlayerId" text,
	"classification" text,
	"duelId" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "onchain_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"stream" text DEFAULT 'combat_stats' NOT NULL,
	"eventType" text NOT NULL,
	"dedupeKey" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"lockedBy" text,
	"lockedAt" bigint,
	"lastError" text,
	"sentAt" bigint,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "player_combat_stats" (
	"playerId" text PRIMARY KEY NOT NULL,
	"totalPlayerKills" integer DEFAULT 0 NOT NULL,
	"totalDeaths" integer DEFAULT 0 NOT NULL,
	"totalPvpDeaths" integer DEFAULT 0 NOT NULL,
	"totalPveDeaths" integer DEFAULT 0 NOT NULL,
	"totalDuelWins" integer DEFAULT 0 NOT NULL,
	"totalDuelLosses" integer DEFAULT 0 NOT NULL,
	"createdAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL,
	"updatedAt" bigint DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'combat_stat_events_playerId_characters_id_fk'
	) THEN
		ALTER TABLE "combat_stat_events"
		ADD CONSTRAINT "combat_stat_events_playerId_characters_id_fk"
		FOREIGN KEY ("playerId")
		REFERENCES "public"."characters"("id")
		ON DELETE cascade
		ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'combat_stat_events_secondaryPlayerId_characters_id_fk'
	) THEN
		ALTER TABLE "combat_stat_events"
		ADD CONSTRAINT "combat_stat_events_secondaryPlayerId_characters_id_fk"
		FOREIGN KEY ("secondaryPlayerId")
		REFERENCES "public"."characters"("id")
		ON DELETE set null
		ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'player_combat_stats_playerId_characters_id_fk'
	) THEN
		ALTER TABLE "player_combat_stats"
		ADD CONSTRAINT "player_combat_stats_playerId_characters_id_fk"
		FOREIGN KEY ("playerId")
		REFERENCES "public"."characters"("id")
		ON DELETE cascade
		ON UPDATE no action;
	END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_combat_stat_events_type" ON "combat_stat_events" USING btree ("eventType");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_combat_stat_events_player" ON "combat_stat_events" USING btree ("playerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_combat_stat_events_secondary" ON "combat_stat_events" USING btree ("secondaryPlayerId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_combat_stat_events_duel" ON "combat_stat_events" USING btree ("duelId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_combat_stat_events_created" ON "combat_stat_events" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uidx_onchain_outbox_dedupe" ON "onchain_outbox" USING btree ("dedupeKey");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onchain_outbox_status_next_attempt" ON "onchain_outbox" USING btree ("status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onchain_outbox_locked_at" ON "onchain_outbox" USING btree ("lockedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_onchain_outbox_stream" ON "onchain_outbox" USING btree ("stream");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_combat_stats_updated_at" ON "player_combat_stats" USING btree ("updatedAt");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_combat_stats_kills" ON "player_combat_stats" USING btree ("totalPlayerKills");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_combat_stats_deaths" ON "player_combat_stats" USING btree ("totalDeaths");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_player_combat_stats_duel_wins" ON "player_combat_stats" USING btree ("totalDuelWins");
