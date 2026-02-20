import {
  DuelArenaSimulation,
  type SimulationConfig,
  type SimulationSummary,
} from "./model";

const DAY = 24 * 60;
const HOUR = 60;

const baseConfig = (name: string, seed: number): SimulationConfig => ({
  name,
  seed,
  totalMinutes: 28 * DAY,
  initialAgentCount: 10,
  entrants: {
    enabled: true,
    intervalMinutes: 7 * DAY,
  },
  regimes: [],
  rating: {
    initMu: 0,
    initSigma: 1.8,
    sigmaFloor: 0.35,
    sigmaCeil: 3.2,
    sigmaRef: 1.6,
    sigmaShrinkPerDuel: 0.985,
    sigmaInactivityPerDay: 0.18,
    patchSigmaShock: 0.32,
    baseK: 0.24,
    expectationScale: 1.1,
  },
  index: {
    beta: 0.9,
    uncertaintyPenalty: 0.08,
    maxLogitStepPerMinute: 0.08,
  },
  duel: {
    duelIntervalMinutes: 5,
    patchIntervalMinutes: 14 * DAY,
    matchRepeatPenaltyMinutes: 90,
    duelOutcomeScale: 1.5,
    duelNoise: 0.22,
  },
  evolution: {
    levelSkillCoeff: 0.04,
    passiveXpPerMinute: 0.32,
    duelXp: 12,
    skillDriftStdPerMinute: 0.008,
  },
  clearinghouse: {
    traderCount: 100,
    traderCollateralMean: 700,
    traderCollateralStd: 180,
    traderRespawnMinutes: 0,
    traderRespawnCollateralMean: 700,
    traderRespawnCollateralStd: 180,
    initialMarginRatio: 0.025,
    maintenanceMarginRatio: 0.0175,
    maintenanceBuffer: 0.004,
    liquidationPenaltyRate: 0.0075,
    liquidationSlippage: 0.02,
    feeBps: 8,
    feeSplitToMm: 0.5,
    insuranceSeed: 20_000,
    globalOiCap: 300_000,
    perMarketOiFloor: 2_500,
    perMarketOiScale: 55_000,
    listingOiMultiplier: 0.22,
    listingPhaseMinutes: 24 * 60,
    stabilizationMinutes: 7 * DAY,
    maxLeverageMature: 40,
    maxLeverageListing: 8,
    baseHalfSpread: 0.015,
    baseDepth: 1_400,
    impactSlope: 0.18,
    toxicitySpreadMultiplier: 1.2,
    toxicityDepthMultiplier: 1.4,
    orderFlowPerMinute: 0.28,
    informedFlowShare: 0.33,
    signalNoise: 0.08,
    orderSizeLogMean: 3.0,
    orderSizeLogStd: 0.75,
    fundingIntervalMinutes: 5,
    fundingSensitivity: 0.0025,
    fundingClamp: 0.01,
    enableAdl: true,
    mmInventoryCarryPerMinute: 0.00004,
    mmInventorySkewImpact: 0.00004,
    mmHedgeRatePerMinute: 0.04,
    mmHedgeHalfSpread: 0.002,
    maxOrderQuantity: 260,
    marketOrderLimitPerMinute: 180,
    marketNotionalLimitPerMinute: 3_600,
    marketNetImbalanceLimitPerMinute: 1_200,
    traderOrderLimitPerMinute: 8,
    traderNotionalLimitPerMinute: 360,
    riskGovernor: {
      enabled: false,
      minStateDurationMinutes: 20,
      thresholds: {
        toxicityEnter: 0.45,
        toxicityExit: 0.3,
        informedFlowEnter: 0.68,
        informedFlowExit: 0.54,
        stressDrawdownEnter: 0.18,
        stressDrawdownExit: 0.12,
        stressCoverageEnter: 0.55,
        stressCoverageExit: 0.75,
      },
      profiles: {
        NORMAL: {
          spreadMultiplier: 1,
          depthMultiplier: 1,
          leverageMultiplier: 1,
          oiCapMultiplier: 1,
          marketOrderLimitMultiplier: 1,
          marketNotionalLimitMultiplier: 1,
          marketImbalanceLimitMultiplier: 1,
          feeSurchargeBps: 0,
          attackFlowMultiplier: 1,
          attackFeeSurchargeBps: 0,
          hedgeRateMultiplier: 1,
        },
        TOXIC: {
          spreadMultiplier: 1.35,
          depthMultiplier: 0.8,
          leverageMultiplier: 0.8,
          oiCapMultiplier: 0.85,
          marketOrderLimitMultiplier: 0.8,
          marketNotionalLimitMultiplier: 0.8,
          marketImbalanceLimitMultiplier: 0.75,
          feeSurchargeBps: 2,
          attackFlowMultiplier: 0.85,
          attackFeeSurchargeBps: 4,
          hedgeRateMultiplier: 1.3,
        },
        STRESS: {
          spreadMultiplier: 1.75,
          depthMultiplier: 0.6,
          leverageMultiplier: 0.65,
          oiCapMultiplier: 0.72,
          marketOrderLimitMultiplier: 0.55,
          marketNotionalLimitMultiplier: 0.55,
          marketImbalanceLimitMultiplier: 0.45,
          feeSurchargeBps: 6,
          attackFlowMultiplier: 0.55,
          attackFeeSurchargeBps: 8,
          hedgeRateMultiplier: 2.2,
        },
      },
    },
  },
});

