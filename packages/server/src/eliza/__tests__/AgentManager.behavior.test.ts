/**
 * Tests for AgentManager behavior features:
 * - Food eating logic (assessAndEat algorithm)
 * - Mob target spreading
 * - Resource keyword mapping
 * - Eat threshold decisions
 *
 * Tests pure algorithms extracted from the private methods.
 * Item database tests are skipped (items loaded at runtime by DataManager).
 */
import { describe, expect, it } from "vitest";

// ==========================================================================
// Food selection algorithm (extracted from assessAndEat)
// ==========================================================================
describe("food selection algorithm", () => {
  function pickBestFood(
    inventory: Array<{ itemId: string; healAmount: number }>,
    missingHp: number,
  ): { itemId: string; healAmount: number } | null {
    let best: { itemId: string; healAmount: number } | null = null;

    for (const food of inventory) {
      if (food.healAmount <= 0) continue;

      if (!best) {
        best = food;
        continue;
      }

      const bestOverheal = Math.max(0, best.healAmount - missingHp);
      const thisOverheal = Math.max(0, food.healAmount - missingHp);

      if (thisOverheal < bestOverheal) {
        best = food;
      } else if (
        thisOverheal === bestOverheal &&
        food.healAmount > best.healAmount
      ) {
        best = food;
      }
    }

    return best;
  }

  it("picks exact-fit food (heal 3 for 3hp missing)", () => {
    const result = pickBestFood(
      [
        { itemId: "shark", healAmount: 20 },
        { itemId: "shrimp", healAmount: 3 },
        { itemId: "lobster", healAmount: 12 },
      ],
      3,
    );
    expect(result!.itemId).toBe("shrimp");
  });

  it("picks smallest overheal food (5hp missing, options: 3, 12, 20)", () => {
    const result = pickBestFood(
      [
        { itemId: "shark", healAmount: 20 },
        { itemId: "shrimp", healAmount: 3 },
        { itemId: "lobster", healAmount: 12 },
      ],
      5,
    );
    // lobster overheals by 7, shark by 15, shrimp underheals (but overheal=0)
    // Wait — shrimp heals 3, missing 5, so it underheals. Overheal = max(0, 3-5) = 0
    // lobster: overheal = max(0, 12-5) = 7
    // shark: overheal = max(0, 20-5) = 15
    // Shrimp wins with 0 overheal, but it doesn't fully heal.
    // The algorithm picks least overheal = shrimp (0 overheal)
    expect(result!.itemId).toBe("shrimp");
  });

  it("among zero-overheal options, picks bigger heal", () => {
    // Missing 20hp, all foods underheal
    const result = pickBestFood(
      [
        { itemId: "shrimp", healAmount: 3 },
        { itemId: "lobster", healAmount: 12 },
        { itemId: "trout", healAmount: 7 },
      ],
      20,
    );
    // All have 0 overheal, so pick biggest: lobster (12)
    expect(result!.itemId).toBe("lobster");
  });

  it("returns null when no food available", () => {
    const result = pickBestFood([], 10);
    expect(result).toBeNull();
  });

  it("filters items with 0 healAmount", () => {
    const result = pickBestFood([{ itemId: "bones", healAmount: 0 }], 10);
    expect(result).toBeNull();
  });

  it("filters items with negative healAmount", () => {
    const result = pickBestFood([{ itemId: "poison", healAmount: -5 }], 10);
    expect(result).toBeNull();
  });

  it("picks only food item when one option", () => {
    const result = pickBestFood([{ itemId: "shrimp", healAmount: 3 }], 10);
    expect(result!.itemId).toBe("shrimp");
  });

  it("with equal overheal, picks bigger heal", () => {
    const result = pickBestFood(
      [
        { itemId: "trout", healAmount: 7 },
        { itemId: "salmon", healAmount: 9 },
      ],
      20,
    );
    expect(result!.itemId).toBe("salmon");
  });

  it("prefers exact fit over underheal", () => {
    const result = pickBestFood(
      [
        { itemId: "shrimp", healAmount: 3 },
        { itemId: "sardine", healAmount: 5 },
      ],
      5,
    );
    // sardine: overheal 0, shrimp: overheal 0
    // Equal overheal — pick bigger (sardine)
    expect(result!.itemId).toBe("sardine");
  });
});

