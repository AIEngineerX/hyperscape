import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType } from "@hyperscape/shared";
import { StreamingDuelScheduler } from "../index";
import { DUEL_FOOD_ITEM } from "../types";

type SkillMap = Record<string, { level: number; xp: number }>;

type InventoryItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

type MockEntity = {
  id: string;
  type: "player";
  isAgent: boolean;
  data: {
    name: string;
    position: [number, number, number];
    health: number;
    maxHealth: number;
    skills: SkillMap;
    rotation?: number;
    _teleport?: boolean;
    inCombat?: boolean;
    combatTarget?: string | null;
    attackTarget?: string | null;
    inStreamingDuel?: boolean;
    preventRespawn?: boolean;
  };
};

type MockWorldContext = {
  world: {
    entities: {
      items: Map<string, MockEntity>;
      get: (id: string) => MockEntity | undefined;
      getAllEntities: () => Map<string, MockEntity>;
    };
    network: {
      send: ReturnType<typeof vi.fn>;
    };
    on: (event: string, fn: (payload: unknown) => void) => void;
    off: (event: string, fn: (payload: unknown) => void) => void;
    emit: (event: string, payload: unknown) => void;
    getSystem: (name: string) => unknown;
  };
  entities: Map<string, MockEntity>;
  combatCalls: Array<{ attackerId: string; targetId: string }>;
  getInventory: (playerId: string) => { items: InventoryItem[]; coins: number };
  countFood: (playerId: string) => number;
  hasItemAtSlot: (playerId: string, slot: number, itemId: string) => boolean;
};

function createAgentEntity(
  id: string,
  name: string,
  position: [number, number, number],
): MockEntity {
  const skills: SkillMap = {
    attack: { level: 10, xp: 0 },
    strength: { level: 10, xp: 0 },
    defense: { level: 10, xp: 0 },
    constitution: { level: 20, xp: 0 },
  };

  return {
    id,
    type: "player",
    isAgent: true,
    data: {
      name,
      position,
      health: 20,
      maxHealth: 20,
      skills,
      inCombat: false,
      combatTarget: null,
      attackTarget: null,
    },
  };
}