export const baselineConvergenceScenario = (seed = 7): SimulationConfig => {
  const config = baseConfig("baseline-convergence", seed);
  config.totalMinutes = 21 * DAY;
  config.entrants.enabled = false;
  config.clearinghouse.orderFlowPerMinute = 0.2;
  config.clearinghouse.informedFlowShare = 0.2;
  config.clearinghouse.baseDepth = 2_000;
  config.clearinghouse.feeBps = 6;
  return config;
};

export const disruptiveEntrantsScenario = (seed = 11): SimulationConfig => {
  const config = baseConfig("disruptive-entrants", seed);
  config.totalMinutes = 42 * DAY;
  config.entrants.enabled = true;
  config.entrants.intervalMinutes = 7 * DAY;
  config.index.maxLogitStepPerMinute = 0.1;
  config.clearinghouse.maxLeverageListing = 10;
  config.clearinghouse.listingOiMultiplier = 0.2;
  config.clearinghouse.orderFlowPerMinute = 0.24;
  config.clearinghouse.feeBps = 7;
  config.regimes = [
    {
      name: "slow_open",
      startMinute: 0,
      endMinute: 7 * DAY,
      orderFlowMultiplier: 0.85,
      signalNoiseMultiplier: 1.1,
    },
    {
      name: "new_listing_turbulence",
      startMinute: 7 * DAY,
      endMinute: 14 * DAY,
      orderFlowMultiplier: 1.1,
      informedFlowShareOverride: 0.4,
      signalNoiseMultiplier: 0.9,
      metaDriftPerMinute: 0.0004,
    },
    {
      name: "stabilizing",
      startMinute: 14 * DAY,
      endMinute: 42 * DAY,
      orderFlowMultiplier: 1,
      signalNoiseMultiplier: 1,
    },
  ];
  return config;
};

export const thinLiquidityStressScenario = (
  feeBps: number,
  seed = 23,
): SimulationConfig => {
  const config = baseConfig(`thin-liquidity-stress-${feeBps}bps`, seed);
  config.totalMinutes = 28 * DAY;
  config.entrants.enabled = true;
  config.entrants.intervalMinutes = 7 * DAY;
  config.index.maxLogitStepPerMinute = 0.12;
  config.clearinghouse.feeBps = feeBps;
  config.clearinghouse.traderCount = 140;
  config.clearinghouse.insuranceSeed = 14_000;
  config.clearinghouse.globalOiCap = 220_000;
  config.clearinghouse.perMarketOiFloor = 1_600;
  config.clearinghouse.perMarketOiScale = 36_000;
  config.clearinghouse.baseDepth = 540;
  config.clearinghouse.baseHalfSpread = 0.008;
  config.clearinghouse.orderFlowPerMinute = 0.55;
  config.clearinghouse.informedFlowShare = 0.62;
  config.clearinghouse.orderSizeLogMean = 3.15;
  config.clearinghouse.orderSizeLogStd = 0.9;
  config.clearinghouse.toxicitySpreadMultiplier = 1.6;
  config.clearinghouse.toxicityDepthMultiplier = 2.4;
  config.clearinghouse.signalNoise = 0.03;
  config.clearinghouse.maxLeverageListing = 7;
  config.clearinghouse.listingOiMultiplier = 0.18;
  config.clearinghouse.maxOrderQuantity = 220;
  config.clearinghouse.marketOrderLimitPerMinute = 140;
  config.clearinghouse.marketNotionalLimitPerMinute = 2_600;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 720;
  config.clearinghouse.traderOrderLimitPerMinute = 6;
  config.clearinghouse.traderNotionalLimitPerMinute = 300;
  config.clearinghouse.mmInventoryCarryPerMinute = 0.0008;
  config.clearinghouse.mmHedgeRatePerMinute = 0.025;
  config.clearinghouse.mmHedgeHalfSpread = 0.006;
  config.regimes = [
    {
      name: "toxic_open",
      startMinute: 0,
      endMinute: 4 * DAY,
      orderFlowMultiplier: 1.4,
      informedFlowShareOverride: 0.7,
      depthMultiplier: 0.75,
      oiCapMultiplier: 0.85,
      leverageMultiplier: 0.9,
      mmCarryMultiplier: 1.2,
      mevAttackIntensity: 0.3,
      attackSizeMultiplier: 1.8,
    },
    {
      name: "thin_steady",
      startMinute: 4 * DAY,
      endMinute: 28 * DAY,
      orderFlowMultiplier: 1.05,
      informedFlowShareOverride: 0.6,
      depthMultiplier: 0.9,
      mmCarryMultiplier: 1,
    },
  ];
  return config;
};

