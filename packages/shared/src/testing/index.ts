export { LoadTestBot } from "./LoadTestBot";
export type {
  LoadTestBehavior,
  LoadTestBotConfig,
  LoadTestBotMetrics,
} from "./LoadTestBot";

export { BotPoolManager } from "./BotPoolManager";
export type { BotPoolConfig, AggregatedMetrics } from "./BotPoolManager";

export { DuelBot } from "./DuelBot";
export type {
  CombatPersonality,
  DuelBotConfig,
  DuelBotState,
  DuelBotMetrics,
} from "./DuelBot";

export { DuelMatchmaker } from "./DuelMatchmaker";
export type {
  DuelMatchmakerConfig,
  MatchResult,
  MatchmakerStats,
} from "./DuelMatchmaker";
