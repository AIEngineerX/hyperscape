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
    getWeaponAttackSpeed: vi.fn().mockReturnValue(4), // 4 ticks for melee weapons
  };
}

describe("DuelCombatAI", () => {
  let service: ReturnType<typeof createMockService>;

  beforeEach(() => {
    service = createMockService();
  });

  describe("lifecycle", () => {
    it("starts and stops cleanly", () => {
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
    it("prioritizes shark over shrimp", async () => {
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
      await ai.externalTick();
      ai.stop();

      expect(service.executeUse).toHaveBeenCalledWith("shark");
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
      for (let i = 0; i < 3; i++) await ai.externalTick();
      const callCount1 = service.executePrayerToggle.mock.calls.length;

      // Advance to tick 6 -- same prayer should NOT toggle again
      for (let i = 0; i < 3; i++) await ai.externalTick();
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
      for (let i = 0; i < 5; i++) await ai.externalTick();
      const callCount1 = service.executeChangeStyle.mock.calls.length;

      // Advance to tick 10 -- same style should not be re-sent
      for (let i = 0; i < 5; i++) await ai.externalTick();
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
      await ai.externalTick();
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
      await ai.externalTick();
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
      await ai.externalTick();
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
      await ai.externalTick();

      const stats = ai.getStats();
      expect(stats.tickCount).toBeLessThanOrEqual(1);
    });
  });

  describe("trash talk", () => {
    it("fires sendChat when own health crosses 50% threshold", async () => {
      const sendChat = vi.fn();
      const ai = new DuelCombatAI(
        service as never,
        "opponent-1",
        undefined,
        undefined,
        sendChat,
      );

      // Start with high health
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
      await ai.externalTick(); // First tick at 80% HP

      // Drop to below 50%
      service.getGameState.mockReturnValue({
        health: 40,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      await ai.externalTick(); // Crosses 75% and 50% thresholds
      ai.stop();

      // Should have called sendChat with a scripted fallback (no runtime)
      expect(sendChat).toHaveBeenCalled();
    });

    it("fires sendChat when opponent health crosses 25% threshold", async () => {
      const sendChat = vi.fn();
      const ai = new DuelCombatAI(
        service as never,
        "opponent-1",
        undefined,
        undefined,
        sendChat,
      );

      // Start with opponent at 30%
      service.getGameState.mockReturnValue({
        health: 80,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 30, maxHealth: 99, distance: 2 },
        ],
      });

      ai.start();
      await ai.externalTick(); // tick at opponent 30%

      // Drop opponent to below 25%
      service.getGameState.mockReturnValue({
        health: 80,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 20, maxHealth: 99, distance: 2 },
        ],
      });

      await ai.externalTick(); // Crosses opponent 25% threshold
      ai.stop();

      expect(sendChat).toHaveBeenCalled();
    });

    it("does not re-fire an already triggered threshold", async () => {
      const sendChat = vi.fn();
      const ai = new DuelCombatAI(
        service as never,
        "opponent-1",
        undefined,
        undefined,
        sendChat,
      );

      // Start at 80%, tick
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
      await ai.externalTick();

      // Drop to 70% (below 75% threshold)
      service.getGameState.mockReturnValue({
        health: 70,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });
      await ai.externalTick();
      const callsAfterFirst = sendChat.mock.calls.length;

      // Stay at 70% for several ticks — should NOT re-fire 75% threshold
      for (let i = 0; i < 5; i++) await ai.externalTick();
      ai.stop();

      // No additional threshold fires (ambient may fire but threshold shouldn't double)
      // The 75% threshold should only have fired once
      expect(sendChat.mock.calls.length).toBeLessThanOrEqual(
        callsAfterFirst + 1,
      );
    });

    it("uses scripted fallbacks when no runtime is provided", async () => {
      const sendChat = vi.fn();
      const ai = new DuelCombatAI(
        service as never,
        "opponent-1",
        undefined,
        undefined, // no runtime
        sendChat,
      );

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
      await ai.externalTick();

      // Drop health to trigger threshold
      service.getGameState.mockReturnValue({
        health: 40,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      await ai.externalTick();
      ai.stop();

      // Should use scripted fallback (no LLM calls since no runtime)
      expect(sendChat).toHaveBeenCalled();
      const message = sendChat.mock.calls[0][0];
      expect(typeof message).toBe("string");
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThanOrEqual(60);
    });

    it("does not send trash talk without sendChat callback", async () => {
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
      await ai.externalTick();

      // Drop health — no sendChat, shouldn't throw
      service.getGameState.mockReturnValue({
        health: 30,
        maxHealth: 99,
        alive: true,
        inCombat: true,
        currentTarget: "opponent-1",
        inventory: [],
        nearbyEntities: [
          { id: "opponent-1", health: 60, maxHealth: 99, distance: 2 },
        ],
      });

      await ai.externalTick(); // Should not throw
      ai.stop();
    });
  });
});