export const feeDrivenMmScenario = (
  feeBps: number,
  seed = 51,
): SimulationConfig => {
  const config = thinLiquidityStressScenario(feeBps, seed);
  config.name = `fee-driven-mm-${feeBps}bps`;
  config.clearinghouse.baseHalfSpread = 0;
  config.clearinghouse.baseDepth = 460;
  config.clearinghouse.impactSlope = 0;
  config.clearinghouse.informedFlowShare = 0.7;
  config.clearinghouse.orderFlowPerMinute = 0.62;
  config.clearinghouse.toxicitySpreadMultiplier = 1.2;
  config.clearinghouse.toxicityDepthMultiplier = 2.8;
  config.clearinghouse.fundingSensitivity = 0;
  config.clearinghouse.mmInventoryCarryPerMinute = 0.0015;
  config.clearinghouse.mmHedgeRatePerMinute = 0.02;
  config.clearinghouse.mmHedgeHalfSpread = 0.012;
  config.clearinghouse.insuranceSeed = 12_000;
  config.clearinghouse.maxOrderQuantity = 180;
  config.clearinghouse.marketOrderLimitPerMinute = 110;
  config.clearinghouse.marketNotionalLimitPerMinute = 1_800;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 460;
  config.clearinghouse.traderOrderLimitPerMinute = 5;
  config.clearinghouse.traderNotionalLimitPerMinute = 220;
  config.regimes = [
    {
      name: "fee_only_attack",
      startMinute: 0,
      endMinute: 28 * DAY,
      orderFlowMultiplier: 1.15,
      informedFlowShareOverride: 0.72,
      depthMultiplier: 0.78,
      halfSpreadMultiplier: 0.25,
      impactMultiplier: 0.15,
      mmCarryMultiplier: 1.35,
      mevAttackIntensity: 0.45,
      attackSizeMultiplier: 2.2,
    },
  ];
  return config;
};

export const slowGrowthScenario = (seed = 72): SimulationConfig => {
  const config = baseConfig("slow-growth", seed);
  config.totalMinutes = 35 * DAY;
  config.entrants.enabled = true;
  config.entrants.intervalMinutes = 10 * DAY;
  config.evolution.passiveXpPerMinute = 0.2;
  config.evolution.duelXp = 8;
  config.evolution.skillDriftStdPerMinute = 0.004;
  config.clearinghouse.orderFlowPerMinute = 0.18;
  config.clearinghouse.informedFlowShare = 0.2;
  config.clearinghouse.baseDepth = 2200;
  config.regimes = [
    {
      name: "slow_organic",
      startMinute: 0,
      endMinute: 35 * DAY,
      orderFlowMultiplier: 0.75,
      signalNoiseMultiplier: 1.35,
      metaDriftPerMinute: 0.00005,
    },
  ];
  return config;
};

