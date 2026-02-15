// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { ShopItem, InventorySlot, GoldBalance, ItemBalance, CharacterOwner } from "../codegen/index.sol";
import { Constants } from "../libraries/Constants.sol";
import { Errors } from "../libraries/Errors.sol";

/**
 * @title ShopSystem
 * @notice Manages NPC shop transactions on-chain.
 *
 * Access: Restricted to namespace owner (server operator).
 *
 * The server processes buy/sell requests and commits the result:
 * - Buy: remove gold, add item to inventory, decrement shop stock
 * - Sell: remove item from inventory, add gold, increment shop stock
 *
 * Shop data is seeded at deploy time from stores.json.
 */
contract ShopSystem is System {
    /**
     * @notice Seed a shop item during deployment.
     * @param shopId The shop's bytes32 ID (keccak256 of string ID)
     * @param slotIndex Slot index within the shop
     * @param itemId The item's numeric ID
     * @param basePrice Price in gold
     * @param maxStock Maximum stock (-1 for unlimited)
     * @param currentStock Current stock level
     */
    function seedShopItem(
        bytes32 shopId,
        uint8 slotIndex,
        uint32 itemId,
        uint32 basePrice,
        int32 maxStock,
        int32 currentStock
    ) public {
        ShopItem.set(shopId, slotIndex, itemId, basePrice, maxStock, currentStock, uint64(block.number));
    }

    /**
     * @notice Batch seed shop items (gas efficient for deployment).
     */
    function seedShopItemBatch(
        bytes32[] calldata shopIds,
        uint8[] calldata slotIndices,
        uint32[] calldata itemIds,
        uint32[] calldata basePrices,
        int32[] calldata maxStocks,
        int32[] calldata currentStocks
    ) public {
        uint256 length = shopIds.length;
        for (uint256 i = 0; i < length; i++) {
            ShopItem.set(
                shopIds[i], slotIndices[i], itemIds[i],
                basePrices[i], maxStocks[i], currentStocks[i],
                uint64(block.number)
            );
        }
    }

    /**
     * @notice Record a shop purchase (player buys from shop).
     * Server has already validated distance, inventory space, etc.
     *
     * @param characterId The buyer's character ID
     * @param shopId The shop ID
     * @param slotIndex Shop slot being purchased from
     * @param quantity Number of items to buy
     * @param targetInventorySlot Inventory slot to place item in
     */
    function recordBuy(
        bytes32 characterId,
        bytes32 shopId,
        uint8 slotIndex,
        uint32 quantity,
        uint8 targetInventorySlot
    ) public {
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);

        // Read shop item
        uint32 itemId = ShopItem.getItemId(shopId, slotIndex);
        uint32 price = ShopItem.getBasePrice(shopId, slotIndex);
        int32 currentStock = ShopItem.getCurrentStock(shopId, slotIndex);
        int32 maxStock = ShopItem.getMaxStock(shopId, slotIndex);

        if (itemId == Constants.EMPTY_ITEM_ID) revert Errors.ShopItemNotFound(shopId, slotIndex);

        // Check stock (maxStock = -1 means unlimited)
        if (maxStock >= 0 && currentStock < int32(quantity)) {
            revert Errors.InsufficientStock(shopId, slotIndex);
        }

        // Calculate total cost
        uint64 totalCost = uint64(price) * uint64(quantity);

        // Deduct gold
        uint64 playerGold = GoldBalance.getAmount(characterId);
        if (playerGold < totalCost) revert Errors.InsufficientGold(characterId, totalCost, playerGold);
        GoldBalance.set(characterId, playerGold - totalCost);

        // Add item to inventory
        if (targetInventorySlot < Constants.MAX_INVENTORY_SLOTS) {
            // Check if slot has same item (stack)
            uint32 existingItemId = InventorySlot.getItemId(characterId, targetInventorySlot);
            if (existingItemId == itemId) {
                uint32 existingQty = InventorySlot.getQuantity(characterId, targetInventorySlot);
                InventorySlot.setQuantity(characterId, targetInventorySlot, existingQty + quantity);
            } else {
                InventorySlot.set(characterId, targetInventorySlot, itemId, quantity);
            }

            // Update ERC-1155 balance
            uint256 currentBalance = ItemBalance.getBalance(playerAddress, uint256(itemId));
            ItemBalance.set(playerAddress, uint256(itemId), currentBalance + quantity);
        }

        // Decrement shop stock (if not unlimited)
        if (maxStock >= 0) {
            ShopItem.setCurrentStock(shopId, slotIndex, currentStock - int32(quantity));
        }
    }

    /**
     * @notice Record a shop sale (player sells to shop).
     *
     * @param characterId The seller's character ID
     * @param inventorySlot Inventory slot to sell from
     * @param quantity Number of items to sell
     * @param sellPrice Price per item (server calculates buyback rate)
     */
    function recordSell(
        bytes32 characterId,
        bytes32,
        uint8 inventorySlot,
        uint32 quantity,
        uint32 sellPrice
    ) public {
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);

        // Read item from inventory
        uint32 itemId = InventorySlot.getItemId(characterId, inventorySlot);
        uint32 available = InventorySlot.getQuantity(characterId, inventorySlot);

        if (itemId == Constants.EMPTY_ITEM_ID || available == 0) {
            revert Errors.InventorySlotEmpty(characterId, inventorySlot);
        }
        if (available < quantity) {
            revert Errors.InsufficientQuantity(characterId, inventorySlot, quantity, available);
        }

        // Remove item from inventory
        uint32 remaining = available - quantity;
        if (remaining == 0) {
            InventorySlot.deleteRecord(characterId, inventorySlot);
        } else {
            InventorySlot.setQuantity(characterId, inventorySlot, remaining);
        }

        // Update ERC-1155 balance
        uint256 currentBalance = ItemBalance.getBalance(playerAddress, uint256(itemId));
        if (currentBalance >= quantity) {
            ItemBalance.set(playerAddress, uint256(itemId), currentBalance - quantity);
        }

        // Add gold to player
        uint64 totalGold = uint64(sellPrice) * uint64(quantity);
        uint64 playerGold = GoldBalance.getAmount(characterId);
        uint64 newGold = playerGold + totalGold;
        if (newGold > Constants.MAX_GOLD) newGold = Constants.MAX_GOLD;
        GoldBalance.set(characterId, newGold);
    }

    /**
     * @notice Restock a shop item (called periodically by server).
     * @param shopId The shop ID
     * @param slotIndex Shop slot
     * @param newStock New stock level
     */
    function restockShopItem(bytes32 shopId, uint8 slotIndex, int32 newStock) public {
        ShopItem.setCurrentStock(shopId, slotIndex, newStock);
        ShopItem.setLastRestockBlock(shopId, slotIndex, uint64(block.number));
    }
}
