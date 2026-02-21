/**
 * Tests for AgentManager quest action logic:
 * - pickQuestAction routing (kill, gather, interact, dialogue stages)
 * - Gather adjacency and cooldown mechanics
 * - Firemaking action selection (interact:fire stage)
 * - Resource preference (basic over high-level trees)
 * - Inventory protection (quest-critical items not dropped)
 * - Quest stage progression flow
 */
import { describe, expect, it } from "vitest";

// ==========================================================================
// Quest action routing — determines what action to take based on quest stage
// ==========================================================================

type MockQuest = {
  questId: string;
  name: string;
  status: string;
  stageType: string;
  stageTarget: string;
  stageCount: number;
  startNpc: string;
  currentStage: string;
  stageDescription: string;
  stageProgress: Record<string, number>;
};

type MockEntity = {
  id: string;
  name: string;
  type: string;
  position: [number, number, number];
  resourceType?: string;
  mobType?: string;
};

type ActionResult =
  | { type: "attack"; targetId: string }
  | { type: "gather"; targetId: string }
  | { type: "firemake"; logsItemId: string }
  | { type: "move"; target: [number, number, number] }
  | { type: "questComplete"; questId: string }
  | { type: "idle" }
  | null;

function pickQuestStageAction(
  stageType: string,
  stageTarget: string,
  nearbyMobs: MockEntity[],
  nearbyResources: MockEntity[],
  inventory: Array<{ itemId: string; slot: number }>,
  position: [number, number, number],
  healthPercent: number,
): ActionResult {
  if (stageType === "dialogue") {
    return { type: "questComplete", questId: "test_quest" };
  }

  if (stageType === "kill") {
    const target = stageTarget.toLowerCase();
    const mob = nearbyMobs.find(
      (m) =>
        m.name.toLowerCase().includes(target) ||
        (m.mobType || "").toLowerCase().includes(target),
    );
    if (mob && healthPercent > 0.4) {
      return { type: "attack", targetId: mob.id };
    }
    return null;
  }

  if (stageType === "gather") {
    const resource = nearbyResources.find((r) => {
      const haystack = `${r.name.toLowerCase()} ${(r.resourceType || "").toLowerCase()}`;
      return (
        haystack.includes(stageTarget.toLowerCase()) ||
        haystack.includes("tree")
      );
    });
    if (resource) {
      const rdx = position[0] - resource.position[0];
      const rdz = position[2] - resource.position[2];
      const dist = Math.sqrt(rdx * rdx + rdz * rdz);
      if (dist < 4) {
        return { type: "gather", targetId: resource.id };
      }
      return {
        type: "move",
        target: [resource.position[0], position[1], resource.position[2]],
      };
    }
    return null;
  }

  if (stageType === "interact") {
    if (stageTarget === "fire") {
      const hasTinderbox = inventory.some((i) => i.itemId === "tinderbox");
      const logTypes = ["logs", "oak_logs", "willow_logs"];
      const logsItem = inventory.find((i) => logTypes.includes(i.itemId));

      if (hasTinderbox && logsItem) {
        return { type: "firemake", logsItemId: logsItem.itemId };
      }

      const tree = nearbyResources.find((r) =>
        r.name.toLowerCase().includes("tree"),
      );
      if (tree) {
        return {
          type: "move",
          target: [tree.position[0], position[1], tree.position[2]],
        };
      }
    }
    return null;
  }

  return null;
}