export const hypeThenCrashScenario = (seed = 88): SimulationConfig => {
  const config = thinLiquidityStressScenario(14, seed);
  config.name = "hype-then-crash";
  config.totalMinutes = 24 * DAY;
  config.regimes = [
    {
      name: "pre_hype",
      startMinute: 0,
      endMinute: 7 * DAY,
      orderFlowMultiplier: 0.9,
      signalNoiseMultiplier: 1.1,
      metaDriftPerMinute: 0.0001,
    },
    {
      name: "hype_runup",
      startMinute: 7 * DAY,
      endMinute: 11 * DAY,
      orderFlowMultiplier: 2.2,
      informedFlowShareOverride: 0.74,
      depthMultiplier: 0.65,
      halfSpreadMultiplier: 0.7,
      oiCapMultiplier: 1.2,
      leverageMultiplier: 1.2,
      metaDriftPerMinute: 0.0022,
      topAgentSkillBoostPerMinute: 0.0005,
      mevAttackIntensity: 0.6,
      attackSizeMultiplier: 2.6,
    },
    {
      name: "crash",
      startMinute: 11 * DAY,
      endMinute: 12 * DAY + 12 * HOUR,
      orderFlowMultiplier: 2.6,
      informedFlowShareOverride: 0.82,
      depthMultiplier: 0.48,
      halfSpreadMultiplier: 1.4,
      leverageMultiplier: 0.85,
      oiCapMultiplier: 0.8,
      metaDriftPerMinute: -0.0045,
      mmCarryMultiplier: 1.4,
      mevAttackIntensity: 0.9,
      attackSizeMultiplier: 3.1,
    },
    {
      name: "post_crash",
      startMinute: 12 * DAY + 12 * HOUR,
      endMinute: 24 * DAY,
      orderFlowMultiplier: 1.1,
      informedFlowShareOverride: 0.55,
      depthMultiplier: 0.9,
      metaDriftPerMinute: -0.0003,
    },
  ];
  return config;
};

export const hypeSlowFalloffScenario = (seed = 91): SimulationConfig => {
  const config = thinLiquidityStressScenario(12, seed);
  config.name = "hype-slow-falloff";
  config.totalMinutes = 26 * DAY;
  config.regimes = [
    {
      name: "warmup",
      startMinute: 0,
      endMinute: 6 * DAY,
      orderFlowMultiplier: 0.95,
      metaDriftPerMinute: 0.00015,
    },
    {
      name: "hype",
      startMinute: 6 * DAY,
      endMinute: 10 * DAY,
      orderFlowMultiplier: 1.9,
      informedFlowShareOverride: 0.68,
      depthMultiplier: 0.72,
      halfSpreadMultiplier: 0.8,
      metaDriftPerMinute: 0.0018,
      topAgentSkillBoostPerMinute: 0.0004,
      mevAttackIntensity: 0.5,
      attackSizeMultiplier: 2.1,
    },
    {
      name: "slow_falloff",
      startMinute: 10 * DAY,
      endMinute: 26 * DAY,
      orderFlowMultiplier: 1.15,
      informedFlowShareOverride: 0.57,
      depthMultiplier: 0.9,
      metaDriftPerMinute: -0.0004,
      mmCarryMultiplier: 1.15,
    },
  ];
  return config;
};

export const hypeRunawaySuccessScenario = (seed = 94): SimulationConfig => {
  const config = thinLiquidityStressScenario(12, seed);
  config.name = "hype-runaway-success";
  config.totalMinutes = 30 * DAY;
  config.regimes = [
    {
      name: "build",
      startMinute: 0,
      endMinute: 8 * DAY,
      orderFlowMultiplier: 1.1,
      metaDriftPerMinute: 0.0002,
    },
    {
      name: "runaway",
      startMinute: 8 * DAY,
      endMinute: 30 * DAY,
      orderFlowMultiplier: 1.8,
      informedFlowShareOverride: 0.71,
      depthMultiplier: 0.7,
      halfSpreadMultiplier: 0.75,
      oiCapMultiplier: 1.3,
      leverageMultiplier: 1.15,
      metaDriftPerMinute: 0.0012,
      topAgentSkillBoostPerMinute: 0.001,
      mevAttackIntensity: 0.45,
      attackSizeMultiplier: 2.5,
    },
  ];
  return config;
};

