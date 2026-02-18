// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { BankSlot, CharacterOwner } from "../codegen/index.sol";
import { Constants } from "../libraries/Constants.sol";
import { Errors } from "../libraries/Errors.sol";
import { BalanceLib } from "../libraries/BalanceLib.sol";

/**
 * @title BankSystem
 * @notice Manages bank storage slots on-chain with ERC-1155 balance tracking.
 *
 * Access: Restricted to namespace owner (server operator).
 *
 * Bank supports 480 slots across 10 tabs (0-9).
 * All items stack in bank regardless of their stackable property.
 *
 * The server writes bank changes lazily -- only modified slots are written,
 * not the entire bank. This is critical because writing 480 slots would
 * cost ~10M gas.
 */
contract BankSystem is System {
    /**
     * @notice Set a single bank slot.
     * @param characterId The character's bytes32 ID
     * @param tabIndex Bank tab (0-9)
     * @param slot Slot within tab (0-479)
     * @param itemId Numeric item ID (0 to clear)
     * @param quantity Stack quantity
     */
    function setSlot(
        bytes32 characterId,
        uint8 tabIndex,
        uint16 slot,
        uint32 itemId,
        uint32 quantity
    ) public {
        if (tabIndex >= Constants.MAX_BANK_TABS) revert Errors.BankFull(characterId);
        if (slot >= Constants.MAX_BANK_SLOTS) revert Errors.BankFull(characterId);

        address playerAddress = CharacterOwner.getPlayerAddress(characterId);
        // SECURITY: Validate character exists
        if (playerAddress == address(0)) revert Errors.InvalidCharacterOwner(characterId);

        // Read current slot state
        uint32 oldItemId = BankSlot.getItemId(characterId, tabIndex, slot);
        uint32 oldQuantity = BankSlot.getQuantity(characterId, tabIndex, slot);

        // Decrease balance for old item
        if (oldItemId != Constants.EMPTY_ITEM_ID && oldQuantity > 0) {
            BalanceLib.decrease(playerAddress, uint256(oldItemId), uint256(oldQuantity));
        }

        if (itemId == Constants.EMPTY_ITEM_ID || quantity == 0) {
            BankSlot.deleteRecord(characterId, tabIndex, slot);
        } else {
            BankSlot.set(characterId, tabIndex, slot, itemId, quantity);
            BalanceLib.increase(playerAddress, uint256(itemId), uint256(quantity));
        }
    }

    /**
     * @notice Batch update multiple bank slots in a single transaction.
     * The server sends only the changed slots (delta), not the full bank.
     *
     * @param characterId The character's bytes32 ID
     * @param tabIndices Array of tab indices
     * @param slots Array of slot indices
     * @param itemIds Array of item IDs (0 to clear)
     * @param quantities Array of quantities
     */
    function setSlotBatch(
        bytes32 characterId,
        uint8[] calldata tabIndices,
        uint16[] calldata slots,
        uint32[] calldata itemIds,
        uint32[] calldata quantities
    ) public {
        uint256 length = tabIndices.length;
        if (slots.length != length) revert Errors.ERC1155InvalidArrayLength(length, slots.length);
        if (itemIds.length != length) revert Errors.ERC1155InvalidArrayLength(length, itemIds.length);
        if (quantities.length != length) revert Errors.ERC1155InvalidArrayLength(length, quantities.length);

        for (uint256 i = 0; i < length; i++) {
            setSlot(characterId, tabIndices[i], slots[i], itemIds[i], quantities[i]);
        }
    }
}
