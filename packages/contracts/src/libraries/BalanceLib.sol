// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { ItemBalance } from "../codegen/index.sol";

/**
 * @title BalanceLib
 * @notice Shared ERC-1155 balance helpers used by Inventory, Equipment, and Bank systems.
 * Extracted to eliminate duplication across three systems.
 */
library BalanceLib {
    function increase(address account, uint256 tokenId, uint256 amount) internal {
        uint256 current = ItemBalance.getBalance(account, tokenId);
        ItemBalance.set(account, tokenId, current + amount);
    }

    /**
     * @dev Decreases balance, clamping to zero on underflow.
     * Clamping instead of reverting is intentional: optimistic writes from the
     * game server can race with each other, so a brief desync is tolerable.
     * The server is the source of truth; the chain converges.
     */
    function decrease(address account, uint256 tokenId, uint256 amount) internal {
        uint256 current = ItemBalance.getBalance(account, tokenId);
        ItemBalance.set(account, tokenId, current >= amount ? current - amount : 0);
    }
}