export const mevBotAttackScenario = (seed = 97): SimulationConfig => {
  const config = feeDrivenMmScenario(24, seed);
  config.name = "mev-bot-attack";
  config.totalMinutes = 14 * DAY;
  const governor = config.clearinghouse.riskGovernor;
  governor.enabled = true;
  governor.minStateDurationMinutes = 8;
  governor.thresholds.toxicityEnter = 0.28;
  governor.thresholds.toxicityExit = 0.2;
  governor.thresholds.informedFlowEnter = 0.72;
  governor.thresholds.informedFlowExit = 0.58;
  governor.thresholds.stressDrawdownEnter = 0.08;
  governor.thresholds.stressDrawdownExit = 0.05;
  governor.thresholds.stressCoverageEnter = 0.82;
  governor.thresholds.stressCoverageExit = 0.92;
  governor.profiles.TOXIC.spreadMultiplier = 1.65;
  governor.profiles.TOXIC.depthMultiplier = 0.68;
  governor.profiles.TOXIC.leverageMultiplier = 0.72;
  governor.profiles.TOXIC.oiCapMultiplier = 0.78;
  governor.profiles.TOXIC.marketOrderLimitMultiplier = 0.72;
  governor.profiles.TOXIC.marketNotionalLimitMultiplier = 0.72;
  governor.profiles.TOXIC.marketImbalanceLimitMultiplier = 0.56;
  governor.profiles.TOXIC.feeSurchargeBps = 5;
  governor.profiles.TOXIC.attackFlowMultiplier = 0.72;
  governor.profiles.TOXIC.attackFeeSurchargeBps = 8;
  governor.profiles.TOXIC.hedgeRateMultiplier = 1.7;
  governor.profiles.STRESS.spreadMultiplier = 2.35;
  governor.profiles.STRESS.depthMultiplier = 0.5;
  governor.profiles.STRESS.leverageMultiplier = 0.5;
  governor.profiles.STRESS.oiCapMultiplier = 0.62;
  governor.profiles.STRESS.marketOrderLimitMultiplier = 0.45;
  governor.profiles.STRESS.marketNotionalLimitMultiplier = 0.45;
  governor.profiles.STRESS.marketImbalanceLimitMultiplier = 0.32;
  governor.profiles.STRESS.feeSurchargeBps = 10;
  governor.profiles.STRESS.attackFlowMultiplier = 0.45;
  governor.profiles.STRESS.attackFeeSurchargeBps = 14;
  governor.profiles.STRESS.hedgeRateMultiplier = 3.3;
  config.clearinghouse.globalOiCap = 220_000;
  config.clearinghouse.maxLeverageMature = 26;
  config.clearinghouse.maxLeverageListing = 6;
  config.clearinghouse.mmInventoryCarryPerMinute = 0.00035;
  config.clearinghouse.mmInventorySkewImpact = 0.00012;
  config.clearinghouse.mmHedgeRatePerMinute = 0.14;
  config.clearinghouse.mmHedgeHalfSpread = 0.0032;
  config.clearinghouse.maxOrderQuantity = 150;
  config.clearinghouse.marketOrderLimitPerMinute = 80;
  config.clearinghouse.marketNotionalLimitPerMinute = 980;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 320;
  config.clearinghouse.traderOrderLimitPerMinute = 4;
  config.clearinghouse.traderNotionalLimitPerMinute = 140;
  config.regimes = [
    {
      name: "coordinated_attack",
      startMinute: 0,
      endMinute: 14 * DAY,
      orderFlowMultiplier: 1.52,
      informedFlowShareOverride: 0.85,
      depthMultiplier: 0.66,
      halfSpreadMultiplier: 0.55,
      impactMultiplier: 0.48,
      mmCarryMultiplier: 1.35,
      mmHedgeRateMultiplier: 1.05,
      mmHedgeSpreadMultiplier: 1.3,
      mevAttackIntensity: 1.1,
      attackSizeMultiplier: 3.1,
      attackSybilShare: 0.95,
      metaDriftPerMinute: 0.0003,
    },
  ];
  return config;
};

