// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { GoldBalance, CharacterOwner } from "../codegen/index.sol";
import { Constants } from "../libraries/Constants.sol";
import { Errors } from "../libraries/Errors.sol";

import { ResourceId, WorldResourceIdLib } from "@latticexyz/world/src/WorldResourceId.sol";
import { IWorldCall } from "@latticexyz/world/src/IWorldKernel.sol";
import { ERC20Registry } from "@latticexyz/world-module-erc20/src/codegen/index.sol";
import { RESOURCE_TABLE } from "@latticexyz/store/src/storeResourceTypes.sol";
import { RESOURCE_SYSTEM } from "@latticexyz/world/src/worldResourceTypes.sol";

/**
 * @title GoldSystem
 * @notice Manages ERC-20 HyperGold minting, burning, and in-game gold synchronization.
 *
 * Access: Restricted to namespace owner (server operator).
 *
 * The GoldBalance table tracks in-game gold (fast, used by game logic).
 * The ERC-20 HyperGold token tracks on-chain gold (for external trading).
 *
 * The server mints ERC-20 tokens when gold is earned and burns when spent.
 * This keeps the ERC-20 supply in sync with the in-game economy.
 */
contract GoldSystem is System {
    /**
     * @notice Mint gold to a player (mob drop, quest reward, shop sell).
     * Updates both the GoldBalance table and the ERC-20 token supply.
     *
     * @param characterId The character's bytes32 ID
     * @param amount Gold amount to mint
     */
    function mintGold(bytes32 characterId, uint64 amount) public {
        if (amount == 0) revert Errors.ZeroAmount();

        // Update in-game balance
        uint64 current = GoldBalance.getAmount(characterId);
        uint64 newAmount = current + amount;
        if (newAmount > Constants.MAX_GOLD) newAmount = Constants.MAX_GOLD;
        GoldBalance.set(characterId, newAmount);

        // Mint ERC-20 tokens to the player's wallet
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);
        if (playerAddress != address(0)) {
            _mintERC20(playerAddress, uint256(amount));
        }
    }

    /**
     * @notice Burn gold from a player (shop buy, death penalty).
     * Updates both the GoldBalance table and the ERC-20 token supply.
     *
     * @param characterId The character's bytes32 ID
     * @param amount Gold amount to burn
     */
    function burnGold(bytes32 characterId, uint64 amount) public {
        if (amount == 0) revert Errors.ZeroAmount();

        uint64 current = GoldBalance.getAmount(characterId);
        if (current < amount) revert Errors.InsufficientGold(characterId, amount, current);
        GoldBalance.set(characterId, current - amount);

        // Burn ERC-20 tokens from the player's wallet
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);
        if (playerAddress != address(0)) {
            _burnERC20(playerAddress, uint256(amount));
        }
    }

    /**
     * @notice Transfer gold between two characters (in-game transfer).
     * @param fromCharId Sender's character ID
     * @param toCharId Receiver's character ID
     * @param amount Gold amount to transfer
     */
    function transferGold(bytes32 fromCharId, bytes32 toCharId, uint64 amount) public {
        if (amount == 0) revert Errors.ZeroAmount();

        uint64 fromBalance = GoldBalance.getAmount(fromCharId);
        if (fromBalance < amount) revert Errors.InsufficientGold(fromCharId, amount, fromBalance);

        GoldBalance.set(fromCharId, fromBalance - amount);

        uint64 toBalance = GoldBalance.getAmount(toCharId);
        uint64 newToBalance = toBalance + amount;
        if (newToBalance > Constants.MAX_GOLD) newToBalance = Constants.MAX_GOLD;
        GoldBalance.set(toCharId, newToBalance);

        // Transfer ERC-20 between wallets
        address fromAddress = CharacterOwner.getPlayerAddress(fromCharId);
        address toAddress = CharacterOwner.getPlayerAddress(toCharId);
        if (fromAddress != address(0) && toAddress != address(0)) {
            _transferERC20(fromAddress, toAddress, uint256(amount));
        }
    }

    /**
     * @notice Sync in-game gold balance to ERC-20 (for migration/correction).
     * Calculates the diff between current ERC-20 balance and in-game balance,
     * then mints or burns to match.
     *
     * @param characterId The character's bytes32 ID
     */
    function syncGoldBalance(bytes32 characterId) public {
        uint64 inGameGold = GoldBalance.getAmount(characterId);
        address playerAddress = CharacterOwner.getPlayerAddress(characterId);
        if (playerAddress == address(0)) return;

        uint256 erc20Balance = _getERC20Balance(playerAddress);
        uint256 targetBalance = uint256(inGameGold);

        if (erc20Balance < targetBalance) {
            _mintERC20(playerAddress, targetBalance - erc20Balance);
        } else if (erc20Balance > targetBalance) {
            _burnERC20(playerAddress, erc20Balance - targetBalance);
        }
    }

    // =========================================================================
    // Internal: ERC-20 Operations
    // =========================================================================

    /**
     * @dev Resolve the ERC-20 token system ResourceId for the gold namespace.
     */
    function _getGoldTokenSystem() internal pure returns (ResourceId) {
        return WorldResourceIdLib.encode(RESOURCE_SYSTEM, "gold", "ERC20System");
    }

    function _mintERC20(address to, uint256 amount) internal {
        ResourceId goldSystem = _getGoldTokenSystem();
        // _world() returns the World contract address (inherited from System base)
        // Non-root systems are called via `call`, so address(this) is the system, not the World
        IWorldCall(_world()).call(
            goldSystem,
            abi.encodeWithSignature("mint(address,uint256)", to, amount)
        );
    }

    function _burnERC20(address from, uint256 amount) internal {
        ResourceId goldSystem = _getGoldTokenSystem();
        IWorldCall(_world()).call(
            goldSystem,
            abi.encodeWithSignature("burn(address,uint256)", from, amount)
        );
    }

    function _transferERC20(address from, address to, uint256 amount) internal {
        // For in-game transfers, we burn from sender and mint to receiver
        // This avoids needing transfer approval
        _burnERC20(from, amount);
        _mintERC20(to, amount);
    }

    function _getTokenAddress() internal view returns (address) {
        ResourceId namespaceResource = WorldResourceIdLib.encodeNamespace(bytes14("gold"));
        ResourceId registryId = WorldResourceIdLib.encode(RESOURCE_TABLE, "erc20-module", "ERC20Registry");
        return ERC20Registry.getTokenAddress(registryId, namespaceResource);
    }

    function _getERC20Balance(address account) internal view returns (uint256) {
        address token = _getTokenAddress();
        (bool success, bytes memory data) = token.staticcall(
            abi.encodeWithSignature("balanceOf(address)", account)
        );
        if (success && data.length >= 32) {
            return abi.decode(data, (uint256));
        }
        return 0;
    }
}
