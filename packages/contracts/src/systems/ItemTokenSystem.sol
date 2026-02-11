// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { ItemBalance, ItemOperatorApproval } from "../codegen/index.sol";
import { Errors } from "../libraries/Errors.sol";

/**
 * @title ItemTokenSystem
 * @notice ERC-1155-like interface for game item ownership.
 *
 * Access: Restricted to namespace owner (operator) for mint/burn.
 * Approval and transfer queries are view functions.
 *
 * Item balances are stored in MUD tables (ItemBalance), which means
 * they auto-sync to all MUD clients via the indexer. This is the
 * key advantage over a separate ERC-1155 contract.
 *
 * The ItemBalance table tracks TOTAL ownership per (address, tokenId).
 * The game's slot tables (InventorySlot, EquipmentSlot, BankSlot)
 * track WHERE items are within the game.
 *
 * External transfers (for marketplace trading) are handled by the
 * transferItem/batchTransferItems functions which update balances.
 * The caller must be approved or be the owner.
 */
contract ItemTokenSystem is System {
    // ERC-1155 events (emitted for indexer/marketplace compatibility)
    event TransferSingle(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256 id,
        uint256 value
    );

    event TransferBatch(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256[] ids,
        uint256[] values
    );

    event ApprovalForAll(
        address indexed account,
        address indexed operator,
        bool approved
    );

    /**
     * @notice Get the balance of a specific token for an account.
     * @param account The address to query
     * @param tokenId The token ID (numeric item ID)
     * @return balance The token balance
     */
    function balanceOf(address account, uint256 tokenId) public view returns (uint256 balance) {
        return ItemBalance.getBalance(account, tokenId);
    }

    /**
     * @notice Get balances for multiple token IDs for a single account.
     * @param account The address to query
     * @param tokenIds Array of token IDs
     * @return balances Array of balances
     */
    function balanceOfBatch(
        address account,
        uint256[] calldata tokenIds
    ) public view returns (uint256[] memory balances) {
        balances = new uint256[](tokenIds.length);
        for (uint256 i = 0; i < tokenIds.length; i++) {
            balances[i] = ItemBalance.getBalance(account, tokenIds[i]);
        }
    }

    /**
     * @notice Set approval for an operator to manage all of caller's tokens.
     * This enables marketplace contracts to transfer items on behalf of players.
     * @param operator The operator address to approve/revoke
     * @param approved Whether to approve or revoke
     */
    function setApprovalForAll(address operator, bool approved) public {
        address owner = _msgSender();
        if (owner == operator) revert Errors.InvalidAddress();

        ItemOperatorApproval.set(owner, operator, approved);
        emit ApprovalForAll(owner, operator, approved);
    }

    /**
     * @notice Check if an operator is approved for an owner's tokens.
     * @param owner The token owner
     * @param operator The operator to check
     * @return approved Whether the operator is approved
     */
    function isApprovedForAll(address owner, address operator) public view returns (bool approved) {
        return ItemOperatorApproval.getApproved(owner, operator);
    }

    /**
     * @notice Transfer a single item between addresses.
     * Caller must be the owner or an approved operator.
     * This is for external transfers (marketplace).
     * In-game transfers go through the game systems.
     *
     * @param from The current owner
     * @param to The recipient
     * @param tokenId The token ID (numeric item ID)
     * @param amount The quantity to transfer
     */
    function transferItem(
        address from,
        address to,
        uint256 tokenId,
        uint256 amount
    ) public {
        address operator = _msgSender();
        if (from != operator && !ItemOperatorApproval.getApproved(from, operator)) {
            revert Errors.ERC1155MissingApproval(operator, from);
        }
        if (to == address(0)) revert Errors.ERC1155InvalidReceiver(to);

        uint256 fromBalance = ItemBalance.getBalance(from, tokenId);
        if (fromBalance < amount) {
            revert Errors.ERC1155InsufficientBalance(from, fromBalance, amount, tokenId);
        }

        ItemBalance.set(from, tokenId, fromBalance - amount);
        uint256 toBalance = ItemBalance.getBalance(to, tokenId);
        ItemBalance.set(to, tokenId, toBalance + amount);

        emit TransferSingle(operator, from, to, tokenId, amount);
    }

    /**
     * @notice Batch transfer multiple items between addresses.
     * @param from The current owner
     * @param to The recipient
     * @param tokenIds Array of token IDs
     * @param amounts Array of quantities
     */
    function batchTransferItems(
        address from,
        address to,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) public {
        address operator = _msgSender();
        if (from != operator && !ItemOperatorApproval.getApproved(from, operator)) {
            revert Errors.ERC1155MissingApproval(operator, from);
        }
        if (to == address(0)) revert Errors.ERC1155InvalidReceiver(to);
        if (tokenIds.length != amounts.length) {
            revert Errors.ERC1155InvalidArrayLength(tokenIds.length, amounts.length);
        }

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 fromBalance = ItemBalance.getBalance(from, tokenIds[i]);
            if (fromBalance < amounts[i]) {
                revert Errors.ERC1155InsufficientBalance(from, fromBalance, amounts[i], tokenIds[i]);
            }
            ItemBalance.set(from, tokenIds[i], fromBalance - amounts[i]);
            uint256 toBalance = ItemBalance.getBalance(to, tokenIds[i]);
            ItemBalance.set(to, tokenIds[i], toBalance + amounts[i]);
        }

        emit TransferBatch(operator, from, to, tokenIds, amounts);
    }

    /**
     * @notice Mint items (operator only, called by game systems).
     * @param to The recipient address
     * @param tokenId The token ID
     * @param amount The quantity to mint
     */
    function mint(address to, uint256 tokenId, uint256 amount) public {
        if (to == address(0)) revert Errors.ERC1155InvalidReceiver(to);

        uint256 currentBalance = ItemBalance.getBalance(to, tokenId);
        ItemBalance.set(to, tokenId, currentBalance + amount);

        emit TransferSingle(_msgSender(), address(0), to, tokenId, amount);
    }

    /**
     * @notice Burn items (operator only, called by game systems).
     * @param from The owner address
     * @param tokenId The token ID
     * @param amount The quantity to burn
     */
    function burn(address from, uint256 tokenId, uint256 amount) public {
        uint256 currentBalance = ItemBalance.getBalance(from, tokenId);
        if (currentBalance < amount) {
            revert Errors.ERC1155InsufficientBalance(from, currentBalance, amount, tokenId);
        }
        ItemBalance.set(from, tokenId, currentBalance - amount);

        emit TransferSingle(_msgSender(), from, address(0), tokenId, amount);
    }

    /**
     * @notice Batch mint items (operator only).
     * @param to The recipient address
     * @param tokenIds Array of token IDs
     * @param amounts Array of quantities
     */
    function mintBatch(
        address to,
        uint256[] calldata tokenIds,
        uint256[] calldata amounts
    ) public {
        if (to == address(0)) revert Errors.ERC1155InvalidReceiver(to);
        if (tokenIds.length != amounts.length) {
            revert Errors.ERC1155InvalidArrayLength(tokenIds.length, amounts.length);
        }

        for (uint256 i = 0; i < tokenIds.length; i++) {
            uint256 currentBalance = ItemBalance.getBalance(to, tokenIds[i]);
            ItemBalance.set(to, tokenIds[i], currentBalance + amounts[i]);
        }

        emit TransferBatch(_msgSender(), address(0), to, tokenIds, amounts);
    }
}