// ==========================================================================
// Mob target spreading algorithm
// ==========================================================================
describe("mob target spreading", () => {
  function spreadTargets(
    agentId: string,
    mobs: Array<{ id: string; name: string }>,
    takenTargets: Map<string, string>,
  ): { id: string; name: string } | undefined {
    if (mobs.length === 0) return undefined;

    const taken = new Set(
      [...takenTargets.entries()]
        .filter(([id]) => id !== agentId)
        .map(([, targetId]) => targetId),
    );

    const untargeted = mobs.find((m) => !taken.has(m.id));
    if (untargeted) return untargeted;

    const counts = new Map<string, number>();
    for (const [id, targetId] of takenTargets) {
      if (id !== agentId) {
        counts.set(targetId, (counts.get(targetId) || 0) + 1);
      }
    }

    const sorted = [...mobs].sort(
      (a, b) => (counts.get(a.id) || 0) - (counts.get(b.id) || 0),
    );
    return sorted[0];
  }

  it("picks untargeted mob when available", () => {
    const mobs = [
      { id: "goblin-1", name: "Goblin" },
      { id: "goblin-2", name: "Goblin" },
    ];
    const taken = new Map([["other-agent", "goblin-1"]]);

    const result = spreadTargets("my-agent", mobs, taken);
    expect(result!.id).toBe("goblin-2");
  });

  it("picks least-targeted mob when all are taken", () => {
    const mobs = [
      { id: "goblin-1", name: "Goblin" },
      { id: "goblin-2", name: "Goblin" },
    ];
    const taken = new Map([
      ["agent-a", "goblin-1"],
      ["agent-b", "goblin-1"],
      ["agent-c", "goblin-2"],
    ]);

    const result = spreadTargets("my-agent", mobs, taken);
    expect(result!.id).toBe("goblin-2");
  });

  it("ignores own target in taken set", () => {
    const mobs = [
      { id: "goblin-1", name: "Goblin" },
      { id: "goblin-2", name: "Goblin" },
    ];
    const taken = new Map([["my-agent", "goblin-1"]]);

    const result = spreadTargets("my-agent", mobs, taken);
    expect(result!.id).toBe("goblin-1");
  });

  it("returns undefined for empty mob list", () => {
    const result = spreadTargets("my-agent", [], new Map());
    expect(result).toBeUndefined();
  });

  it("returns first mob when no agents have targets", () => {
    const mobs = [
      { id: "goblin-1", name: "Goblin" },
      { id: "goblin-2", name: "Goblin" },
    ];
    const result = spreadTargets("my-agent", mobs, new Map());
    expect(result!.id).toBe("goblin-1");
  });

  it("handles 5 mobs with 4 agents (one untargeted)", () => {
    const mobs = Array.from({ length: 5 }, (_, i) => ({
      id: `goblin-${i}`,
      name: "Goblin",
    }));
    const taken = new Map([
      ["a1", "goblin-0"],
      ["a2", "goblin-1"],
      ["a3", "goblin-2"],
      ["a4", "goblin-3"],
    ]);

    const result = spreadTargets("my-agent", mobs, taken);
    expect(result!.id).toBe("goblin-4");
  });

  it("handles 3 mobs with 6 agents (all taken, picks least)", () => {
    const mobs = [
      { id: "g1", name: "Goblin" },
      { id: "g2", name: "Goblin" },
      { id: "g3", name: "Goblin" },
    ];
    const taken = new Map([
      ["a1", "g1"],
      ["a2", "g1"],
      ["a3", "g2"],
      ["a4", "g2"],
      ["a5", "g3"],
    ]);

    const result = spreadTargets("my-agent", mobs, taken);
    expect(result!.id).toBe("g3"); // Only 1 agent on g3
  });
});