const mevBotAttackGuardedTemplate = (
  feeBps: number,
  seed: number,
): SimulationConfig => {
  const config = mevBotAttackScenario(seed);
  const governor = config.clearinghouse.riskGovernor;
  config.name = `mev-bot-attack-guarded-${feeBps}bps`;
  config.clearinghouse.feeBps = feeBps;
  governor.enabled = true;
  governor.minStateDurationMinutes = 6;
  governor.thresholds.toxicityEnter = 0.24;
  governor.thresholds.toxicityExit = 0.16;
  governor.thresholds.informedFlowEnter = 0.66;
  governor.thresholds.informedFlowExit = 0.52;
  governor.thresholds.stressDrawdownEnter = 0.06;
  governor.thresholds.stressDrawdownExit = 0.035;
  governor.thresholds.stressCoverageEnter = 0.9;
  governor.thresholds.stressCoverageExit = 0.97;
  governor.profiles.TOXIC.spreadMultiplier = 2.1;
  governor.profiles.TOXIC.depthMultiplier = 0.52;
  governor.profiles.TOXIC.leverageMultiplier = 0.55;
  governor.profiles.TOXIC.oiCapMultiplier = 0.62;
  governor.profiles.TOXIC.marketOrderLimitMultiplier = 0.5;
  governor.profiles.TOXIC.marketNotionalLimitMultiplier = 0.5;
  governor.profiles.TOXIC.marketImbalanceLimitMultiplier = 0.35;
  governor.profiles.TOXIC.feeSurchargeBps = 10;
  governor.profiles.TOXIC.attackFlowMultiplier = 0.48;
  governor.profiles.TOXIC.attackFeeSurchargeBps = 14;
  governor.profiles.TOXIC.hedgeRateMultiplier = 2.2;
  governor.profiles.STRESS.spreadMultiplier = 3;
  governor.profiles.STRESS.depthMultiplier = 0.34;
  governor.profiles.STRESS.leverageMultiplier = 0.32;
  governor.profiles.STRESS.oiCapMultiplier = 0.45;
  governor.profiles.STRESS.marketOrderLimitMultiplier = 0.24;
  governor.profiles.STRESS.marketNotionalLimitMultiplier = 0.24;
  governor.profiles.STRESS.marketImbalanceLimitMultiplier = 0.16;
  governor.profiles.STRESS.feeSurchargeBps = 18;
  governor.profiles.STRESS.attackFlowMultiplier = 0.22;
  governor.profiles.STRESS.attackFeeSurchargeBps = 24;
  governor.profiles.STRESS.hedgeRateMultiplier = 4.8;
  config.clearinghouse.maxLeverageMature = 22;
  config.clearinghouse.maxLeverageListing = 5;
  config.clearinghouse.globalOiCap = 185_000;
  config.clearinghouse.mmInventoryCarryPerMinute = 0.0003;
  config.clearinghouse.mmInventorySkewImpact = 0.00026;
  config.clearinghouse.maxOrderQuantity = 120;
  config.clearinghouse.marketOrderLimitPerMinute = 52;
  config.clearinghouse.marketNotionalLimitPerMinute = 620;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 160;
  config.clearinghouse.traderOrderLimitPerMinute = 3;
  config.clearinghouse.traderNotionalLimitPerMinute = 105;
  config.clearinghouse.mmHedgeRatePerMinute = 0.14;
  config.clearinghouse.mmHedgeHalfSpread = 0.0028;
  return config;
};

export const mevBotAttackGuardedScenario = (seed = 101): SimulationConfig => {
  const config = mevBotAttackGuardedTemplate(26, seed);
  config.name = "mev-bot-attack-guarded";
  return config;
};

export const mevBotAttackHardenedScenario = (seed = 103): SimulationConfig => {
  const config = mevBotAttackGuardedTemplate(30, seed);
  config.name = "mev-bot-attack-hardened";
  config.clearinghouse.baseHalfSpread = 0.0045;
  config.clearinghouse.impactSlope = 0.09;
  config.clearinghouse.mmInventoryCarryPerMinute = 0.00022;
  config.clearinghouse.mmInventorySkewImpact = 0.00034;
  config.clearinghouse.insuranceSeed = 32_000;
  config.clearinghouse.globalOiCap = 150_000;
  config.clearinghouse.perMarketOiFloor = 1_200;
  config.clearinghouse.perMarketOiScale = 22_000;
  config.clearinghouse.maxLeverageMature = 16;
  config.clearinghouse.maxLeverageListing = 4;
  config.clearinghouse.maxOrderQuantity = 95;
  config.clearinghouse.marketOrderLimitPerMinute = 36;
  config.clearinghouse.marketNotionalLimitPerMinute = 420;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 96;
  config.clearinghouse.traderOrderLimitPerMinute = 2;
  config.clearinghouse.traderNotionalLimitPerMinute = 82;
  config.regimes = [
    {
      name: "coordinated_attack_hardened",
      startMinute: 0,
      endMinute: 14 * DAY,
      orderFlowMultiplier: 1.5,
      informedFlowShareOverride: 0.82,
      depthMultiplier: 0.68,
      halfSpreadMultiplier: 0.7,
      impactMultiplier: 0.72,
      mmCarryMultiplier: 1.2,
      mmHedgeRateMultiplier: 1.35,
      mmHedgeSpreadMultiplier: 1.25,
      mevAttackIntensity: 1.15,
      attackSizeMultiplier: 2.8,
      attackSybilShare: 0.75,
      metaDriftPerMinute: 0.00025,
    },
  ];
  return config;
};

