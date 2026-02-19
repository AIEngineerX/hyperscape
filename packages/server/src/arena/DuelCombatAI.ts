/**
 * DuelCombatAI - Tick-based PvP combat controller for embedded agents
 *
 * Takes over an agent's behavior during arena duels. Uses
 * EmbeddedHyperscapeService directly for game actions (executeAttack,
 * executeUse). Reads game state each tick and makes priority-based
 * combat decisions: heal, attack, or switch style.
 *
 * Lifecycle:
 *   ArenaService creates DuelCombatAI when a duel starts.
 *   DuelCombatAI.start() begins ticking at COMBAT_TICK_MS (600ms).
 *   ArenaService calls DuelCombatAI.stop() when the duel ends.
 */

import { TICK_DURATION_MS } from "@hyperscape/shared";
import type { EmbeddedHyperscapeService } from "../eliza/EmbeddedHyperscapeService";
import type { EmbeddedGameState } from "../eliza/types";
import { type AgentRuntime, ModelType } from "@elizaos/core";

export interface DuelCombatConfig {
  healThresholdPct: number;
  aggressiveThresholdPct: number;
  defensiveThresholdPct: number;
  maxTicksWithoutAttack: number;
  useLlmTactics: boolean;
}

const DEFAULT_CONFIG: DuelCombatConfig = {
  healThresholdPct: 40,
  aggressiveThresholdPct: 70,
  defensiveThresholdPct: 30,
  maxTicksWithoutAttack: 5,
  useLlmTactics: false,
};

type CombatPhase = "opening" | "trading" | "finishing" | "desperate";

const FOOD_PATTERNS = [
  "shrimp",
  "trout",
  "salmon",
  "lobster",
  "swordfish",
  "shark",
  "monkfish",
  "bread",
  "meat",
  "cooked",
  "fish",
  "pie",
  "cake",
  "stew",
  "potato",
  "tuna",
  "bass",
  "karambwan",
  "manta",
  "anglerfish",
];

const POTION_PATTERNS = [
  "potion",
  "brew",
  "restore",
  "prayer",
  "super",
  "ranging",
  "magic",
  "antifire",
  "antidote",
  "stamina",
];

export class DuelCombatAI {
  private service: EmbeddedHyperscapeService;
  private runtime: AgentRuntime | null;
  private opponentId: string;
  private config: DuelCombatConfig;

  private tickTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private tickCount = 0;
  private ticksSinceLastAttack = 0;
  private lastHealthPct = 100;
  private opponentLastHealthPct = 100;
  private totalDamageDealt = 0;
  private totalDamageReceived = 0;
  private healsUsed = 0;
  private attacksLanded = 0;
  private activePrayers: Set<string> = new Set();
  private currentStyle: string = "accurate";

