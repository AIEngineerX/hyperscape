// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { InventorySlot, GoldBalance, CharacterOwner } from "../codegen/index.sol";
import { Constants } from "../libraries/Constants.sol";
import { Errors } from "../libraries/Errors.sol";
import { BalanceLib } from "../libraries/BalanceLib.sol";

/**
 * @title InventorySystem
 * @notice Manages 28-slot inventory with ERC-1155 balance tracking.
 * Server writes optimistically; slot diffs reconcile balances automatically.
 * Access: namespace owner (server operator) only.
 */
contract InventorySystem is System {
    /**
     * @notice Set a single inventory slot. Updates ERC-1155 balance accordingly.
     * @param characterId The character's bytes32 ID
     * @param slotIndex Slot index (0-27)
     * @param itemId Numeric item ID (0 to clear slot)
     * @param quantity Item quantity
     */
    function setInventorySlot(
        bytes32 characterId,
        uint8 slotIndex,
        uint32 itemId,
        uint32 quantity
    ) public {
        if (slotIndex >= Constants.MAX_INVENTORY_SLOTS) revert Errors.InvalidSlotIndex(slotIndex);

        address playerAddress = CharacterOwner.getPlayerAddress(characterId);
        // SECURITY: Validate character exists
        if (playerAddress == address(0)) revert Errors.InvalidCharacterOwner(characterId);

        // Read current slot state
        uint32 oldItemId = InventorySlot.getItemId(characterId, slotIndex);
        uint32 oldQuantity = InventorySlot.getQuantity(characterId, slotIndex);

        // Decrease balance for old item (if slot had an item)
        if (oldItemId != Constants.EMPTY_ITEM_ID && oldQuantity > 0) {
            BalanceLib.decrease(playerAddress, uint256(oldItemId), uint256(oldQuantity));
        }

        // Set new slot state
        if (itemId == Constants.EMPTY_ITEM_ID || quantity == 0) {
            InventorySlot.deleteRecord(characterId, slotIndex);
        } else {
            InventorySlot.set(characterId, slotIndex, itemId, quantity);
            BalanceLib.increase(playerAddress, uint256(itemId), uint256(quantity));
        }
    }

    /**
     * @notice Batch update multiple inventory slots in a single transaction.
     * This is the primary write path -- the server sends changed slots only.
     *
     * @param characterId The character's bytes32 ID
     * @param slotIndices Array of slot indices to update
     * @param itemIds Array of item IDs (0 to clear)
     * @param quantities Array of quantities
     */
    function setInventorySlotBatch(
        bytes32 characterId,
        uint8[] calldata slotIndices,
        uint32[] calldata itemIds,
        uint32[] calldata quantities
    ) public {
        uint256 length = slotIndices.length;
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);
        // SECURITY: Validate character exists
        if (playerAddress == address(0)) revert Errors.InvalidCharacterOwner(characterId);

        for (uint256 i = 0; i < length; i++) {
            uint8 slot = slotIndices[i];
            if (slot >= Constants.MAX_INVENTORY_SLOTS) revert Errors.InvalidSlotIndex(slot);

            // Read and reconcile old state
            uint32 oldItemId = InventorySlot.getItemId(characterId, slot);
            uint32 oldQuantity = InventorySlot.getQuantity(characterId, slot);

            if (oldItemId != Constants.EMPTY_ITEM_ID && oldQuantity > 0) {
                BalanceLib.decrease(playerAddress, uint256(oldItemId), uint256(oldQuantity));
            }

            // Write new state
            uint32 newItemId = itemIds[i];
            uint32 newQuantity = quantities[i];

            if (newItemId == Constants.EMPTY_ITEM_ID || newQuantity == 0) {
                InventorySlot.deleteRecord(characterId, slot);
            } else {
                InventorySlot.set(characterId, slot, newItemId, newQuantity);
                BalanceLib.increase(playerAddress, uint256(newItemId), uint256(newQuantity));
            }
        }
    }

    /**
     * @notice Clear all inventory slots (used on death, trade completion).
     * @param characterId The character's bytes32 ID
     */
    function clearInventory(bytes32 characterId) public {
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);
        // SECURITY: Validate character exists
        if (playerAddress == address(0)) revert Errors.InvalidCharacterOwner(characterId);

        for (uint8 i = 0; i < Constants.MAX_INVENTORY_SLOTS; i++) {
            uint32 itemId = InventorySlot.getItemId(characterId, i);
            uint32 quantity = InventorySlot.getQuantity(characterId, i);

            if (itemId != Constants.EMPTY_ITEM_ID && quantity > 0) {
                BalanceLib.decrease(playerAddress, uint256(itemId), uint256(quantity));
                InventorySlot.deleteRecord(characterId, i);
            }
        }
    }

    /**
     * @notice Update gold balance for a character.
     * @param characterId The character's bytes32 ID
     * @param amount New gold amount
     */
    function setGold(bytes32 characterId, uint64 amount) public {
        // SECURITY: Prevent setting gold above maximum cap (Task 76)
        if (amount > Constants.MAX_GOLD) revert Errors.GoldOverflow(characterId, GoldBalance.getAmount(characterId), amount);
        GoldBalance.set(characterId, amount);
    }

    /**
     * @notice Add gold to a character's balance.
     * @param characterId The character's bytes32 ID
     * @param amount Gold to add
     */
    function addGold(bytes32 characterId, uint64 amount) public {
        if (amount == 0) revert Errors.ZeroAmount();
        uint64 current = GoldBalance.getAmount(characterId);
        uint64 newAmount = current + amount;
        if (newAmount > Constants.MAX_GOLD) {
            newAmount = Constants.MAX_GOLD;
        }
        GoldBalance.set(characterId, newAmount);
    }

    /**
     * @notice Remove gold from a character's balance.
     * @param characterId The character's bytes32 ID
     * @param amount Gold to remove
     */
    function removeGold(bytes32 characterId, uint64 amount) public {
        if (amount == 0) revert Errors.ZeroAmount();
        uint64 current = GoldBalance.getAmount(characterId);
        if (current < amount) revert Errors.InsufficientGold(characterId, amount, current);
        GoldBalance.set(characterId, current - amount);
    }

    /**
     * @notice Read an inventory slot.
     * @param characterId The character's bytes32 ID
     * @param slotIndex Slot index (0-27)
     * @return itemId Slot item ID (0 when empty)
     * @return quantity Slot quantity (0 when empty)
     */
    function getInventorySlot(bytes32 characterId, uint8 slotIndex) public view returns (uint32 itemId, uint32 quantity) {
        if (slotIndex >= Constants.MAX_INVENTORY_SLOTS) revert Errors.InvalidSlotIndex(slotIndex);
        return (
            InventorySlot.getItemId(characterId, slotIndex),
            InventorySlot.getQuantity(characterId, slotIndex)
        );
    }

    /**
     * @notice Read a character's gold amount.
     * @param characterId The character's bytes32 ID
     */
    function getGold(bytes32 characterId) public view returns (uint64 amount) {
        return GoldBalance.getAmount(characterId);
    }

}
