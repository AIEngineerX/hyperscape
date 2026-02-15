/**
 * SpellService - Manages spell data and validation
 *
 * F2P Scope: Combat spells only (Strike and Bolt tiers)
 *
 * Responsibilities:
 * - Load and provide spell data from manifest
 * - Validate player can cast a spell (level check)
 * - Get available spells for a magic level
 */

import type { RuneRequirement } from "./RuneService";
import {
  COMBAT_SPELLS,
  SPELL_ORDER,
  type SpellData,
} from "../../../data/combat-spells";

/**
 * Spell definition — re-exported from data manifest for backwards compatibility
 */
export type Spell = SpellData;

/**
 * Result of spell validation
 */
export interface SpellValidationResult {
  valid: boolean;
  error?: string;
  errorCode?: "SPELL_NOT_FOUND" | "LEVEL_TOO_LOW" | "NO_SPELL_SELECTED";
}

/**
 * SpellService class for managing spell data
 */
export class SpellService {
  /**
   * Get a spell by ID
   *
   * @param spellId - The spell ID
   * @returns Spell data or undefined if not found
   */
  getSpell(spellId: string): Spell | undefined {
    return COMBAT_SPELLS[spellId];
  }

  /**
   * Get all available spells for a given magic level
   *
   * @param magicLevel - Player's magic level
   * @returns Array of available spells, sorted by level
   */
  getAvailableSpells(magicLevel: number): Spell[] {
    return SPELL_ORDER.filter(
      (id) => COMBAT_SPELLS[id].level <= magicLevel,
    ).map((id) => COMBAT_SPELLS[id]);
  }

  /**
   * Get all spells (for UI display)
   *
   * @returns All combat spells sorted by level
   */
  getAllSpells(): Spell[] {
    return SPELL_ORDER.map((id) => COMBAT_SPELLS[id]);
  }

  /**
   * Validate if a player can cast a spell (level check only)
   *
   * @param spellId - The spell ID to validate
   * @param magicLevel - Player's magic level
   * @returns Validation result
   */
  canCastSpell(
    spellId: string | null | undefined,
    magicLevel: number,
  ): SpellValidationResult {
    if (!spellId) {
      return {
        valid: false,
        error: "No spell selected",
        errorCode: "NO_SPELL_SELECTED",
      };
    }

    const spell = COMBAT_SPELLS[spellId];

    if (!spell) {
      return {
        valid: false,
        error: "Unknown spell",
        errorCode: "SPELL_NOT_FOUND",
      };
    }

    if (magicLevel < spell.level) {
      return {
        valid: false,
        error: `You need level ${spell.level} Magic to cast ${spell.name}`,
        errorCode: "LEVEL_TOO_LOW",
      };
    }

    return { valid: true };
  }

  /**
   * Check if a spell ID is valid
   */
  isValidSpell(spellId: string): boolean {
    return spellId in COMBAT_SPELLS;
  }

  /**
   * Get the highest level spell available for a magic level
   */
  getHighestAvailableSpell(magicLevel: number): Spell | undefined {
    const available = this.getAvailableSpells(magicLevel);
    return available[available.length - 1];
  }

  /**
   * Get spells by element
   */
  getSpellsByElement(element: string): Spell[] {
    return SPELL_ORDER.filter(
      (id) => COMBAT_SPELLS[id].element === element,
    ).map((id) => COMBAT_SPELLS[id]);
  }

  /**
   * Get spell tier (strike, bolt)
   */
  getSpellTier(spellId: string): "strike" | "bolt" | null {
    const spell = COMBAT_SPELLS[spellId];
    if (!spell) return null;

    if (spellId.endsWith("_strike")) return "strike";
    if (spellId.endsWith("_bolt")) return "bolt";
    return null;
  }
}

// Export singleton instance
export const spellService = new SpellService();