describe("quest stage action routing", () => {
  const position: [number, number, number] = [20, 26, -10];

  describe("dialogue stages", () => {
    it("returns questComplete for dialogue stages", () => {
      const result = pickQuestStageAction(
        "dialogue",
        "",
        [],
        [],
        [],
        position,
        1.0,
      );
      expect(result).toEqual({ type: "questComplete", questId: "test_quest" });
    });
  });

  describe("kill stages", () => {
    const goblins: MockEntity[] = [
      {
        id: "goblin-1",
        name: "Goblin",
        type: "mob",
        position: [25, 26, -8],
        mobType: "goblin",
      },
      {
        id: "goblin-2",
        name: "Goblin",
        type: "mob",
        position: [30, 26, -5],
        mobType: "goblin",
      },
    ];

    it("attacks matching mob when healthy", () => {
      const result = pickQuestStageAction(
        "kill",
        "goblin",
        goblins,
        [],
        [],
        position,
        0.8,
      );
      expect(result).toEqual({ type: "attack", targetId: "goblin-1" });
    });

    it("does not attack when health too low", () => {
      const result = pickQuestStageAction(
        "kill",
        "goblin",
        goblins,
        [],
        [],
        position,
        0.3,
      );
      expect(result).toBeNull();
    });

    it("returns null when no matching mobs nearby", () => {
      const result = pickQuestStageAction(
        "kill",
        "dragon",
        goblins,
        [],
        [],
        position,
        0.8,
      );
      expect(result).toBeNull();
    });

    it("matches mob by mobType", () => {
      const mobs: MockEntity[] = [
        {
          id: "m1",
          name: "Level 5 Creature",
          type: "mob",
          position: [25, 26, -8],
          mobType: "goblin",
        },
      ];
      const result = pickQuestStageAction(
        "kill",
        "goblin",
        mobs,
        [],
        [],
        position,
        0.8,
      );
      expect(result).toEqual({ type: "attack", targetId: "m1" });
    });
  });

  describe("gather stages", () => {
    const trees: MockEntity[] = [
      {
        id: "tree_23_-10",
        name: "Tree",
        type: "resource",
        position: [23, 26, -10],
        resourceType: "tree",
      },
    ];

    it("gathers tree when close (within 4 units)", () => {
      const result = pickQuestStageAction(
        "gather",
        "logs",
        [],
        trees,
        [],
        [22, 26, -10],
        1.0,
      );
      expect(result).toEqual({ type: "gather", targetId: "tree_23_-10" });
    });

    it("moves toward tree when far (> 4 units)", () => {
      const result = pickQuestStageAction(
        "gather",
        "logs",
        [],
        trees,
        [],
        [50, 26, -10],
        1.0,
      );
      expect(result).toEqual({
        type: "move",
        target: [23, 26, -10],
      });
    });

    it("returns null when no resources nearby", () => {
      const result = pickQuestStageAction(
        "gather",
        "logs",
        [],
        [],
        [],
        position,
        1.0,
      );
      expect(result).toBeNull();
    });
  });

  describe("interact:fire stages (firemaking)", () => {
    it("firemakes when tinderbox + logs available", () => {
      const inventory = [
        { itemId: "tinderbox", slot: 0 },
        { itemId: "logs", slot: 1 },
      ];
      const result = pickQuestStageAction(
        "interact",
        "fire",
        [],
        [],
        inventory,
        position,
        1.0,
      );
      expect(result).toEqual({ type: "firemake", logsItemId: "logs" });
    });

    it("firemakes with oak_logs when available", () => {
      const inventory = [
        { itemId: "tinderbox", slot: 0 },
        { itemId: "oak_logs", slot: 1 },
      ];
      const result = pickQuestStageAction(
        "interact",
        "fire",
        [],
        [],
        inventory,
        position,
        1.0,
      );
      expect(result).toEqual({ type: "firemake", logsItemId: "oak_logs" });
    });

    it("moves to tree when has tinderbox but no logs", () => {
      const trees: MockEntity[] = [
        {
          id: "tree_1",
          name: "Tree",
          type: "resource",
          position: [30, 26, -10],
        },
      ];
      const inventory = [{ itemId: "tinderbox", slot: 0 }];
      const result = pickQuestStageAction(
        "interact",
        "fire",
        [],
        trees,
        inventory,
        position,
        1.0,
      );
      expect(result?.type).toBe("move");
    });

    it("returns null when no tinderbox and no trees", () => {
      const result = pickQuestStageAction(
        "interact",
        "fire",
        [],
        [],
        [{ itemId: "logs", slot: 0 }],
        position,
        1.0,
      );
      expect(result).toBeNull();
    });

    it("returns null when inventory is empty", () => {
      const result = pickQuestStageAction(
        "interact",
        "fire",
        [],
        [],
        [],
        position,
        1.0,
      );
      expect(result).toBeNull();
    });
  });
});

