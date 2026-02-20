import type { SimulationConfig } from "./model";

export type ExecutionChain = "bsc" | "base" | "solana";

export interface ChainExecutionProfile {
  chain: ExecutionChain;
  oracleLagMinutes: number;
  feeBpsDelta: number;
  maxLeverageMultiplier: number;
  oiCapMultiplier: number;
  orderLimitMultiplier: number;
  notionalLimitMultiplier: number;
  imbalanceLimitMultiplier: number;
  hedgeRateMultiplier: number;
  hedgeSpreadMultiplier: number;
  liquidationSlippageMultiplier: number;
  fundingIntervalMultiplier: number;
  attackSizeMultiplier: number;
}

const CHAIN_EXECUTION_PROFILES: Record<ExecutionChain, ChainExecutionProfile> =
  {
    bsc: {
      chain: "bsc",
      oracleLagMinutes: 2,
      feeBpsDelta: 1,
      maxLeverageMultiplier: 0.9,
      oiCapMultiplier: 0.88,
      orderLimitMultiplier: 0.85,
      notionalLimitMultiplier: 0.85,
      imbalanceLimitMultiplier: 0.82,
      hedgeRateMultiplier: 0.95,
      hedgeSpreadMultiplier: 1.1,
      liquidationSlippageMultiplier: 1.2,
      fundingIntervalMultiplier: 1.2,
      attackSizeMultiplier: 1.05,
    },
    base: {
      chain: "base",
      oracleLagMinutes: 1,
      feeBpsDelta: 0,
      maxLeverageMultiplier: 0.98,
      oiCapMultiplier: 0.94,
      orderLimitMultiplier: 0.98,
      notionalLimitMultiplier: 0.98,
      imbalanceLimitMultiplier: 0.95,
      hedgeRateMultiplier: 1.05,
      hedgeSpreadMultiplier: 0.95,
      liquidationSlippageMultiplier: 0.95,
      fundingIntervalMultiplier: 1,
      attackSizeMultiplier: 1,
    },
    solana: {
      chain: "solana",
      oracleLagMinutes: 0,
      feeBpsDelta: -1,
      maxLeverageMultiplier: 0.94,
      oiCapMultiplier: 0.9,
      orderLimitMultiplier: 1.1,
      notionalLimitMultiplier: 1.05,
      imbalanceLimitMultiplier: 0.9,
      hedgeRateMultiplier: 1.12,
      hedgeSpreadMultiplier: 0.9,
      liquidationSlippageMultiplier: 0.85,
      fundingIntervalMultiplier: 0.8,
      attackSizeMultiplier: 0.95,
    },
  };

const scaleInt = (value: number, multiplier: number, floor = 1): number =>
  Math.max(floor, Math.round(value * multiplier));

export const executionChainProfiles = CHAIN_EXECUTION_PROFILES as Readonly<
  Record<ExecutionChain, Readonly<ChainExecutionProfile>>
>;

export const applyChainExecutionProfile = (
  config: SimulationConfig,
  chain: ExecutionChain,
): SimulationConfig => {
  const profile = CHAIN_EXECUTION_PROFILES[chain];
  config.name = `${config.name}-${chain}`;

  config.clearinghouse.feeBps = Math.max(
    1,
    Math.round(config.clearinghouse.feeBps + profile.feeBpsDelta),
  );
  config.clearinghouse.globalOiCap = scaleInt(
    config.clearinghouse.globalOiCap,
    profile.oiCapMultiplier,
  );
  config.clearinghouse.maxLeverageMature = Math.max(
    2,
    Math.round(
      config.clearinghouse.maxLeverageMature * profile.maxLeverageMultiplier,
    ),
  );
  config.clearinghouse.maxLeverageListing = Math.max(
    1,
    Math.min(
      config.clearinghouse.maxLeverageMature,
      Math.round(
        config.clearinghouse.maxLeverageListing * profile.maxLeverageMultiplier,
      ),
    ),
  );
  config.clearinghouse.marketOrderLimitPerMinute = scaleInt(
    config.clearinghouse.marketOrderLimitPerMinute,
    profile.orderLimitMultiplier,
  );
  config.clearinghouse.marketNotionalLimitPerMinute = scaleInt(
    config.clearinghouse.marketNotionalLimitPerMinute,
    profile.notionalLimitMultiplier,
  );
  config.clearinghouse.marketNetImbalanceLimitPerMinute = scaleInt(
    config.clearinghouse.marketNetImbalanceLimitPerMinute,
    profile.imbalanceLimitMultiplier,
  );
  config.clearinghouse.traderOrderLimitPerMinute = scaleInt(
    config.clearinghouse.traderOrderLimitPerMinute,
    profile.orderLimitMultiplier,
  );
  config.clearinghouse.traderNotionalLimitPerMinute = scaleInt(
    config.clearinghouse.traderNotionalLimitPerMinute,
    profile.notionalLimitMultiplier,
  );
  config.clearinghouse.mmHedgeRatePerMinute = Math.max(
    0,
    config.clearinghouse.mmHedgeRatePerMinute * profile.hedgeRateMultiplier,
  );
  config.clearinghouse.mmHedgeHalfSpread = Math.max(
    0.0005,
    config.clearinghouse.mmHedgeHalfSpread * profile.hedgeSpreadMultiplier,
  );
  config.clearinghouse.liquidationSlippage = Math.max(
    0.001,
    config.clearinghouse.liquidationSlippage *
      profile.liquidationSlippageMultiplier,
  );
  config.clearinghouse.fundingIntervalMinutes = Math.max(
    1,
    Math.round(
      config.clearinghouse.fundingIntervalMinutes *
        profile.fundingIntervalMultiplier,
    ),
  );

  for (const regime of config.regimes ?? []) {
    regime.oracleLagMinutes = Math.max(
      0,
      Math.round((regime.oracleLagMinutes ?? 0) + profile.oracleLagMinutes),
    );
    if (regime.attackSizeMultiplier !== undefined) {
      regime.attackSizeMultiplier = Math.max(
        0.5,
        regime.attackSizeMultiplier * profile.attackSizeMultiplier,
      );
    }
  }
  return config;
};