function createMockWorld(options?: {
  alphaInventory?: InventoryItem[];
  betaInventory?: InventoryItem[];
  terrainHeight?: number;
  damageByAttacker?: Record<string, number>;
}): MockWorldContext {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const entities = new Map<string, MockEntity>();
  const inventories = new Map<
    string,
    { items: InventoryItem[]; coins: number }
  >();
  const combatCalls: Array<{ attackerId: string; targetId: string }> = [];

  const alpha = createAgentEntity("agent-alpha", "Alpha", [10, 0.2, 10]);
  const beta = createAgentEntity("agent-beta", "Beta", [20, 0.2, 20]);
  entities.set(alpha.id, alpha);
  entities.set(beta.id, beta);

  inventories.set("agent-alpha", {
    items: [...(options?.alphaInventory ?? [])],
    coins: 0,
  });
  inventories.set("agent-beta", {
    items: [...(options?.betaInventory ?? [])],
    coins: 0,
  });

  const terrainHeight = options?.terrainHeight ?? 7.25;
  const damageByAttacker: Record<string, number> = {
    "agent-alpha": 8,
    "agent-beta": 1,
    ...(options?.damageByAttacker ?? {}),
  };

  const on = (event: string, fn: (payload: unknown) => void) => {
    const handlers =
      listeners.get(event) ?? new Set<(payload: unknown) => void>();
    handlers.add(fn);
    listeners.set(event, handlers);
  };

  const off = (event: string, fn: (payload: unknown) => void) => {
    listeners.get(event)?.delete(fn);
  };

  const emit = (event: string, payload: unknown) => {
    const handlers = listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      handler(payload);
    }
  };

  const getInventoryState = (playerId: string) => {
    const state = inventories.get(playerId);
    if (!state) {
      const empty = { items: [] as InventoryItem[], coins: 0 };
      inventories.set(playerId, empty);
      return empty;
    }
    return state;
  };

  const inventorySystem = {
    getInventory: (playerId: string) => {
      const state = getInventoryState(playerId);
      return {
        playerId,
        items: state.items,
        coins: state.coins,
      };
    },
    addItemDirect: async (
      playerId: string,
      item: { itemId: string; quantity: number; slot?: number },
    ) => {
      const state = getInventoryState(playerId);
      const usedSlots = new Set(state.items.map((entry) => entry.slot));
      const slot =
        typeof item.slot === "number"
          ? item.slot
          : Array.from({ length: 28 }, (_, i) => i).find(
              (candidate) => !usedSlots.has(candidate),
            );
      if (typeof slot !== "number" || usedSlots.has(slot)) {
        return false;
      }
      state.items.push({
        slot,
        itemId: item.itemId,
        quantity: item.quantity,
      });
      return true;
    },
    removeItem: async (data: {
      playerId: string;
      itemId: string;
      quantity: number;
      slot?: number;
    }) => {
      const state = getInventoryState(data.playerId);
      const index = state.items.findIndex((entry) => {
        if (typeof data.slot === "number") {
          return entry.slot === data.slot && entry.itemId === data.itemId;
        }
        return entry.itemId === data.itemId;
      });
      if (index < 0) return false;
      const entry = state.items[index];
      if (entry.quantity <= data.quantity) {
        state.items.splice(index, 1);
      } else {
        entry.quantity -= data.quantity;
      }
      return true;
    },
    isInventoryReady: () => true,
  };

  const world = {
    entities: {
      items: entities,
      get: (id: string) => entities.get(id),
      getAllEntities: () => entities,
    },
    network: {
      send: vi.fn(),
    },
    on,
    off,
    emit,
    getSystem: (name: string) => {
      if (name === "terrain") {
        return {
          getHeightAt: () => terrainHeight,
        };
      }

      if (name === "inventory") {
        return inventorySystem;
      }

      if (name === "combat") {
        return {
          startCombat: (
            attackerId: string,
            targetId: string,
            _options?: { attackerType?: string; targetType?: string },
          ) => {
            combatCalls.push({ attackerId, targetId });

            const attacker = entities.get(attackerId);
            const target = entities.get(targetId);
            if (!attacker || !target) {
              return false;
            }

            if ((attacker.data.health ?? 0) <= 0) {
              return false;
            }

            if ((target.data.health ?? 0) <= 0) {
              return false;
            }

            const damage = damageByAttacker[attackerId] ?? 1;
            const nextHealth = Math.max(0, (target.data.health ?? 0) - damage);
            target.data.health = nextHealth;
            target.data.inCombat = nextHealth > 0;
            target.data.combatTarget = attackerId;

            emit(EventType.ENTITY_DAMAGED, {
              attackerId,
              entityId: targetId,
              damage,
            });

            if (nextHealth <= 0) {
              emit(EventType.ENTITY_DEATH, {
                entityId: targetId,
                killedBy: attackerId,
              });
            }

            return true;
          },
        };
      }

      if (name === "database") {
        return null;
      }

      return null;
    },
  };

  return {
    world,
    entities,
    combatCalls,
    getInventory: (playerId: string) => getInventoryState(playerId),
    countFood: (playerId: string) =>
      getInventoryState(playerId).items.filter(
        (item) =>
          item.itemId === DUEL_FOOD_ITEM ||
          item.itemId.endsWith(DUEL_FOOD_ITEM),
      ).length,
    hasItemAtSlot: (playerId: string, slot: number, itemId: string) =>
      getInventoryState(playerId).items.some(
        (item) => item.slot === slot && item.itemId === itemId,
      ),
  };
}