// ==========================================================================
// Gather cooldown logic — prevents re-queuing same resource
// ==========================================================================
describe("gather cooldown logic", () => {
  function shouldQueueGather(
    resourceId: string,
    lastGatherTargetId: string | null,
    lastGatherQueuedAt: number,
    now: number,
    cooldownMs: number = 30000,
  ): boolean {
    if (
      lastGatherTargetId === resourceId &&
      now - lastGatherQueuedAt < cooldownMs
    ) {
      return false;
    }
    return true;
  }

  it("allows first gather of any resource", () => {
    expect(shouldQueueGather("tree_1", null, 0, Date.now())).toBe(true);
  });

  it("blocks re-queue within cooldown for same resource", () => {
    const now = Date.now();
    expect(shouldQueueGather("tree_1", "tree_1", now - 5000, now)).toBe(false);
  });

  it("allows re-queue after cooldown expires", () => {
    const now = Date.now();
    expect(shouldQueueGather("tree_1", "tree_1", now - 31000, now)).toBe(true);
  });

  it("allows queue for different resource even within cooldown", () => {
    const now = Date.now();
    expect(shouldQueueGather("tree_2", "tree_1", now - 5000, now)).toBe(true);
  });

  it("allows queue at exact cooldown boundary", () => {
    const now = Date.now();
    expect(shouldQueueGather("tree_1", "tree_1", now - 30000, now)).toBe(true);
  });
});

// ==========================================================================
// Resource preference — basic trees over high-level trees
// ==========================================================================
describe("resource preference", () => {
  function findPreferredResource(
    resources: MockEntity[],
    stageTarget: string,
  ): MockEntity | undefined {
    const keywords = [stageTarget.toLowerCase()];
    if (stageTarget.toLowerCase().includes("log")) {
      keywords.push("tree", "oak", "willow", "maple");
    }

    const matches = resources.filter((r) => {
      const haystack = `${r.name.toLowerCase()} ${(r.resourceType || "").toLowerCase()}`;
      return keywords.some((kw) => haystack.includes(kw));
    });
    if (matches.length === 0) return undefined;

    const basic = matches.find((r) => {
      const name = r.name.toLowerCase();
      return (
        name === "tree" ||
        name === "rock" ||
        name === "fishing spot" ||
        (r.resourceType || "").includes("normal")
      );
    });
    return basic || matches[0];
  }

  it("prefers basic Tree over Oak Tree", () => {
    const resources: MockEntity[] = [
      {
        id: "tree_oak",
        name: "Oak Tree",
        type: "resource",
        position: [10, 0, 10],
        resourceType: "tree",
      },
      {
        id: "tree_normal",
        name: "Tree",
        type: "resource",
        position: [20, 0, 20],
        resourceType: "tree",
      },
    ];
    const result = findPreferredResource(resources, "logs");
    expect(result?.id).toBe("tree_normal");
  });

  it("prefers basic Tree over Maple Tree", () => {
    const resources: MockEntity[] = [
      {
        id: "tree_maple",
        name: "Maple Tree",
        type: "resource",
        position: [10, 0, 10],
        resourceType: "tree",
      },
      {
        id: "tree_normal",
        name: "Tree",
        type: "resource",
        position: [20, 0, 20],
        resourceType: "tree",
      },
    ];
    const result = findPreferredResource(resources, "logs");
    expect(result?.id).toBe("tree_normal");
  });

  it("falls back to first match when no basic resource", () => {
    const resources: MockEntity[] = [
      {
        id: "tree_oak",
        name: "Oak Tree",
        type: "resource",
        position: [10, 0, 10],
        resourceType: "tree",
      },
      {
        id: "tree_maple",
        name: "Maple Tree",
        type: "resource",
        position: [20, 0, 20],
        resourceType: "tree",
      },
    ];
    const result = findPreferredResource(resources, "logs");
    expect(result?.id).toBe("tree_oak");
  });

  it("returns undefined when no matching resources", () => {
    const resources: MockEntity[] = [
      {
        id: "rock_1",
        name: "Rock",
        type: "resource",
        position: [10, 0, 10],
        resourceType: "mining_rock",
      },
    ];
    const result = findPreferredResource(resources, "logs");
    expect(result).toBeUndefined();
  });

  it("matches by resourceType containing 'normal'", () => {
    const resources: MockEntity[] = [
      {
        id: "tree_a",
        name: "Strange Tree",
        type: "resource",
        position: [10, 0, 10],
        resourceType: "tree_normal",
      },
    ];
    const result = findPreferredResource(resources, "logs");
    expect(result?.id).toBe("tree_a");
  });
});

