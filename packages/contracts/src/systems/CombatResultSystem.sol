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
     * @param xpGained Array of XP gained [attack, strength, defense, constitution, ranged, magic]
     */
    function commitCombatResult(
        bytes32 resultId,
        bytes32 characterId,
        bytes32 targetNpcId,
        uint32 goldDropped,
        uint32[] calldata lootItemIds,
        uint32[] calldata lootQuantities,
        uint8[] calldata lootTargetSlots,
        uint32[6] calldata xpGained
    ) public {
        if (lootItemIds.length != lootQuantities.length || lootItemIds.length != lootTargetSlots.length) {
            revert Errors.ERC1155InvalidArrayLength(lootItemIds.length, lootQuantities.length);
        }

        address playerAddress = CharacterOwner.getPlayerAddress(characterId);

        // 1. Mint gold to player
        if (goldDropped > 0) {
            uint64 currentGold = GoldBalance.getAmount(characterId);
            uint64 newGold = currentGold + uint64(goldDropped);
            if (newGold > Constants.MAX_GOLD) newGold = Constants.MAX_GOLD;
            GoldBalance.set(characterId, newGold);
        }

        // 2. Mint loot items to player inventory
        uint256 lootCount = lootItemIds.length;
        for (uint256 i = 0; i < lootCount; i++) {
            uint32 itemId = lootItemIds[i];
            uint32 qty = lootQuantities[i];
            uint8 targetSlot = lootTargetSlots[i];

            if (itemId == Constants.EMPTY_ITEM_ID || qty == 0) continue;
            if (targetSlot >= Constants.MAX_INVENTORY_SLOTS) continue;

            // Set inventory slot
            InventorySlot.set(characterId, targetSlot, itemId, qty);

            // Update ERC-1155 balance
            uint256 currentBalance = ItemBalance.getBalance(playerAddress, uint256(itemId));
            ItemBalance.set(playerAddress, uint256(itemId), currentBalance + qty);

            // Emit loot drop log (offchain table = event only)
            LootDropLog.set(resultId, uint8(i), itemId, qty);
        }

        // 3. Increment kill count
        uint32 currentKills = NpcKillCount.getKillCount(characterId, targetNpcId);
        NpcKillCount.set(characterId, targetNpcId, currentKills + 1);

        uint32 totalMobKills = PlayerStats.getTotalMobKills(characterId);
        PlayerStats.setTotalMobKills(characterId, totalMobKills + 1);

        // 4. Update gold earned stat
        if (goldDropped > 0) {
            uint64 totalGold = PlayerStats.getTotalGoldEarned(characterId);
            PlayerStats.setTotalGoldEarned(characterId, totalGold + uint64(goldDropped));
        }

        // 5. Emit combat result log (offchain table = event only)
        CombatResultLog.set(
            resultId,
            characterId,
            targetNpcId,
            xpGained[0], // attackXpGained
            xpGained[1], // strengthXpGained
            xpGained[2], // defenseXpGained
            xpGained[3], // constitutionXpGained
            xpGained[4], // rangedXpGained
            xpGained[5], // magicXpGained
            goldDropped,
            uint64(block.timestamp)
        );
    }

    /**
     * @notice Batch commit multiple combat results in one transaction.
     * Used when the server has accumulated several kills to write at once.
     *
     * @param resultIds Array of result IDs
     * @param characterIds Array of character IDs
     * @param targetNpcIds Array of NPC IDs
     * @param goldDropped Array of gold amounts
     */
    function commitCombatResultBatchSimple(
        bytes32[] calldata resultIds,
        bytes32[] calldata characterIds,
        bytes32[] calldata targetNpcIds,
        uint32[] calldata goldDropped
    ) public {
        uint256 length = resultIds.length;

        for (uint256 i = 0; i < length; i++) {
            bytes32 characterId = characterIds[i];
            bytes32 npcId = targetNpcIds[i];

            // Mint gold
            if (goldDropped[i] > 0) {
                uint64 currentGold = GoldBalance.getAmount(characterId);
                uint64 newGold = currentGold + uint64(goldDropped[i]);
                if (newGold > Constants.MAX_GOLD) newGold = Constants.MAX_GOLD;
                GoldBalance.set(characterId, newGold);

                uint64 totalGold = PlayerStats.getTotalGoldEarned(characterId);
                PlayerStats.setTotalGoldEarned(characterId, totalGold + uint64(goldDropped[i]));
            }

            // Increment kill count
            uint32 currentKills = NpcKillCount.getKillCount(characterId, npcId);
            NpcKillCount.set(characterId, npcId, currentKills + 1);

            uint32 totalMobKills = PlayerStats.getTotalMobKills(characterId);
            PlayerStats.setTotalMobKills(characterId, totalMobKills + 1);

            // Emit log
            CombatResultLog.set(
                resultIds[i], characterId, npcId,
                0, 0, 0, 0, 0, 0, // XP tracked via SkillSystem
                goldDropped[i],
                uint64(block.timestamp)
            );
        }
    }
}