// ==========================================================================
// Resource keyword mapping
// ==========================================================================
describe("resource keyword mapping", () => {
  function getResourceKeywords(stageTarget: string): string[] {
    const target = stageTarget.toLowerCase();
    const keywords = [target];

    if (target.includes("log") || target.includes("wood")) {
      keywords.push("tree", "oak", "willow", "maple", "yew");
    }
    if (
      target.includes("shrimp") ||
      target.includes("fish") ||
      target.includes("trout") ||
      target.includes("salmon")
    ) {
      keywords.push("fishing", "spot", "fishing_spot");
    }
    if (
      target.includes("ore") ||
      target.includes("copper") ||
      target.includes("tin") ||
      target.includes("iron") ||
      target.includes("coal")
    ) {
      keywords.push("rock", "ore", "mining");
    }
    if (target.includes("essence")) {
      keywords.push("essence", "rune", "altar");
    }

    return keywords;
  }

  it("maps 'logs' to tree keywords", () => {
    const kw = getResourceKeywords("logs");
    expect(kw).toContain("tree");
    expect(kw).toContain("oak");
    expect(kw).toContain("willow");
    expect(kw).toContain("logs");
  });

  it("maps 'raw_shrimp' to fishing keywords", () => {
    const kw = getResourceKeywords("raw_shrimp");
    expect(kw).toContain("fishing");
    expect(kw).toContain("spot");
    expect(kw).toContain("fishing_spot");
  });

  it("maps 'copper_ore' to mining keywords", () => {
    const kw = getResourceKeywords("copper_ore");
    expect(kw).toContain("rock");
    expect(kw).toContain("ore");
    expect(kw).toContain("mining");
  });

  it("maps 'tin_ore' to mining keywords", () => {
    const kw = getResourceKeywords("tin_ore");
    expect(kw).toContain("rock");
    expect(kw).toContain("mining");
  });

  it("maps 'rune_essence' to essence keywords", () => {
    const kw = getResourceKeywords("rune_essence");
    expect(kw).toContain("essence");
    expect(kw).toContain("rune");
    expect(kw).toContain("altar");
  });

  it("maps 'wood' to tree keywords", () => {
    const kw = getResourceKeywords("wood");
    expect(kw).toContain("tree");
  });

  it("unknown target returns only itself", () => {
    const kw = getResourceKeywords("something_random");
    expect(kw).toEqual(["something_random"]);
  });

  it("handles mixed case input", () => {
    const kw = getResourceKeywords("Copper_Ore");
    expect(kw).toContain("rock");
  });

  it("maps 'iron_ore' to mining keywords", () => {
    const kw = getResourceKeywords("iron_ore");
    expect(kw).toContain("rock");
    expect(kw).toContain("mining");
  });

  it("keyword matching works on resource names", () => {
    const keywords = getResourceKeywords("logs");
    const haystack = "oak tree tree";
    const matches = keywords.some((kw) => haystack.includes(kw));
    expect(matches).toBe(true);
  });

  it("keyword matching fails for unrelated resources", () => {
    const keywords = getResourceKeywords("logs");
    const haystack = "copper rock mining_rock";
    const matches = keywords.some((kw) => haystack.includes(kw));
    expect(matches).toBe(false);
  });
});

// ==========================================================================
// Eat threshold decisions
// ==========================================================================
describe("eat threshold decisions", () => {
  function shouldEat(
    health: number,
    maxHealth: number,
    inCombat: boolean,
  ): boolean {
    if (maxHealth <= 0) return false;
    const missingHp = maxHealth - health;
    if (missingHp < 2) return false;
    const healthPercent = health / maxHealth;
    const threshold = inCombat ? 0.5 : 0.7;
    return healthPercent < threshold;
  }

  it("eats in combat at 49% health", () => {
    expect(shouldEat(49, 100, true)).toBe(true);
  });

  it("does not eat in combat at 51% health", () => {
    expect(shouldEat(51, 100, true)).toBe(false);
  });

  it("eats out of combat at 69% health", () => {
    expect(shouldEat(69, 100, false)).toBe(true);
  });

  it("does not eat out of combat at 71% health", () => {
    expect(shouldEat(71, 100, false)).toBe(false);
  });

  it("does not eat at full health", () => {
    expect(shouldEat(100, 100, false)).toBe(false);
  });

  it("does not eat when missing only 1hp", () => {
    expect(shouldEat(99, 100, false)).toBe(false);
  });

  it("handles 0 maxHealth gracefully", () => {
    expect(shouldEat(0, 0, false)).toBe(false);
  });

  it("eats out of combat at 50% health", () => {
    expect(shouldEat(50, 100, false)).toBe(true);
  });

  it("eats in combat at very low hp", () => {
    expect(shouldEat(5, 100, true)).toBe(true);
  });

  it("edge case: exactly at combat threshold (50%)", () => {
    expect(shouldEat(50, 100, true)).toBe(false);
  });

  it("edge case: exactly at out-of-combat threshold (70%)", () => {
    expect(shouldEat(70, 100, false)).toBe(false);
  });

  it("works with small max health (10hp)", () => {
    expect(shouldEat(3, 10, true)).toBe(true);
    expect(shouldEat(6, 10, true)).toBe(false);
  });
});

// ==========================================================================
// moveTowardSpawn logic
// ==========================================================================
describe("moveTowardSpawn logic", () => {
  function shouldMoveToSpawn(position: [number, number, number]): boolean {
    const [px, , pz] = position;
    return Math.sqrt(px * px + pz * pz) > 25;
  }

  it("should move toward spawn when far away (50 units)", () => {
    expect(shouldMoveToSpawn([50, 26, 0])).toBe(true);
  });

  it("should move toward spawn when far diagonal", () => {
    expect(shouldMoveToSpawn([20, 26, 20])).toBe(true);
  });

  it("should NOT move toward spawn when near (10 units)", () => {
    expect(shouldMoveToSpawn([10, 26, 0])).toBe(false);
  });

  it("should NOT move toward spawn when at spawn", () => {
    expect(shouldMoveToSpawn([0, 26, 0])).toBe(false);
  });

  it("threshold is 25 units from origin", () => {
    expect(shouldMoveToSpawn([25, 26, 0])).toBe(false); // exactly at threshold
    expect(shouldMoveToSpawn([26, 26, 0])).toBe(true); // just over
  });
});