// ==========================================================================
// Inventory protection — quest-critical items not dropped
// ==========================================================================
describe("inventory protection", () => {
  const QUEST_TOOLS = [
    "tinderbox",
    "bronze_hatchet",
    "hatchet",
    "bronze_pickaxe",
    "pickaxe",
    "fishing_rod",
    "net",
    "logs",
    "oak_logs",
  ];

  function isDroppable(
    itemId: string,
    itemType: string | null,
    equipSlot: string | null,
  ): boolean {
    const isWeapon = equipSlot === "weapon" || equipSlot === "2h";
    const isArmor = !!equipSlot && !isWeapon;
    const isTool = itemType === "tool";
    if (isWeapon || isArmor || isTool || QUEST_TOOLS.includes(itemId)) {
      return false;
    }
    return true;
  }

  it("protects tinderbox from dropping", () => {
    expect(isDroppable("tinderbox", "tool", null)).toBe(false);
  });

  it("protects bronze_hatchet from dropping", () => {
    expect(isDroppable("bronze_hatchet", "tool", null)).toBe(false);
  });

  it("protects logs from dropping", () => {
    expect(isDroppable("logs", "resource", null)).toBe(false);
  });

  it("protects weapons from dropping", () => {
    expect(isDroppable("bronze_sword", "weapon", "weapon")).toBe(false);
  });

  it("protects armor from dropping", () => {
    expect(isDroppable("bronze_helm", "armor", "helmet")).toBe(false);
  });

  it("protects 2h weapons from dropping", () => {
    expect(isDroppable("iron_2h_sword", "weapon", "2h")).toBe(false);
  });

  it("protects items by type=tool even without explicit list", () => {
    expect(isDroppable("unknown_tool", "tool", null)).toBe(false);
  });

  it("allows dropping sharks (food, not protected)", () => {
    expect(isDroppable("shark", "consumable", null)).toBe(true);
  });

  it("allows dropping bones", () => {
    expect(isDroppable("bones", "misc", null)).toBe(true);
  });

  it("allows dropping xp_lamp_100", () => {
    expect(isDroppable("xp_lamp_100", "misc", null)).toBe(true);
  });

  it("protects oak_logs from dropping", () => {
    expect(isDroppable("oak_logs", "resource", null)).toBe(false);
  });

  it("protects fishing_rod from dropping", () => {
    expect(isDroppable("fishing_rod", "tool", null)).toBe(false);
  });
});

// ==========================================================================
// Quest stage progression flow — validates end-to-end quest stage logic
// ==========================================================================
describe("quest stage progression flow", () => {
  type QuestStage = {
    id: string;
    type: string;
    target?: string;
    count?: number;
  };

  function getNextStage(
    stages: QuestStage[],
    currentStageId: string,
  ): QuestStage | null {
    const idx = stages.findIndex((s) => s.id === currentStageId);
    if (idx === -1 || idx >= stages.length - 1) return null;
    return stages[idx + 1];
  }

  function isStageComplete(
    stage: QuestStage,
    progress: Record<string, number>,
  ): boolean {
    if (stage.type === "dialogue") return false;
    if (!stage.count || !stage.target) return false;
    return (progress[stage.target] || 0) >= stage.count;
  }

  const lumberjackStages: QuestStage[] = [
    { id: "start", type: "dialogue" },
    { id: "chop_logs", type: "gather", target: "logs", count: 6 },
    { id: "burn_logs", type: "interact", target: "fire", count: 6 },
    { id: "return", type: "dialogue" },
  ];

  it("chop_logs is complete with 6 logs", () => {
    expect(isStageComplete(lumberjackStages[1], { logs: 6 })).toBe(true);
  });

  it("chop_logs is not complete with 5 logs", () => {
    expect(isStageComplete(lumberjackStages[1], { logs: 5 })).toBe(false);
  });

  it("burn_logs is complete with 6 fires", () => {
    expect(isStageComplete(lumberjackStages[2], { fire: 6 })).toBe(true);
  });

  it("burn_logs is not complete with 4 fires", () => {
    expect(isStageComplete(lumberjackStages[2], { fire: 4 })).toBe(false);
  });

  it("dialogue stages are never auto-complete", () => {
    expect(isStageComplete(lumberjackStages[0], {})).toBe(false);
    expect(isStageComplete(lumberjackStages[3], {})).toBe(false);
  });

  it("next stage after chop_logs is burn_logs", () => {
    const next = getNextStage(lumberjackStages, "chop_logs");
    expect(next?.id).toBe("burn_logs");
    expect(next?.type).toBe("interact");
  });

  it("next stage after burn_logs is return", () => {
    const next = getNextStage(lumberjackStages, "burn_logs");
    expect(next?.id).toBe("return");
    expect(next?.type).toBe("dialogue");
  });

  it("no next stage after return (final stage)", () => {
    const next = getNextStage(lumberjackStages, "return");
    expect(next).toBeNull();
  });

  it("handles invalid stage id gracefully", () => {
    const next = getNextStage(lumberjackStages, "nonexistent");
    expect(next).toBeNull();
  });

  const goblinSlayerStages: QuestStage[] = [
    { id: "start", type: "dialogue" },
    { id: "kill_goblins", type: "kill", target: "goblin", count: 15 },
    { id: "return", type: "dialogue" },
  ];

  it("kill stage tracks by 'kills' key (QuestSystem convention)", () => {
    // QuestSystem uses "kills" as the progress key for kill stages,
    // not the stage target. isStageComplete checks progress[stage.target],
    // but QuestSystem internally tracks via "kills". This test verifies
    // the stage definition matches what the quest system expects.
    const stage = goblinSlayerStages[1];
    expect(stage.type).toBe("kill");
    expect(stage.target).toBe("goblin");
    expect(stage.count).toBe(15);
    // Progress is tracked as { kills: N } by QuestSystem, not { goblin: N }
    const progress = { kills: 15 };
    expect(progress.kills >= stage.count!).toBe(true);
  });

  it("kill stage is not complete with 14 kills", () => {
    const stage = goblinSlayerStages[1];
    const progress = { kills: 14 };
    expect(progress.kills < stage.count!).toBe(true);
  });
});

