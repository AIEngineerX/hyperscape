// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { CombatSkills, GatheringSkills, VitalStats } from "../codegen/index.sol";
import { XPTable } from "../libraries/XPTable.sol";
import { CombatLevel } from "../libraries/CombatLevel.sol";
import { Constants } from "../libraries/Constants.sol";
import { Errors } from "../libraries/Errors.sol";

/**
 * @title SkillSystem
 * @notice Handles skill XP updates and level calculations on-chain.
 *
 * Access: Restricted to namespace owner (server operator).
 * Called optimistically after the game server processes XP gains.
 *
 * The server batches XP changes from multiple game ticks and writes
 * them in a single transaction using updateCombatSkills() or
 * updateGatheringSkills() to minimize gas costs.
 *
 * All level calculations use the OSRS XP formula via XPTable library,
 * which must produce identical results to the TypeScript SkillsSystem.
 */
contract SkillSystem is System {
    /**
     * @notice Update all combat skills at once (batched write).
     * The server computes new levels from XP on its side and writes
     * the complete state. This avoids on-chain level calculation gas.
     *
     * @param characterId The character's bytes32 ID
     * @param attackLevel Attack level
     * @param attackXp Attack XP
     * @param strengthLevel Strength level
     * @param strengthXp Strength XP
     * @param defenseLevel Defense level
     * @param defenseXp Defense XP
     * @param constitutionLevel Constitution level
     * @param constitutionXp Constitution XP
     * @param rangedLevel Ranged level
     * @param rangedXp Ranged XP
     * @param magicLevel Magic level
     * @param magicXp Magic XP
     * @param prayerLevel Prayer level
     * @param prayerXp Prayer XP
     */
    function updateCombatSkills(
        bytes32 characterId,
        uint16 attackLevel, uint32 attackXp,
        uint16 strengthLevel, uint32 strengthXp,
        uint16 defenseLevel, uint32 defenseXp,
        uint16 constitutionLevel, uint32 constitutionXp,
        uint16 rangedLevel, uint32 rangedXp,
        uint16 magicLevel, uint32 magicXp,
        uint16 prayerLevel, uint32 prayerXp
    ) public {
        CombatSkills.set(
            characterId,
            attackLevel, attackXp,
            strengthLevel, strengthXp,
            defenseLevel, defenseXp,
            constitutionLevel, constitutionXp,
            rangedLevel, rangedXp,
            magicLevel, magicXp,
            prayerLevel, prayerXp
        );

        // Recalculate and update combat level
        uint16 newCombatLevel = CombatLevel.calculate(
            attackLevel, strengthLevel, defenseLevel,
            constitutionLevel, rangedLevel, magicLevel, prayerLevel
        );
        VitalStats.setCombatLevel(characterId, newCombatLevel);

        // Update max health (Constitution level × 10)
        uint16 newMaxHealth = constitutionLevel * 10;
        uint16 currentMaxHealth = VitalStats.getMaxHealth(characterId);
        if (newMaxHealth != currentMaxHealth) {
            VitalStats.setMaxHealth(characterId, newMaxHealth);
        }

        // Update max prayer points
        VitalStats.setPrayerMaxPoints(characterId, prayerLevel);
    }

    /**
     * @notice Update all gathering/production skills at once (batched write).
     *
     * @param characterId The character's bytes32 ID
     * @param woodcuttingLevel Woodcutting level
     * @param woodcuttingXp Woodcutting XP
     * @param miningLevel Mining level
     * @param miningXp Mining XP
     * @param fishingLevel Fishing level
     * @param fishingXp Fishing XP
     * @param firemakingLevel Firemaking level
     * @param firemakingXp Firemaking XP
     * @param cookingLevel Cooking level
     * @param cookingXp Cooking XP
     * @param smithingLevel Smithing level
     * @param smithingXp Smithing XP
     * @param agilityLevel Agility level
     * @param agilityXp Agility XP
     * @param craftingLevel Crafting level
     * @param craftingXp Crafting XP
     * @param fletchingLevel Fletching level
     * @param fletchingXp Fletching XP
     * @param runecraftingLevel Runecrafting level
     * @param runecraftingXp Runecrafting XP
     */
    function updateGatheringSkills(
        bytes32 characterId,
        uint16 woodcuttingLevel, uint32 woodcuttingXp,
        uint16 miningLevel, uint32 miningXp,
        uint16 fishingLevel, uint32 fishingXp,
        uint16 firemakingLevel, uint32 firemakingXp,
        uint16 cookingLevel, uint32 cookingXp,
        uint16 smithingLevel, uint32 smithingXp,
        uint16 agilityLevel, uint32 agilityXp,
        uint16 craftingLevel, uint32 craftingXp,
        uint16 fletchingLevel, uint32 fletchingXp,
        uint16 runecraftingLevel, uint32 runecraftingXp
    ) public {
        GatheringSkills.set(
            characterId,
            woodcuttingLevel, woodcuttingXp,
            miningLevel, miningXp,
            fishingLevel, fishingXp,
            firemakingLevel, firemakingXp,
            cookingLevel, cookingXp,
            smithingLevel, smithingXp,
            agilityLevel, agilityXp,
            craftingLevel, craftingXp,
            fletchingLevel, fletchingXp,
            runecraftingLevel, runecraftingXp
        );
    }

    /**
     * @notice Update vital stats (health, prayer, combat/total level).
     * Called frequently -- uses the smallest possible table (1 storage slot).
     *
     * @param characterId The character's bytes32 ID
     * @param combatLevel Calculated combat level
     * @param totalLevel Sum of all skill levels
     * @param health Current health
     * @param maxHealth Maximum health (constitution × 10)
     * @param prayerPoints Current prayer points
     * @param prayerMaxPoints Maximum prayer points (= prayer level)
     */
    function updateVitalStats(
        bytes32 characterId,
        uint16 combatLevel,
        uint16 totalLevel,
        uint16 health,
        uint16 maxHealth,
        uint16 prayerPoints,
        uint16 prayerMaxPoints
    ) public {
        VitalStats.set(
            characterId,
            combatLevel,
            totalLevel,
            health,
            maxHealth,
            prayerPoints,
            prayerMaxPoints
        );
    }

    /**
     * @notice Update just health (most frequent vital stat change).
     * @param characterId The character's bytes32 ID
     * @param health New health value
     */
    function updateHealth(bytes32 characterId, uint16 health) public {
        VitalStats.setHealth(characterId, health);
    }

    /**
     * @notice Update total level (called after any skill level change).
     * @param characterId The character's bytes32 ID
     * @param totalLevel New total level
     */
    function updateTotalLevel(bytes32 characterId, uint16 totalLevel) public {
        VitalStats.setTotalLevel(characterId, totalLevel);
    }
}