export const mevOracleLagAttackScenario = (seed = 107): SimulationConfig => {
  const config = mevBotAttackGuardedTemplate(24, seed);
  config.name = "mev-oracle-lag-attack";
  config.totalMinutes = 10 * DAY;
  config.clearinghouse.maxLeverageMature = 18;
  config.clearinghouse.maxLeverageListing = 5;
  config.clearinghouse.globalOiCap = 150_000;
  config.clearinghouse.maxOrderQuantity = 110;
  config.clearinghouse.marketOrderLimitPerMinute = 44;
  config.clearinghouse.marketNotionalLimitPerMinute = 500;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 130;
  config.clearinghouse.traderOrderLimitPerMinute = 3;
  config.clearinghouse.traderNotionalLimitPerMinute = 100;
  config.regimes = [
    {
      name: "lagged_oracle_attack",
      startMinute: 0,
      endMinute: 10 * DAY,
      orderFlowMultiplier: 1.45,
      informedFlowShareOverride: 0.84,
      depthMultiplier: 0.72,
      halfSpreadMultiplier: 0.7,
      impactMultiplier: 0.7,
      mmCarryMultiplier: 1.2,
      mmHedgeRateMultiplier: 1.1,
      mmHedgeSpreadMultiplier: 1.25,
      mevAttackIntensity: 1.05,
      attackSizeMultiplier: 2.8,
      attackSybilShare: 0.95,
      oracleLagMinutes: 4,
      metaDriftPerMinute: 0.00035,
    },
  ];
  return config;
};

export const sybilSwarmAttackScenario = (seed = 109): SimulationConfig => {
  const config = mevBotAttackGuardedTemplate(24, seed);
  config.name = "sybil-swarm-attack";
  config.totalMinutes = 10 * DAY;
  config.clearinghouse.traderCount = 240;
  config.clearinghouse.globalOiCap = 190_000;
  config.clearinghouse.maxOrderQuantity = 95;
  config.clearinghouse.marketOrderLimitPerMinute = 58;
  config.clearinghouse.marketNotionalLimitPerMinute = 680;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 180;
  config.clearinghouse.traderOrderLimitPerMinute = 2;
  config.clearinghouse.traderNotionalLimitPerMinute = 70;
  config.regimes = [
    {
      name: "sybil_swarm",
      startMinute: 0,
      endMinute: 10 * DAY,
      orderFlowMultiplier: 1.85,
      informedFlowShareOverride: 0.82,
      depthMultiplier: 0.74,
      halfSpreadMultiplier: 0.7,
      impactMultiplier: 0.65,
      mmCarryMultiplier: 1.35,
      mmHedgeRateMultiplier: 1.05,
      mmHedgeSpreadMultiplier: 1.3,
      mevAttackIntensity: 1.25,
      attackSizeMultiplier: 1.6,
      attackSybilShare: 1,
      oracleLagMinutes: 1,
      metaDriftPerMinute: 0.00025,
    },
  ];
  return config;
};

export const mevOracleLagHardenedScenario = (seed = 113): SimulationConfig => {
  const config = mevOracleLagAttackScenario(seed);
  config.name = "mev-oracle-lag-hardened";
  config.clearinghouse.feeBps = 30;
  config.clearinghouse.insuranceSeed = 22_000;
  config.clearinghouse.globalOiCap = 120_000;
  config.clearinghouse.maxLeverageMature = 14;
  config.clearinghouse.maxLeverageListing = 4;
  config.clearinghouse.maxOrderQuantity = 80;
  config.clearinghouse.marketOrderLimitPerMinute = 30;
  config.clearinghouse.marketNotionalLimitPerMinute = 320;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 72;
  config.clearinghouse.traderOrderLimitPerMinute = 2;
  config.clearinghouse.traderNotionalLimitPerMinute = 48;
  config.clearinghouse.mmInventoryCarryPerMinute = 0.0003;
  config.clearinghouse.mmInventorySkewImpact = 0.00022;
  config.clearinghouse.mmHedgeRatePerMinute = 0.1;
  config.clearinghouse.mmHedgeHalfSpread = 0.003;
  const regime = config.regimes?.[0];
  if (regime) {
    regime.mevAttackIntensity = 0.95;
    regime.attackSizeMultiplier = 2.4;
    regime.attackSybilShare = 0.8;
    regime.oracleLagMinutes = 3;
  }
  return config;
};

