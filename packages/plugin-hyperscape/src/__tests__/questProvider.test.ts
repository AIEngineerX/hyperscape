import { describe, expect, it, vi } from "vitest";
import { questProvider } from "../providers/questProvider";

function createMockRuntime(hasService = true) {
  const service = hasService
    ? {
        isConnected: vi.fn().mockReturnValue(true),
        getQuestState: vi.fn().mockReturnValue([]),
        getPlayerEntity: vi.fn().mockReturnValue({
          position: [100, 10, 100],
          items: [],
        }),
        getNearbyEntities: vi.fn().mockReturnValue([]),
      }
    : null;

  return {
    getService: vi.fn().mockReturnValue(service),
  };
}

describe("questProvider", () => {
  it("returns empty result when service unavailable", async () => {
    const runtime = createMockRuntime(false);
    const result = await questProvider.get(
      runtime as never,
      {} as never,
      {} as never,
    );

    expect(result.text).toBe("");
    expect(result.data).toEqual({});
  });

  it("returns empty result when not connected", async () => {
    const runtime = createMockRuntime(true);
    runtime.getService()!.isConnected.mockReturnValue(false);

    const result = await questProvider.get(
      runtime as never,
      {} as never,
      {} as never,
    );

    expect(result.text).toBe("");
  });

  it("returns quest data when quests exist", async () => {
    const runtime = createMockRuntime(true);
    runtime.getService()!.getQuestState.mockReturnValue([
      {
        id: "quest-1",
        name: "Kill Goblins",
        status: "active",
        progress: 3,
        target: 5,
      },
    ]);

    const result = await questProvider.get(
      runtime as never,
      {} as never,
      {} as never,
    );

    expect(result.text!.length).toBeGreaterThan(0);
  });
});
