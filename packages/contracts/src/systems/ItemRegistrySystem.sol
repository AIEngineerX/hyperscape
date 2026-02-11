// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { ItemIdToString, ItemStringToId, ItemIdCounter, ItemDefinition, ItemCombatBonuses, ItemRequirements } from "../codegen/index.sol";
import { ItemCategory } from "../codegen/common.sol";
import { Constants } from "../libraries/Constants.sol";
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
 * 4. Call setItemCombatBonuses() for equipable items
 * 5. Call setItemRequirements() for items with level requirements
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

        ItemDefinition.set(numericId, name, itemType, value, stackable, tradeable, equipSlot, healAmount);
    }

    /**
     * @notice Batch set item definitions. Gas-efficient for seeding.
     * @param numericIds Array of item numeric IDs
     * @param names Array of display names
     * @param itemTypes Array of item categories
     * @param values Array of base values
     * @param stackables Array of stackable flags
     * @param tradeables Array of tradeable flags
     * @param equipSlots Array of equipment slots
     * @param healAmounts Array of heal amounts
     */
    function setItemDefinitionBatch(
        uint32[] calldata numericIds,
        string[] calldata names,
        ItemCategory[] calldata itemTypes,
        uint32[] calldata values,
        bool[] calldata stackables,
        bool[] calldata tradeables,
        uint8[] calldata equipSlots,
        uint16[] calldata healAmounts
    ) public {
        uint256 length = numericIds.length;
        for (uint256 i = 0; i < length; i++) {
            ItemDefinition.set(
                numericIds[i],
                names[i],
                itemTypes[i],
                values[i],
                stackables[i],
                tradeables[i],
                equipSlots[i],
                healAmounts[i]
            );
        }
    }

    /**
     * @notice Set combat bonuses for an equippable item.
     * @param numericId The item's numeric ID
     * @param attackStab Stab attack bonus
     * @param attackSlash Slash attack bonus
     * @param attackCrush Crush attack bonus
     * @param attackRanged Ranged attack bonus
     * @param attackMagic Magic attack bonus
     * @param defenseStab Stab defense bonus
     * @param defenseSlash Slash defense bonus
     * @param defenseCrush Crush defense bonus
     * @param defenseRanged Ranged defense bonus
     * @param defenseMagic Magic defense bonus
     * @param meleeStrength Melee strength bonus
     * @param rangedStrength Ranged strength bonus
     * @param magicDamage Magic damage bonus
     * @param prayer Prayer bonus
     */
    function setItemCombatBonuses(
        uint32 numericId,
        int16 attackStab,
        int16 attackSlash,
        int16 attackCrush,
        int16 attackRanged,
        int16 attackMagic,
        int16 defenseStab,
        int16 defenseSlash,
        int16 defenseCrush,
        int16 defenseRanged,
        int16 defenseMagic,
        int16 meleeStrength,
        int16 rangedStrength,
        int16 magicDamage,
        int16 prayer
    ) public {
        ItemCombatBonuses.set(
            numericId,
            attackStab, attackSlash, attackCrush, attackRanged, attackMagic,
            defenseStab, defenseSlash, defenseCrush, defenseRanged, defenseMagic,
            meleeStrength, rangedStrength, magicDamage, prayer
        );
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