export const sybilSwarmHardenedScenario = (seed = 127): SimulationConfig => {
  const config = sybilSwarmAttackScenario(seed);
  config.name = "sybil-swarm-hardened";
  config.clearinghouse.feeBps = 30;
  config.clearinghouse.insuranceSeed = 24_000;
  config.clearinghouse.globalOiCap = 135_000;
  config.clearinghouse.maxLeverageMature = 15;
  config.clearinghouse.maxLeverageListing = 4;
  config.clearinghouse.maxOrderQuantity = 70;
  config.clearinghouse.marketOrderLimitPerMinute = 34;
  config.clearinghouse.marketNotionalLimitPerMinute = 380;
  config.clearinghouse.marketNetImbalanceLimitPerMinute = 85;
  config.clearinghouse.traderOrderLimitPerMinute = 1;
  config.clearinghouse.traderNotionalLimitPerMinute = 44;
  config.clearinghouse.mmInventoryCarryPerMinute = 0.0003;
  config.clearinghouse.mmInventorySkewImpact = 0.00022;
  config.clearinghouse.mmHedgeRatePerMinute = 0.1;
  config.clearinghouse.mmHedgeHalfSpread = 0.003;
  const regime = config.regimes?.[0];
  if (regime) {
    regime.mevAttackIntensity = 1.05;
    regime.attackSizeMultiplier = 1.3;
    regime.attackSybilShare = 0.9;
    regime.oracleLagMinutes = 1;
  }
  return config;
};

export const runScenario = (config: SimulationConfig): SimulationSummary => {
  const simulation = new DuelArenaSimulation(config);
  return simulation.run();
};

export type FeeSweepResult = {
  feeBps: number;
  summary: SimulationSummary;
  solvent: boolean;
};

export const runThinLiquidityFeeSweep = (
  feesBps: number[],
  seed = 33,
): FeeSweepResult[] =>
  feesBps.map((feeBps, index) => {
    const summary = runScenario(
      thinLiquidityStressScenario(feeBps, seed + index * 13),
    );
    const solvent =
      !summary.clearinghouse.mmBlewOut &&
      summary.clearinghouse.uncoveredBadDebt <= 0.01 &&
      summary.clearinghouse.mmEquityEnd > 0 &&
      summary.clearinghouse.insuranceEnd > 0;
    return { feeBps, summary, solvent };
  });

export const runFeeDrivenMmSweep = (
  feesBps: number[],
  seed = 63,
): FeeSweepResult[] =>
  feesBps.map((feeBps, index) => {
    const summary = runScenario(feeDrivenMmScenario(feeBps, seed + index * 17));
    const solvent =
      !summary.clearinghouse.mmBlewOut &&
      summary.clearinghouse.uncoveredBadDebt <= 0.01 &&
      summary.clearinghouse.mmEquityEnd > 0 &&
      summary.clearinghouse.insuranceEnd > 0;
    return { feeBps, summary, solvent };
  });

export const runGuardedMevFeeSweep = (
  feesBps: number[],
  seed = 71,
): FeeSweepResult[] =>
  feesBps.map((feeBps, index) => {
    const summary = runScenario(
      mevBotAttackGuardedTemplate(feeBps, seed + index * 19),
    );
    const solvent =
      !summary.clearinghouse.mmBlewOut &&
      summary.clearinghouse.uncoveredBadDebt <= 0.01 &&
      summary.clearinghouse.mmEquityEnd > 0 &&
      summary.clearinghouse.insuranceEnd > 0;
    return { feeBps, summary, solvent };
  });

export const minimumSolventFeeBps = (
  results: FeeSweepResult[],
): number | null => {
  const passing = results
    .filter((result) => result.solvent)
    .map((result) => result.feeBps)
    .sort((a, b) => a - b);
  if (passing.length === 0) return null;
  return passing[0];
};
