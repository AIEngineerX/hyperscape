/**
 * StreamingDuelScheduler Types
 *
 * Types for the 15-minute duel cycle streaming mode
 */

export type StreamingPhase =
  | "IDLE"
  | "ANNOUNCEMENT"
  | "COUNTDOWN"
  | "FIGHTING"
  | "RESOLUTION";

export interface AgentContestant {
  characterId: string;
  name: string;
  provider: string;
  model: string;
  combatLevel: number;
  wins: number;
  losses: number;
  currentHp: number;
  maxHp: number;
  originalPosition: [number, number, number];
  damageDealtThisFight: number;
}

export interface StreamingDuelCycle {
  cycleId: string;
  phase: StreamingPhase;

  // Timing (all in milliseconds)
  cycleStartTime: number;
  phaseStartTime: number;

  // Contestants (null during IDLE)
  agent1: AgentContestant | null;
  agent2: AgentContestant | null;

  // Active duel tracking
  duelId: string | null;
  arenaId: number | null;
  countdownValue: number | null; // 3, 2, 1, 0

  // Result (set during RESOLUTION)
  winnerId: string | null;
  loserId: string | null;
  winReason: "kill" | "hp_advantage" | "damage_advantage" | "draw" | null;
}

export interface AgentDuelStats {
  characterId: string;
  agentName: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  draws: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  killStreak: number;
  currentStreak: number;
  lastDuelAt: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  characterId: string;
  name: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  combatLevel: number;
  currentStreak: number;
}

export interface StreamingStateUpdate {
  type: "STREAMING_STATE_UPDATE";
  cycle: {
    cycleId: string;
    phase: StreamingPhase;
    cycleStartTime: number;
    phaseStartTime: number;
    phaseEndTime: number;
    timeRemaining: number;

    agent1: {
      id: string;
      name: string;
      provider: string;
      model: string;
      hp: number;
      maxHp: number;
      combatLevel: number;
      wins: number;
      losses: number;
      damageDealtThisFight: number;
    } | null;

    agent2: {
      id: string;
      name: string;
      provider: string;
      model: string;
      hp: number;
      maxHp: number;
      combatLevel: number;
      wins: number;
      losses: number;
      damageDealtThisFight: number;
    } | null;

    countdown: number | null;
    winnerId: string | null;
    winnerName: string | null;
    winReason: string | null;
  };
  leaderboard: LeaderboardEntry[];
  cameraTarget: string | null;
}

// Timing constants (in milliseconds)
export const STREAMING_TIMING = {
  CYCLE_DURATION: 15 * 60 * 1000, // 15 minutes total
  ANNOUNCEMENT_DURATION: 5 * 60 * 1000, // 5 minutes
  FIGHTING_DURATION: 9 * 60 * 1000 + 30 * 1000, // 9:30 (leaving 30s for end warning)
  END_WARNING_DURATION: 30 * 1000, // 30 seconds
  RESOLUTION_DURATION: 15 * 1000, // 15 seconds to show winner
  COUNTDOWN_TICKS: 3, // 3-2-1-FIGHT
  STATE_BROADCAST_INTERVAL: 1000, // Broadcast every 1 second
  FIGHT_BROADCAST_INTERVAL: 200, // Faster updates during fight
} as const;

// Food item to fill inventory with
export const DUEL_FOOD_ITEM = "shark";
export const DUEL_FOOD_HEAL_AMOUNT = 20;
