// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { Test } from "forge-std/Test.sol";
import { CombatLevel } from "../src/libraries/CombatLevel.sol";
import { XPTable } from "../src/libraries/XPTable.sol";
import { Constants } from "../src/libraries/Constants.sol";

/**
 * @title LibrariesTest
 * @notice Unit tests for pure library functions: CombatLevel, XPTable, Constants.
 *
 * These tests validate the on-chain implementations match the TypeScript
 * game server's calculations. Any divergence between Solidity and TS would
 * cause stat mismatches between on-chain records and server state.
 */
contract LibrariesTest is Test {
    // =========================================================================
    // CombatLevel
    // =========================================================================

    function test_combatLevel_allOnes() public pure {
        // All level 1 skills:
        //   base = 0.25 * (1 + 1 + 0) = 0.5
        //   melee = 0.325 * (1 + 1) = 0.65
        //   combat = floor(0.5 + 0.65) = 1
        uint16 level = CombatLevel.calculate(1, 1, 1, 1, 1, 1, 1);
        assertEq(level, 1, "All-1 combat level should be 1");
    }

    function test_combatLevel_defaultNewCharacter() public pure {
        // New character: attack=1, strength=1, defense=1, constitution=10, ranged=1, magic=1, prayer=1
        // base = 0.25 * (1 + 10 + 0) = 2.75
        // melee = 0.325 * (1 + 1) = 0.65
        // combat = floor(2.75 + 0.65) = 3
        uint16 level = CombatLevel.calculate(1, 1, 1, 10, 1, 1, 1);
        assertEq(level, Constants.DEFAULT_COMBAT_LEVEL, "Default character combat level should match constant");
    }

    function test_combatLevel_pureMelee() public pure {
        // Maxed melee: attack=99, strength=99, defense=99, constitution=99, ranged=1, magic=1, prayer=99
        // base = 0.25 * (99 + 99 + 49) = 61.75
        // melee = 0.325 * (99 + 99) = 64.35
        // combat = floor(61.75 + 64.35) = 126
        uint16 level = CombatLevel.calculate(99, 99, 99, 99, 1, 1, 99);
        assertEq(level, 126, "Max melee combat level should be 126");
    }

    function test_combatLevel_pureRanged() public pure {
        // Maxed ranged: attack=1, strength=1, defense=99, constitution=99, ranged=99, magic=1, prayer=99
        // base = 0.25 * (99 + 99 + 49) = 61.75
        // ranged = 0.325 * floor(99 * 1.5) = 0.325 * 148 = 48.1
        // combat = floor(61.75 + 48.1) = 109
        uint16 level = CombatLevel.calculate(1, 1, 99, 99, 99, 1, 99);
        assertEq(level, 109, "Max ranged combat level should be 109");
    }

    function test_combatLevel_pureMagic() public pure {
        // Maxed magic: attack=1, strength=1, defense=99, constitution=99, ranged=1, magic=99, prayer=99
        // Same calculation as ranged: floor(61.75 + 48.1) = 109
        uint16 level = CombatLevel.calculate(1, 1, 99, 99, 1, 99, 99);
        assertEq(level, 109, "Max magic combat level should be 109");
    }

    function test_combatLevel_meleeIsHighest() public pure {
        // Melee > ranged > magic → melee contribution used
        uint16 melee = CombatLevel.calculate(50, 50, 50, 50, 1, 1, 1);
        uint16 ranged = CombatLevel.calculate(1, 1, 50, 50, 50, 1, 1);
        // Melee (attack + strength = 100) should give higher combat than ranged (ranged = 50 → 75)
        assertGt(melee, ranged, "Melee should give higher combat than ranged at equal base stats");
    }

    function test_combatLevel_prayerContribution() public pure {
        // Prayer contributes 0.25 * floor(prayer / 2) to base
        uint16 noPrayer = CombatLevel.calculate(50, 50, 50, 50, 1, 1, 1);
        uint16 withPrayer = CombatLevel.calculate(50, 50, 50, 50, 1, 1, 99);
        assertGt(withPrayer, noPrayer, "Prayer should increase combat level");
    }

    function test_combatLevel_symmetricRangedMagic() public pure {
        // Ranged and magic should give same combat level when equal
        uint16 ranged = CombatLevel.calculate(1, 1, 50, 50, 75, 1, 50);
        uint16 magic = CombatLevel.calculate(1, 1, 50, 50, 1, 75, 50);
        assertEq(ranged, magic, "Equal ranged and magic should give same combat level");
    }

    // =========================================================================
    // XPTable — xpForLevel
    // =========================================================================

    function test_xpForLevel_level1() public pure {
        assertEq(XPTable.xpForLevel(1), 0, "Level 1 requires 0 XP");
    }

    function test_xpForLevel_level2() public pure {
        assertEq(XPTable.xpForLevel(2), 83, "Level 2 requires 83 XP");
    }

    function test_xpForLevel_level10() public pure {
        assertEq(XPTable.xpForLevel(10), 1151, "Level 10 requires 1151 XP");
    }

    function test_xpForLevel_defaultConstitution() public pure {
        assertEq(
            XPTable.xpForLevel(Constants.DEFAULT_CONSTITUTION_LEVEL),
            Constants.DEFAULT_CONSTITUTION_XP,
            "Constitution XP should match constant"
        );
    }

    function test_xpForLevel_level50() public pure {
        assertEq(XPTable.xpForLevel(50), 101314, "Level 50 requires 101314 XP");
    }

    function test_xpForLevel_level99() public pure {
        assertEq(XPTable.xpForLevel(99), 13034394, "Level 99 requires 13034394 XP");
    }

    function test_xpForLevel_level0() public pure {
        assertEq(XPTable.xpForLevel(0), 0, "Level 0 should return 0");
    }

    function test_xpForLevel_above99() public pure {
        assertEq(XPTable.xpForLevel(100), Constants.MAX_XP, "Level > 99 caps at MAX_XP");
        assertEq(XPTable.xpForLevel(200), Constants.MAX_XP, "Level 200 caps at MAX_XP");
    }

    function test_xpForLevel_monotonicallyIncreasing() public pure {
        uint32 prev = 0;
        for (uint16 level = 2; level <= 99; level++) {
            uint32 current = XPTable.xpForLevel(level);
            assertGt(current, prev, "XP table must be monotonically increasing");
            prev = current;
        }
    }

    // =========================================================================
    // XPTable — levelForXp
    // =========================================================================

    function test_levelForXp_zero() public pure {
        assertEq(XPTable.levelForXp(0), 1, "0 XP should be level 1");
    }

    function test_levelForXp_exactBoundary() public pure {
        // Exactly at level 2 threshold
        assertEq(XPTable.levelForXp(83), 2, "83 XP should be level 2");
    }

    function test_levelForXp_justBelow() public pure {
        // Just below level 2 threshold
        assertEq(XPTable.levelForXp(82), 1, "82 XP should still be level 1");
    }

    function test_levelForXp_midLevel() public pure {
        // Between level 50 (101314) and level 51 (111925)
        assertEq(XPTable.levelForXp(105000), 50, "105000 XP should be level 50");
    }

    function test_levelForXp_level99() public pure {
        assertEq(XPTable.levelForXp(13034394), 99, "13034394 XP should be level 99");
    }

    function test_levelForXp_maxXp() public pure {
        assertEq(XPTable.levelForXp(Constants.MAX_XP), 99, "MAX_XP should be level 99");
    }

    function test_levelForXp_roundTrip() public pure {
        // For each level, verify levelForXp(xpForLevel(level)) == level
        for (uint16 level = 1; level <= 99; level++) {
            uint32 xp = XPTable.xpForLevel(level);
            uint16 computed = XPTable.levelForXp(xp);
            assertEq(computed, level, "Round-trip level mismatch");
        }
    }

    // =========================================================================
    // XPTable — calculateXpGain
    // =========================================================================

    function test_calculateXpGain_noLevelUp() public pure {
        // Level 1 with 0 XP, gain 50 XP → still level 1 (need 83 for level 2)
        (uint16 newLevel, uint32 newXp, uint16 levelsGained) = XPTable.calculateXpGain(0, 1, 50);
        assertEq(newLevel, 1, "Should remain level 1");
        assertEq(newXp, 50, "XP should be 50");
        assertEq(levelsGained, 0, "No levels gained");
    }

    function test_calculateXpGain_exactLevelUp() public pure {
        // Level 1 with 0 XP, gain 83 XP → level 2
        (uint16 newLevel, uint32 newXp, uint16 levelsGained) = XPTable.calculateXpGain(0, 1, 83);
        assertEq(newLevel, 2, "Should be level 2");
        assertEq(newXp, 83, "XP should be 83");
        assertEq(levelsGained, 1, "Should gain 1 level");
    }

    function test_calculateXpGain_multiLevelUp() public pure {
        // Level 1 with 0 XP, gain enough for level 5
        (uint16 newLevel, uint32 newXp, uint16 levelsGained) = XPTable.calculateXpGain(0, 1, 400);
        assertEq(newLevel, 5, "Should be level 5 (387 XP for level 5)");
        assertEq(newXp, 400, "XP should be 400");
        assertEq(levelsGained, 4, "Should gain 4 levels");
    }

    function test_calculateXpGain_capsAtMaxXp() public pure {
        // Near max XP, adding huge amount should cap
        (uint16 newLevel, uint32 newXp,) = XPTable.calculateXpGain(
            Constants.MAX_XP - 100,
            99,
            1000
        );
        assertEq(newXp, Constants.MAX_XP, "XP should cap at MAX_XP");
        assertEq(newLevel, 99, "Level should stay 99");
    }

    function test_calculateXpGain_overflowProtection() public pure {
        // Massive XP addition should not overflow
        (uint16 newLevel, uint32 newXp,) = XPTable.calculateXpGain(
            Constants.MAX_XP,
            99,
            Constants.MAX_XP
        );
        assertEq(newXp, Constants.MAX_XP, "XP should cap at MAX_XP");
        assertEq(newLevel, 99, "Level should stay 99");
    }

    // =========================================================================
    // Constants — sanity checks
    // =========================================================================

    function test_constants_maxGold() public pure {
        // MAX_GOLD should fit in int32 (2^31 - 1)
        assertEq(Constants.MAX_GOLD, 2_147_483_647, "MAX_GOLD should be int32 max");
    }

    function test_constants_maxInventorySlots() public pure {
        assertEq(Constants.MAX_INVENTORY_SLOTS, 28, "Inventory should have 28 slots");
    }

    function test_constants_maxBankSlots() public pure {
        assertEq(Constants.MAX_BANK_SLOTS, 480, "Bank should have 480 slots");
    }

    function test_constants_maxSkillLevel() public pure {
        assertEq(Constants.MAX_SKILL_LEVEL, 99, "Max skill level should be 99");
    }

    function test_constants_constitutionDefaults() public pure {
        // Default constitution XP should correspond to level 10
        uint16 level = XPTable.levelForXp(Constants.DEFAULT_CONSTITUTION_XP);
        assertEq(level, Constants.DEFAULT_CONSTITUTION_LEVEL, "Default constitution XP should be level 10");
    }
}
