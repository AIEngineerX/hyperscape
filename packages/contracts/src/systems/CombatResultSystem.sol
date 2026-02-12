// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { CombatResultLog, LootDropLog, InventorySlot, GoldBalance, ItemBalance, NpcKillCount, PlayerStats, CharacterOwner } from "../codegen/index.sol";
import { Constants } from "../libraries/Constants.sol";
import { Errors } from "../libraries/Errors.sol";

/**
 * @title CombatResultSystem
 * @notice Batches combat outcomes into single on-chain transactions.
 *
 * Access: Restricted to namespace owner (server operator).
 *
 * After a mob is killed, the server computes:
 * - XP gained per skill (already written via SkillSystem)
 * - Loot drops (items + gold)
 * - Kill count increment
 *
 * This system handles loot minting and gold rewards in a single call.
 * XP is written separately via SkillSystem for modularity.
 *
 * The CombatResultLog and LootDropLog are offchain tables (events only)
 * providing a transparent audit trail at zero storage cost.
 */
contract CombatResultSystem is System {
    /**
     * @notice Record a combat result: mint loot items and gold to the player.
     *
     * @param resultId Unique result ID (server-generated)
     * @param characterId The character's bytes32 ID
     * @param targetNpcId The killed NPC's ID (keccak256 of string ID)
     * @param goldDropped Gold amount dropped by the mob
     * @param lootItemIds Array of item numeric IDs that dropped
     * @param lootQuantities Array of quantities for each dropped item
     * @param lootTargetSlots Array of inventory slots to place loot in
     */
    function commitCombatResult(
        bytes32 resultId,
        bytes32 characterId,
        bytes32 targetNpcId,
        uint32 goldDropped,
        uint32[] calldata lootItemIds,
        uint32[] calldata lootQuantities,
        uint8[] calldata lootTargetSlots
    ) public {
        if (lootItemIds.length != lootQuantities.length) {
            revert Errors.ERC1155InvalidArrayLength(lootItemIds.length, lootQuantities.length);
        }
        if (lootItemIds.length != lootTargetSlots.length) {
            revert Errors.ERC1155InvalidArrayLength(lootItemIds.length, lootTargetSlots.length);
        }

        _mintGold(characterId, goldDropped);
        _mintLoot(resultId, characterId, lootItemIds, lootQuantities, lootTargetSlots);
        _incrementKillStats(characterId, targetNpcId);
        _recordGoldEarned(characterId, goldDropped);

        // CombatResultLog is optional telemetry; core chain state is handled above.
        // Keeping writes minimal avoids stack-depth issues in the non-IR compiler path.
    }

    function _mintGold(bytes32 characterId, uint32 goldDropped) internal {
        if (goldDropped == 0) return;

        uint64 currentGold = GoldBalance.getAmount(characterId);
        uint64 newGold = currentGold + uint64(goldDropped);
        if (newGold > Constants.MAX_GOLD) newGold = Constants.MAX_GOLD;
        GoldBalance.set(characterId, newGold);
    }

    function _mintLoot(
        bytes32 resultId,
        bytes32 characterId,
        uint32[] calldata lootItemIds,
        uint32[] calldata lootQuantities,
        uint8[] calldata lootTargetSlots
    ) internal {
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);
        uint256 lootCount = lootItemIds.length;

        for (uint256 i = 0; i < lootCount; i++) {
            uint32 itemId = lootItemIds[i];
            uint32 qty = lootQuantities[i];
            uint8 targetSlot = lootTargetSlots[i];

            if (itemId == Constants.EMPTY_ITEM_ID || qty == 0) continue;
            if (targetSlot >= Constants.MAX_INVENTORY_SLOTS) continue;

            InventorySlot.set(characterId, targetSlot, itemId, qty);

            uint256 currentBalance = ItemBalance.getBalance(playerAddress, uint256(itemId));
            ItemBalance.set(playerAddress, uint256(itemId), currentBalance + qty);

            LootDropLog.set(resultId, uint8(i), itemId, qty);
        }
    }

    function _incrementKillStats(bytes32 characterId, bytes32 targetNpcId) internal {
        uint32 currentKills = NpcKillCount.getKillCount(characterId, targetNpcId);
        NpcKillCount.set(characterId, targetNpcId, currentKills + 1);

        uint32 totalMobKills = PlayerStats.getTotalMobKills(characterId);
        PlayerStats.setTotalMobKills(characterId, totalMobKills + 1);
    }

    function _recordGoldEarned(bytes32 characterId, uint32 goldDropped) internal {
        if (goldDropped == 0) return;
        uint64 totalGold = PlayerStats.getTotalGoldEarned(characterId);
        PlayerStats.setTotalGoldEarned(characterId, totalGold + uint64(goldDropped));
    }

}