describe("StreamingDuelScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("grounds arena teleports and starts combat with HP loss", async () => {
    const ctx = createMockWorld({ terrainHeight: 12.5 });
    const scheduler = new StreamingDuelScheduler(ctx.world as never);

    scheduler.init();
    expect(scheduler.getCurrentCycle()?.phase).toBe("ANNOUNCEMENT");

    await (scheduler as any).startCountdown();

    const alpha = ctx.entities.get("agent-alpha");
    const beta = ctx.entities.get("agent-beta");
    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(alpha!.data.position[1]).toBe(12.5);
    expect(beta!.data.position[1]).toBe(12.5);

    await vi.advanceTimersByTimeAsync(4000);

    expect(scheduler.getCurrentCycle()?.phase).toBe("FIGHTING");
    expect(scheduler.getCurrentCycle()?.arenaId).toBe(1);
    expect(ctx.combatCalls.length).toBeGreaterThanOrEqual(2);
    expect(alpha!.data.health).toBeLessThan(alpha!.data.maxHealth);
    expect(beta!.data.health).toBeLessThan(beta!.data.maxHealth);

    scheduler.destroy();
  });

  it("resolves duel, restores HP, removes only duel-provisioned food, and returns agents", async () => {
    const ctx = createMockWorld({
      alphaInventory: [
        { slot: 0, itemId: DUEL_FOOD_ITEM, quantity: 1 },
        { slot: 1, itemId: "tuna", quantity: 3 },
      ],
      betaInventory: [{ slot: 5, itemId: DUEL_FOOD_ITEM, quantity: 2 }],
    });
    const scheduler = new StreamingDuelScheduler(ctx.world as never);

    const alphaOriginalPosition = [
      ...ctx.entities.get("agent-alpha")!.data.position,
    ] as [number, number, number];
    const betaOriginalPosition = [
      ...ctx.entities.get("agent-beta")!.data.position,
    ] as [number, number, number];

    scheduler.init();
    await (scheduler as any).startCountdown();

    expect(ctx.countFood("agent-alpha")).toBeGreaterThan(1);
    expect(ctx.countFood("agent-beta")).toBeGreaterThan(2);

    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(8000);
    await Promise.resolve();
    await Promise.resolve();

    const cycle = scheduler.getCurrentCycle();
    expect(cycle?.phase).toBe("RESOLUTION");
    expect(cycle?.winnerId).toBe("agent-alpha");
    expect(cycle?.loserId).toBe("agent-beta");

    const alpha = ctx.entities.get("agent-alpha")!;
    const beta = ctx.entities.get("agent-beta")!;

    expect(alpha.data.health).toBe(alpha.data.maxHealth);
    expect(beta.data.health).toBe(beta.data.maxHealth);

    expect(alpha.data.inStreamingDuel).toBe(false);
    expect(beta.data.inStreamingDuel).toBe(false);
    expect(alpha.data.preventRespawn).toBe(false);
    expect(beta.data.preventRespawn).toBe(false);

    expect(alpha.data.position).toEqual(alphaOriginalPosition);
    expect(beta.data.position).toEqual(betaOriginalPosition);

    expect(ctx.countFood("agent-alpha")).toBe(1);
    expect(ctx.countFood("agent-beta")).toBe(1);
    expect(ctx.hasItemAtSlot("agent-alpha", 0, DUEL_FOOD_ITEM)).toBe(true);
    expect(ctx.hasItemAtSlot("agent-beta", 5, DUEL_FOOD_ITEM)).toBe(true);
    expect(ctx.hasItemAtSlot("agent-alpha", 1, "tuna")).toBe(true);

    expect(alpha.data.combatTarget).toBeNull();
    expect(beta.data.combatTarget).toBeNull();
    expect(alpha.data.inCombat).toBe(false);
    expect(beta.data.inCombat).toBe(false);

    scheduler.destroy();
  });

  it("sanitizes invalid original restore heights to grounded terrain", async () => {
    const ctx = createMockWorld({ terrainHeight: 14.5 });
    ctx.entities.get("agent-alpha")!.data.position = [10, -250, 10];
    const scheduler = new StreamingDuelScheduler(ctx.world as never);

    scheduler.init();
    await (scheduler as any).startCountdown();

    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(8000);
    await Promise.resolve();
    await Promise.resolve();

    const alpha = ctx.entities.get("agent-alpha")!;
    expect(alpha.data.position[0]).toBe(10);
    expect(alpha.data.position[2]).toBe(10);
    expect(alpha.data.position[1]).toBe(14.5);

    scheduler.destroy();
  });

  it("clears duel flags if scheduler is destroyed mid-fight", async () => {
    const ctx = createMockWorld();
    const scheduler = new StreamingDuelScheduler(ctx.world as never);

    scheduler.init();
    await (scheduler as any).startCountdown();
    await vi.advanceTimersByTimeAsync(4000);

    const alpha = ctx.entities.get("agent-alpha")!;
    const beta = ctx.entities.get("agent-beta")!;
    expect(alpha.data.inStreamingDuel).toBe(true);
    expect(beta.data.inStreamingDuel).toBe(true);

    scheduler.destroy();

    expect(alpha.data.inStreamingDuel).toBe(false);
    expect(beta.data.inStreamingDuel).toBe(false);
    expect(alpha.data.preventRespawn).toBe(false);
    expect(beta.data.preventRespawn).toBe(false);
  });
});