  constructor(
    service: EmbeddedHyperscapeService,
    opponentId: string,
    config?: Partial<DuelCombatConfig>,
    runtime?: AgentRuntime,
  ) {
    this.service = service;
    this.opponentId = opponentId;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.runtime = runtime ?? null;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.tickCount = 0;
    this.ticksSinceLastAttack = 0;
    this.totalDamageDealt = 0;
    this.totalDamageReceived = 0;
    this.healsUsed = 0;
    this.attacksLanded = 0;

    console.log(`[DuelCombatAI] Started combat against ${this.opponentId}`);

    this.tickTimer = setInterval(() => {
      this.tick().catch((err) => {
        console.error(
          "[DuelCombatAI] Tick error:",
          err instanceof Error ? err.message : String(err),
        );
      });
    }, TICK_DURATION_MS);
  }

  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    console.log(
      `[DuelCombatAI] Stopped after ${this.tickCount} ticks. ` +
        `Attacks: ${this.attacksLanded}, Heals: ${this.healsUsed}, ` +
        `Dmg dealt: ${this.totalDamageDealt}, Dmg received: ${this.totalDamageReceived}`,
    );
  }

  getStats(): {
    tickCount: number;
    attacksLanded: number;
    healsUsed: number;
    totalDamageDealt: number;
    totalDamageReceived: number;
  } {
    return {
      tickCount: this.tickCount,
      attacksLanded: this.attacksLanded,
      healsUsed: this.healsUsed,
      totalDamageDealt: this.totalDamageDealt,
      totalDamageReceived: this.totalDamageReceived,
    };
  }

  private async tick(): Promise<void> {
    if (!this.isRunning) return;
    this.tickCount++;

    const state = this.service.getGameState();
    if (!state) return;
    if (!state.alive) {
      this.stop();
      return;
    }

    const healthPct =
      state.maxHealth > 0 ? (state.health / state.maxHealth) * 100 : 100;

    const damageThisTick = this.lastHealthPct - healthPct;
    if (damageThisTick > 0) {
      this.totalDamageReceived += Math.round(
        (damageThisTick / 100) * state.maxHealth,
      );
    }
    this.lastHealthPct = healthPct;

    const opponentData = this.getOpponentData(state);
    if (opponentData) {
      const oppHealthPct =
        opponentData.maxHealth && opponentData.maxHealth > 0
          ? (opponentData.health / opponentData.maxHealth) * 100
          : 100;
      const oppDamage = this.opponentLastHealthPct - oppHealthPct;
      if (oppDamage > 0 && opponentData.maxHealth) {
        this.totalDamageDealt += Math.round(
          (oppDamage / 100) * opponentData.maxHealth,
        );
      }
      this.opponentLastHealthPct = oppHealthPct;
    }

    const phase = this.determineCombatPhase(healthPct, opponentData);

    if (await this.tryHeal(state, healthPct, phase)) {
      this.healsUsed++;
      return;
    }

    if (await this.tryBuff(state, phase)) {
      return;
    }

    if (this.config.useLlmTactics && this.runtime && this.tickCount % 5 === 0) {
      await this.executeLlmTactic(state, healthPct, opponentData, phase);
    } else {
      await this.tryPrayerSwitch(phase);
      await this.tryStyleSwitch(healthPct, phase);
    }

    await this.tryAttack(state, phase);
  }

  private determineCombatPhase(
    healthPct: number,
    opponentData: OpponentData | null,
  ): CombatPhase {
    if (healthPct < this.config.defensiveThresholdPct) return "desperate";

    const oppHealthPct = opponentData
      ? opponentData.maxHealth && opponentData.maxHealth > 0
        ? (opponentData.health / opponentData.maxHealth) * 100
        : 100
      : 100;

    if (oppHealthPct < 25) return "finishing";
    if (this.tickCount < 5) return "opening";
    return "trading";
  }

  /**
   * Attempt to heal. Returns true if a heal action was taken.
   */
  private async tryHeal(
    state: EmbeddedGameState,
    healthPct: number,
    phase: CombatPhase,
  ): Promise<boolean> {
    const threshold =
      phase === "desperate"
        ? this.config.healThresholdPct + 15
        : this.config.healThresholdPct;

    if (healthPct >= threshold) return false;

    const food = this.findBestFood(state.inventory);
    if (!food) return false;

    try {
      await this.service.executeUse(food.itemId);
      return true;
    } catch (err) {
      console.debug(
        `[DuelCombatAI] Heal failed (${food.itemId}):`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Attempt to use a buff potion. Returns true if used.
   */
  private async tryBuff(
    state: EmbeddedGameState,
    phase: CombatPhase,
  ): Promise<boolean> {
    if (phase !== "opening" || this.tickCount > 2) return false;

    const potion = this.findPotion(state.inventory);
    if (!potion) return false;

    try {
      await this.service.executeUse(potion.itemId);
      return true;
    } catch (err) {
      console.debug(
        `[DuelCombatAI] Buff failed (${potion.itemId}):`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  /**
   * Ask the LLM for a tactical decision given current combat state.
   * Runs every ~3 seconds when useLlmTactics is enabled.
   */
  private async executeLlmTactic(
    state: EmbeddedGameState,
    healthPct: number,
    opponentData: OpponentData | null,
    phase: CombatPhase,
  ): Promise<void> {
    if (!this.runtime) return;

    const oppHpPct =
      opponentData && opponentData.maxHealth > 0
        ? ((opponentData.health / opponentData.maxHealth) * 100).toFixed(0)
        : "unknown";

    const foodCount = state.inventory.filter((i) =>
      FOOD_PATTERNS.some((p) => i.itemId.toLowerCase().includes(p)),
    ).length;

    const prompt = [
      `You are in a PvP duel. Choose ONE tactic.`,
      `Your HP: ${healthPct.toFixed(0)}% | Opponent HP: ${oppHpPct}%`,
      `Phase: ${phase} | Food left: ${foodCount} | Tick: ${this.tickCount}`,
      `Options: AGGRESSIVE (max damage), DEFENSIVE (reduce damage taken), PRAYER_OFFENSE (activate strength prayer), PRAYER_DEFENSE (activate defense prayer), CONTROLLED (balanced)`,
      `Reply with ONLY the tactic name.`,
    ].join("\n");

    try {
      const response = await this.runtime.useModel(ModelType.TEXT_SMALL, {
        prompt,
        maxTokens: 20,
        temperature: 0.3,
      });

      const tactic = (typeof response === "string" ? response : "")
        .trim()
        .toUpperCase();

      switch (tactic) {
        case "AGGRESSIVE":
          await this.service.executeChangeStyle("aggressive");
          break;
        case "DEFENSIVE":
          await this.service.executeChangeStyle("defensive");
          await this.service.executePrayerToggle("steel_skin");
          break;
        case "PRAYER_OFFENSE":
          await this.service.executePrayerToggle("ultimate_strength");
          break;
        case "PRAYER_DEFENSE":
          await this.service.executePrayerToggle("steel_skin");
          break;
        case "CONTROLLED":
          await this.service.executeChangeStyle("controlled");
          break;
      }
    } catch (err) {
      console.debug(
        `[DuelCombatAI] LLM tactic failed, using scripted fallback:`,
        err instanceof Error ? err.message : String(err),
      );
      await this.tryPrayerSwitch(phase);
      await this.tryStyleSwitch(healthPct, phase);
    }
  }

  /**
   * Toggle combat prayers based on phase.
   * Opening: activate offensive prayer. Desperate: switch to defensive.
   */
  private async activatePrayer(prayerId: string): Promise<void> {
    if (this.activePrayers.has(prayerId)) return;
    const success = await this.service.executePrayerToggle(prayerId);
    if (success) this.activePrayers.add(prayerId);
  }

  private async deactivatePrayer(prayerId: string): Promise<void> {
    if (!this.activePrayers.has(prayerId)) return;
    const success = await this.service.executePrayerToggle(prayerId);
    if (success) this.activePrayers.delete(prayerId);
  }

  private async tryPrayerSwitch(phase: CombatPhase): Promise<void> {
    if (this.tickCount % 3 !== 0) return;

    try {
      if (phase === "opening" || phase === "finishing") {
        await this.activatePrayer("ultimate_strength");
        await this.deactivatePrayer("steel_skin");
      } else if (phase === "desperate") {
        await this.activatePrayer("steel_skin");
        await this.deactivatePrayer("ultimate_strength");
      } else {
        await this.activatePrayer("ultimate_strength");
      }
    } catch (err) {
      console.debug(
        `[DuelCombatAI] Prayer switch failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private async tryStyleSwitch(
    healthPct: number,
    phase: CombatPhase,
  ): Promise<void> {
    if (this.tickCount % 5 !== 0) return;

    let desiredStyle: string;
    if (phase === "finishing") {
      desiredStyle = "aggressive";
    } else if (phase === "desperate") {
      desiredStyle = "defensive";
    } else if (healthPct > this.config.aggressiveThresholdPct) {
      desiredStyle = "aggressive";
    } else {
      desiredStyle = "controlled";
    }

    if (desiredStyle === this.currentStyle) return;

    try {
      await this.service.executeChangeStyle(desiredStyle);
      this.currentStyle = desiredStyle;
    } catch (err) {
      console.debug(
        `[DuelCombatAI] Style switch failed:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  /**
   * Execute an attack against the opponent.
   */
  private async tryAttack(
    state: EmbeddedGameState,
    _phase: CombatPhase,
  ): Promise<void> {
    this.ticksSinceLastAttack++;

    if (!state.inCombat || state.currentTarget !== this.opponentId) {
      try {
        await this.service.executeAttack(this.opponentId);
        this.ticksSinceLastAttack = 0;
        this.attacksLanded++;
      } catch (err) {
        console.debug(
          `[DuelCombatAI] Attack failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
      return;
    }

    if (this.ticksSinceLastAttack > this.config.maxTicksWithoutAttack) {
      try {
        await this.service.executeAttack(this.opponentId);
        this.ticksSinceLastAttack = 0;
        this.attacksLanded++;
      } catch (err) {
        console.debug(
          `[DuelCombatAI] Re-engage attack failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
  }

  private getOpponentData(state: EmbeddedGameState): OpponentData | null {
    const opp = state.nearbyEntities.find((e) => e.id === this.opponentId);
    if (!opp) return null;
    return {
      health: opp.health ?? 0,
      maxHealth: opp.maxHealth ?? 0,
      distance: opp.distance,
    };
  }

  private static readonly FOOD_HEAL_VALUES: Record<string, number> = {
    shrimp: 3,
    bread: 5,
    meat: 3,
    trout: 7,
    salmon: 9,
    tuna: 10,
    lobster: 12,
    bass: 13,
    swordfish: 14,
    monkfish: 16,
    karambwan: 18,
    shark: 20,
    manta: 22,
    anglerfish: 22,
    pie: 6,
    cake: 12,
    stew: 11,
    potato: 14,
  };

  private findBestFood(
    inventory: EmbeddedGameState["inventory"],
  ): InventorySlot | null {
    let bestFood: InventorySlot | null = null;
    let bestHeal = -1;

    for (const item of inventory) {
      const name = (item.itemId || "").toLowerCase();
      if (!FOOD_PATTERNS.some((pattern) => name.includes(pattern))) continue;

      const heal = Object.entries(DuelCombatAI.FOOD_HEAL_VALUES).reduce(
        (best, [key, val]) => (name.includes(key) && val > best ? val : best),
        1,
      );

      if (heal > bestHeal) {
        bestHeal = heal;
        bestFood = item;
      }
    }

    return bestFood;
  }

  private findPotion(
    inventory: EmbeddedGameState["inventory"],
  ): InventorySlot | null {
    for (const item of inventory) {
      const name = (item.itemId || "").toLowerCase();
      if (POTION_PATTERNS.some((pattern) => name.includes(pattern))) {
        return item;
      }
    }
    return null;
  }
}

interface OpponentData {
  health: number;
  maxHealth: number;
  distance: number;
}

type InventorySlot = EmbeddedGameState["inventory"][number];
