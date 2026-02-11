// SPDX-License-Identifier: MIT
pragma solidity >=0.8.24;

import { System } from "@latticexyz/world/src/System.sol";
import { PlayerStats, NpcKillCount } from "../codegen/index.sol";

/**
 * @title StatsSystem
 * @notice Manages player kill counts, death counts, and aggregate statistics.
 *
 * Access: Restricted to namespace owner (server operator).
 * Written optimistically after each combat encounter or death.
 */
contract StatsSystem is System {
    /**
     * @notice Record a mob kill for a player.
     * Increments both the per-NPC kill count and the aggregate total.
     *
     * @param characterId The character's bytes32 ID
     * @param npcId The NPC type identifier (keccak256 of string ID)
     * @param isBoss Whether this NPC is a boss
     */
    function recordMobKill(bytes32 characterId, bytes32 npcId, bool isBoss) public {
        // Increment per-NPC kill count
        uint32 currentKills = NpcKillCount.getKillCount(characterId, npcId);
        NpcKillCount.set(characterId, npcId, currentKills + 1);

        // Increment aggregate stats
        uint32 totalMobKills = PlayerStats.getTotalMobKills(characterId);
        PlayerStats.setTotalMobKills(characterId, totalMobKills + 1);

        if (isBoss) {
            uint32 totalBossKills = PlayerStats.getTotalBossKills(characterId);
            PlayerStats.setTotalBossKills(characterId, totalBossKills + 1);
        }
    }

    /**
     * @notice Batch record multiple mob kills in a single transaction.
     * @param characterId The character's bytes32 ID
     * @param npcIds Array of NPC type identifiers
     * @param isBoss Array of boss flags
     */
    function recordMobKillBatch(
        bytes32 characterId,
        bytes32[] calldata npcIds,
        bool[] calldata isBoss
    ) public {
        uint256 length = npcIds.length;
        uint32 mobKillIncrease = 0;
        uint32 bossKillIncrease = 0;

        for (uint256 i = 0; i < length; i++) {
            uint32 currentKills = NpcKillCount.getKillCount(characterId, npcIds[i]);
            NpcKillCount.set(characterId, npcIds[i], currentKills + 1);
            mobKillIncrease++;
            if (isBoss[i]) bossKillIncrease++;
        }

        uint32 totalMobKills = PlayerStats.getTotalMobKills(characterId);
        PlayerStats.setTotalMobKills(characterId, totalMobKills + mobKillIncrease);

        if (bossKillIncrease > 0) {
            uint32 totalBossKills = PlayerStats.getTotalBossKills(characterId);
            PlayerStats.setTotalBossKills(characterId, totalBossKills + bossKillIncrease);
        }
    }

    /**
     * @notice Record a player death.
     * @param characterId The character's bytes32 ID
     */
    function recordDeath(bytes32 characterId) public {
        uint32 totalDeaths = PlayerStats.getTotalDeaths(characterId);
        PlayerStats.setTotalDeaths(characterId, totalDeaths + 1);
    }

    /**
     * @notice Record a player kill (PvP).
     * @param killerCharacterId The killer's character ID
     */
    function recordPlayerKill(bytes32 killerCharacterId) public {
        uint32 totalPlayerKills = PlayerStats.getTotalPlayerKills(killerCharacterId);
        PlayerStats.setTotalPlayerKills(killerCharacterId, totalPlayerKills + 1);
    }

    /**
     * @notice Record XP earned (aggregate tracking).
     * @param characterId The character's bytes32 ID
     * @param xpAmount Total XP earned in this batch
     */
    function recordXpEarned(bytes32 characterId, uint64 xpAmount) public {
        uint64 totalXp = PlayerStats.getTotalXpEarned(characterId);
        PlayerStats.setTotalXpEarned(characterId, totalXp + xpAmount);
    }

    /**
     * @notice Record gold earned (aggregate tracking).
     * @param characterId The character's bytes32 ID
     * @param goldAmount Gold earned in this batch
     */
    function recordGoldEarned(bytes32 characterId, uint64 goldAmount) public {
        uint64 totalGold = PlayerStats.getTotalGoldEarned(characterId);
        PlayerStats.setTotalGoldEarned(characterId, totalGold + goldAmount);
    }

    /**
     * @notice Record a completed trade (aggregate tracking).
     * @param characterId The character's bytes32 ID
     */
    function recordTradeCompleted(bytes32 characterId) public {
        uint32 totalTrades = PlayerStats.getTotalTradesCompleted(characterId);
        PlayerStats.setTotalTradesCompleted(characterId, totalTrades + 1);
    }

    /**
     * @notice Record a duel result.
     * @param characterId The character's bytes32 ID
     * @param won Whether the player won
     */
    function recordDuelResult(bytes32 characterId, bool won) public {
        if (won) {
            uint32 duelsWon = PlayerStats.getTotalDuelsWon(characterId);
            PlayerStats.setTotalDuelsWon(characterId, duelsWon + 1);
        } else {
            uint32 duelsLost = PlayerStats.getTotalDuelsLost(characterId);
            PlayerStats.setTotalDuelsLost(characterId, duelsLost + 1);
        }
    }

    /**
     * @notice Batch update all stats at once (most gas efficient for large updates).
     * @param characterId The character's bytes32 ID
     * @param totalMobKills New total mob kills
     * @param totalDeaths New total deaths
     * @param totalPlayerKills New total player kills
     * @param totalBossKills New total boss kills
     * @param totalXpEarned New total XP earned
     * @param totalGoldEarned New total gold earned
     * @param totalTradesCompleted New total trades completed
     * @param totalDuelsWon New total duels won
     * @param totalDuelsLost New total duels lost
     */
    function setPlayerStats(
        bytes32 characterId,
        uint32 totalMobKills,
        uint32 totalDeaths,
        uint32 totalPlayerKills,
        uint32 totalBossKills,
        uint64 totalXpEarned,
        uint64 totalGoldEarned,
        uint32 totalTradesCompleted,
        uint32 totalDuelsWon,
        uint32 totalDuelsLost
    ) public {
        PlayerStats.set(
            characterId,
            totalMobKills,
            totalDeaths,
            totalPlayerKills,
            totalBossKills,
            totalXpEarned,
            totalGoldEarned,
            totalTradesCompleted,
            totalDuelsWon,
            totalDuelsLost
        );
    }
}
