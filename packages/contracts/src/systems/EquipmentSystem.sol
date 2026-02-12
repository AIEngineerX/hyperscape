// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { EquipmentSlot, CharacterOwner } from "../codegen/index.sol";
import { Constants } from "../libraries/Constants.sol";
import { Errors } from "../libraries/Errors.sol";
import { BalanceLib } from "../libraries/BalanceLib.sol";

/**
 * @title EquipmentSystem
 * @notice Manages equipment slots on-chain with ERC-1155 balance tracking.
 *
 * Access: Restricted to namespace owner (server operator).
 *
 * Equipment slots (0-10): Weapon, Shield, Helmet, Body, Legs, Boots,
 * Gloves, Cape, Amulet, Ring, Arrows.
 *
 * The server writes equipment state optimistically after equip/unequip.
 * Level requirement validation happens server-side (the chain trusts
 * the operator for game logic; the chain is the record of truth for ownership).
 */
contract EquipmentSystem is System {
    /**
     * @notice Set a single equipment slot. Updates ERC-1155 balance accordingly.
     * @param characterId The character's bytes32 ID
     * @param slotType Equipment slot type (0-10, maps to EquipSlot enum)
     * @param itemId Numeric item ID (0 to clear slot)
     * @param quantity Item quantity (usually 1, except arrows)
     */
    function setEquipmentSlot(
        bytes32 characterId,
        uint8 slotType,
        uint32 itemId,
        uint32 quantity
    ) public {
        if (slotType > Constants.MAX_EQUIPMENT_SLOT) revert Errors.InvalidEquipmentSlot(slotType);

        address playerAddress = CharacterOwner.getPlayerAddress(characterId);

        // Read current slot state
        uint32 oldItemId = EquipmentSlot.getItemId(characterId, slotType);
        uint32 oldQuantity = EquipmentSlot.getQuantity(characterId, slotType);

        // Decrease balance for old item
        if (oldItemId != Constants.EMPTY_ITEM_ID && oldQuantity > 0) {
            BalanceLib.decrease(playerAddress, uint256(oldItemId), uint256(oldQuantity));
        }

        if (itemId == Constants.EMPTY_ITEM_ID || quantity == 0) {
            EquipmentSlot.deleteRecord(characterId, slotType);
        } else {
            EquipmentSlot.set(characterId, slotType, itemId, quantity);
            BalanceLib.increase(playerAddress, uint256(itemId), uint256(quantity));
        }
    }

    /**
     * @notice Batch update multiple equipment slots.
     */
    function setEquipmentSlotBatch(
        bytes32 characterId,
        uint8[] calldata slotTypes,
        uint32[] calldata itemIds,
        uint32[] calldata quantities
    ) public {
        uint256 length = slotTypes.length;
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);

        for (uint256 i = 0; i < length; i++) {
            uint8 slotType = slotTypes[i];
            if (slotType > Constants.MAX_EQUIPMENT_SLOT) revert Errors.InvalidEquipmentSlot(slotType);

            uint32 oldItemId = EquipmentSlot.getItemId(characterId, slotType);
            uint32 oldQuantity = EquipmentSlot.getQuantity(characterId, slotType);

            if (oldItemId != Constants.EMPTY_ITEM_ID && oldQuantity > 0) {
                BalanceLib.decrease(playerAddress, uint256(oldItemId), uint256(oldQuantity));
            }

            uint32 newItemId = itemIds[i];
            uint32 newQuantity = quantities[i];

            if (newItemId == Constants.EMPTY_ITEM_ID || newQuantity == 0) {
                EquipmentSlot.deleteRecord(characterId, slotType);
            } else {
                EquipmentSlot.set(characterId, slotType, newItemId, newQuantity);
                BalanceLib.increase(playerAddress, uint256(newItemId), uint256(newQuantity));
            }
        }
    }

    /**
     * @notice Clear all equipment slots (used on death).
     */
    function clearEquipment(bytes32 characterId) public {
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);

        for (uint8 i = 0; i <= Constants.MAX_EQUIPMENT_SLOT; i++) {
            uint32 itemId = EquipmentSlot.getItemId(characterId, i);
            uint32 quantity = EquipmentSlot.getQuantity(characterId, i);

            if (itemId != Constants.EMPTY_ITEM_ID && quantity > 0) {
                BalanceLib.decrease(playerAddress, uint256(itemId), uint256(quantity));
                EquipmentSlot.deleteRecord(characterId, i);
            }
        }
    }
}
