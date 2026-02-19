import { describe, expect, it, vi } from "vitest";

vi.mock("@elizaos/core", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  talkToNpcAction,
  acceptQuestAction,
  completeQuestAction,
  checkQuestAction,
} from "../actions/quests";

function createMockRuntime(hasNpc = true) {
  const service = {
    isConnected: vi.fn().mockReturnValue(true),
    getPlayerEntity: vi.fn().mockReturnValue({
      position: [100, 10, 100] as [number, number, number],
    }),
    getNearbyEntities: vi.fn().mockReturnValue(
      hasNpc
        ? [
            {
              id: "npc-1",
              name: "Guard",
              type: "npc",
              entityType: "npc",
              position: [102, 10, 100] as [number, number, number],
            },
          ]
        : [],
    ),
    executeMove: vi.fn().mockResolvedValue(undefined),
    interactWithEntity: vi.fn(),
    getGameState: vi.fn().mockReturnValue(null),
  };

  return {
    getService: vi.fn().mockReturnValue(service),
    service,
  };
}

describe("quest actions", () => {
  describe("talkToNpcAction", () => {
    it("validates when NPCs are nearby", async () => {
      const runtime = createMockRuntime(true);
      const result = await talkToNpcAction.validate(runtime as never);
      expect(result).toBe(true);
    });

    it("fails validation when no NPCs nearby", async () => {
      const runtime = createMockRuntime(false);
      const result = await talkToNpcAction.validate(runtime as never);
      expect(result).toBe(false);
    });
  });

  describe("acceptQuestAction", () => {
    it("validates when NPCs are nearby", async () => {
      const runtime = createMockRuntime(true);
      const result = await acceptQuestAction.validate(runtime as never);
      expect(result).toBe(true);
    });
  });

  describe("completeQuestAction", () => {
    it("validates when NPCs are nearby", async () => {
      const runtime = createMockRuntime(true);
      const result = await completeQuestAction.validate(runtime as never);
      expect(result).toBe(true);
    });
  });

  describe("checkQuestAction", () => {
    it("validates when connected", async () => {
      const runtime = createMockRuntime(false);
      const result = await checkQuestAction.validate(runtime as never);
      expect(result).toBe(true);
    });
  });
});
