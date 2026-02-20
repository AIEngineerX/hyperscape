import { describe, expect, it, vi } from "vitest";
import { ActivityLoggerSystem } from "../index.js";

type InsertedRow = {
  playerId: string;
  eventType: string;
  action: string;
  entityType: string;
  entityId: string;
  details: Record<string, unknown>;
  timestamp: number;
};

function makeDb(existingCharacterIds: string[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () =>
          existingCharacterIds.map((id) => ({
            id,
          })),
        ),
      })),
    })),
  };
}

function makeEntry(playerId: string): InsertedRow {
  return {
    playerId,
    eventType: "XP_GAINED",
    action: "gained_xp",
    entityType: "skill",
    entityId: "agility",
    details: {},
    timestamp: Date.now(),
  };
}

describe("ActivityLoggerSystem", () => {
  it("filters non-character IDs before writing activity batches", async () => {
    const db = makeDb(["agent-openai-gpt-5"]);
    const insertActivitiesBatchAsync = vi.fn(async () => 1);
    const system = new ActivityLoggerSystem({} as never);

    (system as any).databaseSystem = {
      getDb: () => db,
      insertActivitiesBatchAsync,
    };
    (system as any).pendingEntries = [
      makeEntry("agent-openai-gpt-5"),
      makeEntry("socket-temp-123"),
    ];

    await (system as any).flush();

    expect(insertActivitiesBatchAsync).toHaveBeenCalledTimes(1);
    const calls = (
      insertActivitiesBatchAsync as unknown as { mock: { calls: any[][] } }
    ).mock.calls;
    const firstCall = calls[0];
    expect(firstCall).toBeDefined();
    const rows = (firstCall?.[0] ?? []) as InsertedRow[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.playerId).toBe("agent-openai-gpt-5");
  });

  it("does not requeue filtered non-character IDs after insert failure", async () => {
    const db = makeDb(["agent-openai-gpt-5"]);
    const insertActivitiesBatchAsync = vi.fn(async () => {
      throw new Error("db unavailable");
    });
    const system = new ActivityLoggerSystem({} as never, { batchSize: 10 });

    (system as any).databaseSystem = {
      getDb: () => db,
      insertActivitiesBatchAsync,
    };
    (system as any).pendingEntries = [
      makeEntry("agent-openai-gpt-5"),
      makeEntry("socket-temp-123"),
    ];

    await (system as any).flush();

    const pendingEntries = (system as any).pendingEntries as InsertedRow[];
    expect(pendingEntries).toHaveLength(1);
    expect(pendingEntries[0]?.playerId).toBe("agent-openai-gpt-5");
  });
});
