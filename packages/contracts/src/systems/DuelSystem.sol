// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { DuelRecord, PlayerStats, CharacterOwner, PlayerRegistry } from "../codegen/index.sol";
import { Errors } from "../libraries/Errors.sol";

/**
 * @title DuelSystem
 * @notice Records duel results on-chain after server-resolved combat.
 *
 * Access: Restricted to namespace owner (server operator).
 *
 * Duel flow:
 * 1. Players challenge and set stakes via game UI (WebSocket)
 * 2. Server manages the real-time duel (same combat system)
 * 3. When duel ends, server calls recordDuel() to commit result
 * 4. Stake transfers are handled by the server via InventorySystem/GoldSystem
 *
 * The DuelRecord is permanent on-chain history for leaderboards and verification.
 */
contract DuelSystem is System {
    /**
     * @notice Record a completed duel.
     *
     * @param duelId Unique duel ID (server-generated)
     * @param challengerAddress Challenger's wallet address
     * @param opponentAddress Opponent's wallet address
     * @param winnerAddress Winner's wallet address (must be challenger or opponent)
     * @param challengerStakeValue Total value of challenger's staked items/gold
     * @param opponentStakeValue Total value of opponent's staked items/gold
     * @param forfeit Whether the loser forfeited (rather than dying)
     */
    function recordDuel(
        bytes32 duelId,
        address challengerAddress,
        address opponentAddress,
        address winnerAddress,
        uint64 challengerStakeValue,
        uint64 opponentStakeValue,
        bool forfeit
    ) public {
        // Validate winner is a participant
        if (winnerAddress != challengerAddress && winnerAddress != opponentAddress) {
            revert Errors.InvalidDuelWinner(duelId, winnerAddress);
        }

        // Get character IDs for the record
        bytes32 challengerCharId = PlayerRegistry.getCharacterId(challengerAddress);
        bytes32 opponentCharId = PlayerRegistry.getCharacterId(opponentAddress);

        // Write duel record
        DuelRecord.set(
            duelId,
            challengerAddress,
            opponentAddress,
            winnerAddress,
            challengerCharId,
            opponentCharId,
            challengerStakeValue,
            opponentStakeValue,
            forfeit,
            uint64(block.timestamp)
        );

        // Update win/loss stats
        address loserAddress = (winnerAddress == challengerAddress) ? opponentAddress : challengerAddress;
        bytes32 winnerCharId = PlayerRegistry.getCharacterId(winnerAddress);
        bytes32 loserCharId = PlayerRegistry.getCharacterId(loserAddress);

        uint32 duelsWon = PlayerStats.getTotalDuelsWon(winnerCharId);
        PlayerStats.setTotalDuelsWon(winnerCharId, duelsWon + 1);

        uint32 duelsLost = PlayerStats.getTotalDuelsLost(loserCharId);
        PlayerStats.setTotalDuelsLost(loserCharId, duelsLost + 1);
    }

}
