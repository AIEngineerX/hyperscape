// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { ItemIdToString, ItemStringToId, ItemIdCounter, ItemDefinition, ItemRequirements } from "../codegen/index.sol";
import { ItemCategory } from "../codegen/common.sol";
import { Errors } from "../libraries/Errors.sol";

/**
 * @title ItemRegistrySystem
 * @notice Manages the bidirectional item ID registry and item definitions.
 *
 * Access: Restricted to namespace owner (server operator).
 *
 * The game uses string IDs for items (e.g. "bronze_sword") but Solidity
 * needs uint32 IDs for gas efficiency. This system maintains the mapping.
 *
 * Seeding flow (at deploy time):
 * 1. Read all item manifests from JSON files
 * 2. Call registerItem() for each item (assigns sequential numeric ID)
 * 3. Call setItemDefinition() for each item's properties
 * 4. Call setItemRequirements() for items with level requirements
 *
 * Noted items follow the convention: notedId = baseId + 10000
 */
contract ItemRegistrySystem is System {

    /**
     * @notice Register a new item in the bidirectional mapping.
     * Automatically assigns the next sequential numeric ID.
     * @param stringId The string identifier (e.g. "bronze_sword")
     * @return numericId The assigned numeric ID
     */
    function registerItem(string calldata stringId) public returns (uint32 numericId) {
        bytes32 stringIdHash = keccak256(bytes(stringId));

        // Check not already registered
        uint32 existingId = ItemStringToId.getNumericId(stringIdHash);
        if (existingId != 0) revert Errors.ItemStringAlreadyRegistered(stringIdHash);

        // Get and increment counter (starts at 1, 0 is reserved for empty)
        uint32 currentCounter = ItemIdCounter.getValue();
        numericId = currentCounter + 1;
        ItemIdCounter.setValue(numericId);

        // Store bidirectional mapping
        ItemIdToString.set(numericId, stringId);
        ItemStringToId.set(stringIdHash, numericId);
    }

    /**
     * @notice Register an item with a specific numeric ID.
     * Used for noted items where ID = baseId + NOTED_ITEM_OFFSET.
     * @param numericId The specific numeric ID to assign
     * @param stringId The string identifier (e.g. "bronze_sword_noted")
     */
    function registerItemWithId(uint32 numericId, string calldata stringId) public {
        if (numericId == 0) revert Errors.InvalidItemId();
        bytes32 stringIdHash = keccak256(bytes(stringId));

        // Check neither ID nor string is already registered
        string memory existingString = ItemIdToString.getStringId(numericId);
        if (bytes(existingString).length > 0) revert Errors.ItemIdAlreadyRegistered(numericId);

        uint32 existingNumeric = ItemStringToId.getNumericId(stringIdHash);
        if (existingNumeric != 0) revert Errors.ItemStringAlreadyRegistered(stringIdHash);

        // Store bidirectional mapping
        ItemIdToString.set(numericId, stringId);
        ItemStringToId.set(stringIdHash, numericId);

        // Update counter if this ID is higher than current
        uint32 currentCounter = ItemIdCounter.getValue();
        if (numericId > currentCounter) {
            ItemIdCounter.setValue(numericId);
        }
    }

    /**
     * @notice Batch register items with explicit numeric IDs.
     * @param numericIds Array of numeric IDs
     * @param stringIds Array of string IDs
     */
    function registerItemWithIdBatch(
        uint32[] calldata numericIds,
        string[] calldata stringIds
    ) public {
        uint256 length = numericIds.length;
        if (stringIds.length != length) revert Errors.ERC1155InvalidArrayLength(length, stringIds.length);

        for (uint256 i = 0; i < length; i++) {
            registerItemWithId(numericIds[i], stringIds[i]);
        }
    }

    /**
     * @notice Batch register multiple items. Gas-efficient for seeding.
     * @param stringIds Array of string identifiers
     * @return numericIds Array of assigned numeric IDs
     */
    function registerItemBatch(string[] calldata stringIds) public returns (uint32[] memory numericIds) {
        uint256 length = stringIds.length;
        numericIds = new uint32[](length);

        uint32 counter = ItemIdCounter.getValue();

        for (uint256 i = 0; i < length; i++) {
            bytes32 stringIdHash = keccak256(bytes(stringIds[i]));

            // Skip already registered items (idempotent)
            uint32 existingId = ItemStringToId.getNumericId(stringIdHash);
            if (existingId != 0) {
                numericIds[i] = existingId;
                continue;
            }

            counter++;
            numericIds[i] = counter;

            ItemIdToString.set(counter, stringIds[i]);
            ItemStringToId.set(stringIdHash, counter);
        }

        ItemIdCounter.setValue(counter);
    }

    /**
     * @notice Set the core definition for an item.
     * @param numericId The item's numeric ID (must be registered)
     * @param name Display name
     * @param itemType Item category (weapon, armor, food, etc.)
     * @param value Base value in gold
     * @param stackable Whether the item stacks
     * @param tradeable Whether the item can be traded
     * @param equipSlot Equipment slot (0=none, 1-11 for EquipSlot enum values +1)
     * @param healAmount Health restored when consumed (0 for non-food)
     */
    function setItemDefinition(
        uint32 numericId,
        string calldata name,
        ItemCategory itemType,
        uint32 value,
        bool stackable,
        bool tradeable,
        uint8 equipSlot,
        uint16 healAmount
    ) public {
        // Verify item is registered
        string memory existing = ItemIdToString.getStringId(numericId);
        if (bytes(existing).length == 0) revert Errors.ItemNotFound(numericId);

        ItemDefinition.setItemType(numericId, itemType);
        ItemDefinition.setValue(numericId, value);
        ItemDefinition.setStackable(numericId, stackable);
        ItemDefinition.setTradeable(numericId, tradeable);
        ItemDefinition.setEquipSlot(numericId, equipSlot);
        ItemDefinition.setHealAmount(numericId, healAmount);
        ItemDefinition.setName(numericId, name);
    }

    /**
     * @notice Batch set item definitions using compact static structs + names.
     * @param numericIds Array of item numeric IDs
     * @param names Array of display names
     * @param packedStatics Packed static fields (10 bytes per item):
     * [itemType(1), value(4), stackable(1), tradeable(1), equipSlot(1), healAmount(2)]
     */
    function setItemDefinitionBatch(
        uint32[] calldata numericIds,
        string[] calldata names,
        bytes calldata packedStatics
    ) public {
        uint256 length = numericIds.length;
        if (names.length != length) revert Errors.ERC1155InvalidArrayLength(length, names.length);
        uint256 expectedPackedLength = length * 10;
        if (packedStatics.length != expectedPackedLength) {
            revert Errors.ERC1155InvalidArrayLength(expectedPackedLength, packedStatics.length);
        }

        for (uint256 i = 0; i < length; i++) {
            uint256 offset = i * 10;
            ItemCategory itemType = ItemCategory(uint8(packedStatics[offset]));
            uint32 value =
                (uint32(uint8(packedStatics[offset + 1])) << 24) |
                (uint32(uint8(packedStatics[offset + 2])) << 16) |
                (uint32(uint8(packedStatics[offset + 3])) << 8) |
                uint32(uint8(packedStatics[offset + 4]));
            bool stackable = packedStatics[offset + 5] != 0;
            bool tradeable = packedStatics[offset + 6] != 0;
            uint8 equipSlot = uint8(packedStatics[offset + 7]);
            uint16 healAmount =
                (uint16(uint8(packedStatics[offset + 8])) << 8) |
                uint16(uint8(packedStatics[offset + 9]));

            setItemDefinition(
                numericIds[i],
                names[i],
                itemType,
                value,
                stackable,
                tradeable,
                equipSlot,
                healAmount
            );
        }
    }

    /**
     * @notice Set level requirements for an equippable item.
     * @param numericId The item's numeric ID
     * @param attackReq Attack level required
     * @param strengthReq Strength level required
     * @param defenseReq Defense level required
     * @param rangedReq Ranged level required
     * @param magicReq Magic level required
     * @param prayerReq Prayer level required
     */
    function setItemRequirements(
        uint32 numericId,
        uint8 attackReq,
        uint8 strengthReq,
        uint8 defenseReq,
        uint8 rangedReq,
        uint8 magicReq,
        uint8 prayerReq
    ) public {
        ItemRequirements.set(numericId, attackReq, strengthReq, defenseReq, rangedReq, magicReq, prayerReq);
    }

    /**
     * @notice Batch set item requirements from packed bytes.
     * @param numericIds Array of item numeric IDs
     * @param packedRequirements Packed requirement bytes (6 bytes per item):
     * [attackReq, strengthReq, defenseReq, rangedReq, magicReq, prayerReq]
     */
    function setItemRequirementsBatch(
        uint32[] calldata numericIds,
        bytes calldata packedRequirements
    ) public {
        uint256 length = numericIds.length;
        uint256 expectedPackedLength = length * 6;
        if (packedRequirements.length != expectedPackedLength) {
            revert Errors.ERC1155InvalidArrayLength(expectedPackedLength, packedRequirements.length);
        }

        for (uint256 i = 0; i < length; i++) {
            uint256 offset = i * 6;
            setItemRequirements(
                numericIds[i],
                uint8(packedRequirements[offset]),
                uint8(packedRequirements[offset + 1]),
                uint8(packedRequirements[offset + 2]),
                uint8(packedRequirements[offset + 3]),
                uint8(packedRequirements[offset + 4]),
                uint8(packedRequirements[offset + 5])
            );
        }
    }

    /**
     * @notice Look up a numeric ID from a string ID.
     * @param stringId The string identifier
     * @return numericId The numeric ID (0 if not found)
     */
    function getNumericId(string calldata stringId) public view returns (uint32 numericId) {
        bytes32 stringIdHash = keccak256(bytes(stringId));
        return ItemStringToId.getNumericId(stringIdHash);
    }

    /**
     * @notice Look up a string ID from a numeric ID.
     * @param numericId The numeric identifier
     * @return stringId The string ID (empty if not found)
     */
    function getStringId(uint32 numericId) public view returns (string memory stringId) {
        return ItemIdToString.getStringId(numericId);
    }

    /**
     * @notice Get the current item ID counter (total items registered).
     * @return count The number of items registered
     */
    function getItemCount() public view returns (uint32 count) {
        return ItemIdCounter.getValue();
    }
}
