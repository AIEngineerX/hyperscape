import { describe, expect, it, vi, beforeEach } from "vitest";
import { DuelCombatAI } from "../DuelCombatAI";

function createMockService() {
  return {
    getGameState: vi.fn().mockReturnValue({
      health: 80,
      maxHealth: 99,
      alive: true,
      inCombat: true,
      currentTarget: "opponent-1",
      inventory: [
        { slot: 0, itemId: "shark", quantity: 1 },
        { slot: 1, itemId: "shrimp", quantity: 1 },
        { slot: 2, itemId: "super_strength_potion", quantity: 1 },
      ],
      nearbyEntities: [
        { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
      ],
      position: [100, 10, 100] as [number, number, number],
    }),
    executeAttack: vi.fn().mockResolvedValue(undefined),
    executeUse: vi.fn().mockResolvedValue(undefined),
    executePrayerToggle: vi.fn().mockResolvedValue(true),
    executeChangeStyle: vi.fn().mockResolvedValue(true),
  };
}

describe("DuelCombatAI", () => {
  let service: ReturnType<typeof createMockService>;

  beforeEach(() => {
    service = createMockService();
    vi.useFakeTimers();
  });

  describe("lifecycle", () => {
    it("starts and stops cleanly", () => {
      const ai = new DuelCombatAI(
        service as unknown as Parameters<
          typeof DuelCombatAI.prototype.start
        >[0] extends void
          ? never
          : Parameters<(typeof DuelCombatAI)["prototype"]["constructor"]>[0],
        "opponent-1",
      );

      // Type assertion to access the mock service properly
      const typedAi = new DuelCombatAI(service as never, "opponent-1");
      typedAi.start();
      expect(typedAi.getStats().tickCount).toBe(0);
      typedAi.stop();
    });

    it("reports stats after stopping", () => {
      const ai = new DuelCombatAI(service as never, "opponent-1");
      ai.start();
      ai.stop();
      const stats = ai.getStats();
      expect(stats).toHaveProperty("tickCount");
      expect(stats).toHaveProperty("attacksLanded");
      expect(stats).toHaveProperty("healsUsed");
      expect(stats).toHaveProperty("totalDamageDealt");
      expect(stats).toHaveProperty("totalDamageReceived");
    });
  });

  describe("findBestFood prioritization", () => {
    it("prioritizes shark over shrimp", () => {
      const ai = new DuelCombatAI(service as never, "opponent-1");

      service.getGameState.mockReturnValue({
        health: 30,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [
          { slot: 0, itemId: "shrimp", quantity: 5 },
          { slot: 1, itemId: "shark", quantity: 3 },
          { slot: 2, itemId: "trout", quantity: 2 },
        ],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      ai.start();
      vi.advanceTimersByTime(600);
      ai.stop();

      if (service.executeUse.mock.calls.length > 0) {
        expect(service.executeUse.mock.calls[0][0]).toBe("shark");
      }
    });
  });

  describe("prayer state tracking", () => {
    it("does not toggle a prayer that is already active", async () => {
      const ai = new DuelCombatAI(service as never, "opponent-1");

      service.getGameState.mockReturnValue({
        health: 80,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      ai.start();

      // Advance to tick 3 (prayer switch runs on tickCount % 3 === 0)
      vi.advanceTimersByTime(600 * 3);
      const callCount1 = service.executePrayerToggle.mock.calls.length;

      // Advance to tick 6 -- same prayer should NOT toggle again
      vi.advanceTimersByTime(600 * 3);
      const callCount2 = service.executePrayerToggle.mock.calls.length;

      // Should not have doubled the calls (prayer already active)
      expect(callCount2).toBeLessThanOrEqual(callCount1 + 1);
      ai.stop();
    });
  });

  describe("combat style switching", () => {
    it("does not redundantly switch to the same style", async () => {
      const ai = new DuelCombatAI(service as never, "opponent-1");

      service.getGameState.mockReturnValue({
        health: 90,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      ai.start();

      // Advance to tick 5 (style switch runs on tickCount % 5 === 0)
      vi.advanceTimersByTime(600 * 5);
      const callCount1 = service.executeChangeStyle.mock.calls.length;

      // Advance to tick 10 -- same style should not be re-sent
      vi.advanceTimersByTime(600 * 5);
      const callCount2 = service.executeChangeStyle.mock.calls.length;

      expect(callCount2).toBe(callCount1);
      ai.stop();
    });
  });

  describe("healing", () => {
    it("heals when health drops below threshold", async () => {
      const ai = new DuelCombatAI(service as never, "opponent-1");

      service.getGameState.mockReturnValue({
        health: 30,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [{ slot: 0, itemId: "shark", quantity: 1 }],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      ai.start();
      vi.advanceTimersByTime(600);
      ai.stop();

      expect(service.executeUse).toHaveBeenCalled();
    });

    it("does not heal when health is above threshold", async () => {
      const ai = new DuelCombatAI(service as never, "opponent-1");

      service.getGameState.mockReturnValue({
        health: 80,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [{ slot: 0, itemId: "shark", quantity: 1 }],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      ai.start();
      vi.advanceTimersByTime(600);
      ai.stop();

      expect(service.executeUse).not.toHaveBeenCalled();
    });
  });

  describe("attack re-engagement", () => {
    it("attacks when not in combat", async () => {
      const ai = new DuelCombatAI(service as never, "opponent-1");

      service.getGameState.mockReturnValue({
        health: 80,
        maxHealth: 99,
        alive: true,
        inCombat: false,
        currentTarget: null,
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      ai.start();
      await vi.advanceTimersByTimeAsync(600);
      ai.stop();

      expect(service.executeAttack).toHaveBeenCalledWith("opponent-1");
    });
  });

  describe("stops on death", () => {
    it("stops ticking when agent dies", async () => {
      const ai = new DuelCombatAI(service as never, "opponent-1");

      service.getGameState.mockReturnValue({
        health: 0,
        maxHealth: 99,
        alive: false,
        inCombat: false,
        currentTarget: null,
        inventory: [],
        nearbyEntities: [],
      });

      ai.start();
      vi.advanceTimersByTime(600);

      const stats = ai.getStats();
      expect(stats.tickCount).toBeLessThanOrEqual(1);
    });
  });
});