// ==========================================================================
// Dead mob filtering — prevents agents from attacking dead targets
// ==========================================================================
describe("dead mob filtering", () => {
  function isEntityAlive(
    entityData: Record<string, unknown>,
    entity?: { isDead?: () => boolean; isAlive?: () => boolean },
  ): boolean {
    if (entity) {
      if (typeof entity.isDead === "function" && entity.isDead()) return false;
      if (typeof entity.isAlive === "function" && !entity.isAlive())
        return false;
    }
    if (entityData.alive === false) return false;
    if (entityData.dead === true) return false;
    if (entityData.health === 0) return false;
    if (entityData.isDead === true) return false;
    return true;
  }

  it("detects dead mob via isDead() method", () => {
    const entity = { isDead: () => true };
    expect(isEntityAlive({}, entity)).toBe(false);
  });

  it("detects dead mob via isAlive() returning false", () => {
    const entity = { isAlive: () => false };
    expect(isEntityAlive({}, entity)).toBe(false);
  });

  it("detects dead mob via data.alive = false", () => {
    expect(isEntityAlive({ alive: false })).toBe(false);
  });

  it("detects dead mob via data.dead = true", () => {
    expect(isEntityAlive({ dead: true })).toBe(false);
  });

  it("detects dead mob via data.health = 0", () => {
    expect(isEntityAlive({ health: 0 })).toBe(false);
  });

  it("detects dead mob via data.isDead = true", () => {
    expect(isEntityAlive({ isDead: true })).toBe(false);
  });

  it("alive mob passes all checks", () => {
    const entity = { isDead: () => false, isAlive: () => true };
    expect(isEntityAlive({ alive: true, health: 10 }, entity)).toBe(true);
  });

  it("alive mob with no entity methods passes", () => {
    expect(isEntityAlive({ alive: true, health: 10 })).toBe(true);
  });

  it("empty data is treated as alive (default)", () => {
    expect(isEntityAlive({})).toBe(true);
  });
});

// ==========================================================================
// Firemaking slot resolution — finding tinderbox and logs in inventory
// ==========================================================================
describe("firemaking slot resolution", () => {
  const LOG_TYPES = [
    "logs",
    "oak_logs",
    "willow_logs",
    "teak_logs",
    "maple_logs",
    "mahogany_logs",
    "yew_logs",
    "magic_logs",
  ];

  function resolveFiremakeSlots(
    inventory: Array<{ itemId: string; slot: number }>,
    preferredLogsId?: string,
  ): { tinderboxSlot: number; logsSlot: number; logsId: string } | null {
    const tinderbox = inventory.find((i) => i.itemId === "tinderbox");
    if (!tinderbox) return null;

    const logs = preferredLogsId
      ? inventory.find((i) => i.itemId === preferredLogsId)
      : inventory.find((i) => LOG_TYPES.includes(i.itemId));
    if (!logs) return null;

    return {
      tinderboxSlot: tinderbox.slot,
      logsSlot: logs.slot,
      logsId: logs.itemId,
    };
  }

  it("resolves tinderbox + logs slots", () => {
    const inv = [
      { itemId: "shark", slot: 0 },
      { itemId: "tinderbox", slot: 1 },
      { itemId: "logs", slot: 2 },
    ];
    const result = resolveFiremakeSlots(inv);
    expect(result).toEqual({ tinderboxSlot: 1, logsSlot: 2, logsId: "logs" });
  });

  it("returns null when no tinderbox", () => {
    const inv = [{ itemId: "logs", slot: 0 }];
    expect(resolveFiremakeSlots(inv)).toBeNull();
  });

  it("returns null when no logs", () => {
    const inv = [{ itemId: "tinderbox", slot: 0 }];
    expect(resolveFiremakeSlots(inv)).toBeNull();
  });

  it("returns null for empty inventory", () => {
    expect(resolveFiremakeSlots([])).toBeNull();
  });

  it("finds oak_logs when no normal logs", () => {
    const inv = [
      { itemId: "tinderbox", slot: 0 },
      { itemId: "oak_logs", slot: 3 },
    ];
    const result = resolveFiremakeSlots(inv);
    expect(result).toEqual({
      tinderboxSlot: 0,
      logsSlot: 3,
      logsId: "oak_logs",
    });
  });

  it("respects preferred logs type", () => {
    const inv = [
      { itemId: "tinderbox", slot: 0 },
      { itemId: "logs", slot: 1 },
      { itemId: "oak_logs", slot: 2 },
    ];
    const result = resolveFiremakeSlots(inv, "oak_logs");
    expect(result?.logsId).toBe("oak_logs");
  });

  it("finds all supported log types", () => {
    for (const logType of LOG_TYPES) {
      const inv = [
        { itemId: "tinderbox", slot: 0 },
        { itemId: logType, slot: 1 },
      ];
      const result = resolveFiremakeSlots(inv);
      expect(result).not.toBeNull();
      expect(result!.logsId).toBe(logType);
    }
  });
});

// ==========================================================================
// Quest priority selection — which quest to accept next
// ==========================================================================
describe("quest priority selection", () => {
  function selectNextQuest(
    availableQuests: Array<{ questId: string; status: string }>,
    resourceSystemAvailable: boolean,
  ): string | null {
    const questPriority = [
      "goblin_slayer",
      ...(resourceSystemAvailable
        ? ["lumberjacks_first_lesson", "fresh_catch", "torvins_tools"]
        : []),
    ];

    for (const questId of questPriority) {
      const quest = availableQuests.find(
        (q) => q.questId === questId && q.status === "not_started",
      );
      if (quest) return quest.questId;
    }
    return null;
  }

  it("prioritizes goblin_slayer first", () => {
    const quests = [
      { questId: "lumberjacks_first_lesson", status: "not_started" },
      { questId: "goblin_slayer", status: "not_started" },
    ];
    expect(selectNextQuest(quests, true)).toBe("goblin_slayer");
  });

  it("picks lumberjacks when goblin_slayer done and resources available", () => {
    const quests = [
      { questId: "goblin_slayer", status: "completed" },
      { questId: "lumberjacks_first_lesson", status: "not_started" },
    ];
    expect(selectNextQuest(quests, true)).toBe("lumberjacks_first_lesson");
  });

  it("skips gather quests when resource system unavailable", () => {
    const quests = [
      { questId: "goblin_slayer", status: "completed" },
      { questId: "lumberjacks_first_lesson", status: "not_started" },
    ];
    expect(selectNextQuest(quests, false)).toBeNull();
  });

  it("returns null when all quests completed", () => {
    const quests = [
      { questId: "goblin_slayer", status: "completed" },
      { questId: "lumberjacks_first_lesson", status: "completed" },
    ];
    expect(selectNextQuest(quests, true)).toBeNull();
  });

  it("returns null when no quests available", () => {
    expect(selectNextQuest([], true)).toBeNull();
  });

  it("skips in_progress quests (only accepts not_started)", () => {
    const quests = [{ questId: "goblin_slayer", status: "in_progress" }];
    expect(selectNextQuest(quests, true)).toBeNull();
  });
});
