import { describe, expect, it } from "vitest";
import {
  Clearinghouse,
  DuelArenaSimulation,
  IndexOracle,
  RatingEngine,
  SeededRandom,
  type ClearinghouseConfig,
} from "./model";
import { baselineConvergenceScenario } from "./scenarios";

describe("IndexOracle", () => {
  it("keeps shares on simplex and enforces logit step cap", () => {
    const oracle = new IndexOracle({
      beta: 1,
      uncertaintyPenalty: 0,
      maxLogitStepPerMinute: 0.05,
    });
    const ids = ["a", "b", "c"];

    const first = oracle.publish(
      new Map([
        ["a", 0],
        ["b", 0],
        ["c", 0],
      ]),
      ids,
    );
    const firstSum = Array.from(first.shares.values()).reduce(
      (acc, value) => acc + value,
      0,
    );
    expect(firstSum).toBeCloseTo(1, 8);

    const second = oracle.publish(
      new Map([
        ["a", 6],
        ["b", -6],
        ["c", 0],
      ]),
      ids,
    );
    const secondSum = Array.from(second.shares.values()).reduce(
      (acc, value) => acc + value,
      0,
    );
    expect(secondSum).toBeCloseTo(1, 8);
    expect(second.maxLogitStep).toBeLessThanOrEqual(0.050001);
  });
});

describe("RatingEngine", () => {
  it("updates high-uncertainty agent faster than low-uncertainty agent", () => {
    const engine = new RatingEngine({
      initMu: 0,
      initSigma: 1.8,
      sigmaFloor: 0.3,
      sigmaCeil: 3.2,
      sigmaRef: 1.6,
      sigmaShrinkPerDuel: 0.98,
      sigmaInactivityPerDay: 0.15,
      patchSigmaShock: 0.3,
      baseK: 0.25,
      expectationScale: 1.1,
    });

    const newcomer = {
      mu: 0,
      sigma: 2.2,
      lastUpdatedMinute: 0,
    };
    const veteran = {
      mu: 0,
      sigma: 0.45,
      lastUpdatedMinute: 0,
    };

    engine.updateDuel(newcomer, veteran, 5);
    expect(newcomer.mu).toBeGreaterThan(0);
    expect(veteran.mu).toBeLessThan(0);
    expect(Math.abs(newcomer.mu)).toBeGreaterThan(Math.abs(veteran.mu));
  });
});

const buildClearinghouseConfig = (): ClearinghouseConfig => ({
  traderCount: 1,
  traderCollateralMean: 1_000,
  traderCollateralStd: 0,
  traderRespawnMinutes: 60,
  traderRespawnCollateralMean: 1_000,
  traderRespawnCollateralStd: 0,
  initialMarginRatio: 0.025,
  maintenanceMarginRatio: 0.0175,
  maintenanceBuffer: 0.004,
  liquidationPenaltyRate: 0.0075,
  liquidationSlippage: 0.02,
  feeBps: 0,
  feeSplitToMm: 0.5,
  insuranceSeed: 20_000,
  globalOiCap: 1_000_000,
  perMarketOiFloor: 1_000,
  perMarketOiScale: 10_000,
  listingOiMultiplier: 1,
  listingPhaseMinutes: 0,
  stabilizationMinutes: 0,
  maxLeverageMature: 40,
  maxLeverageListing: 40,
  baseHalfSpread: 0,
  baseDepth: 100_000,
  impactSlope: 0,
  toxicitySpreadMultiplier: 0,
  toxicityDepthMultiplier: 0,
  orderFlowPerMinute: 0,
  informedFlowShare: 0,
  signalNoise: 0,
  orderSizeLogMean: 0,
  orderSizeLogStd: 0,
  fundingIntervalMinutes: 5,
  fundingSensitivity: 0,
  fundingClamp: 0.01,
  enableAdl: true,
  mmInventoryCarryPerMinute: 0,
  mmInventorySkewImpact: 0,
  mmHedgeRatePerMinute: 0,
  mmHedgeHalfSpread: 0,
  maxOrderQuantity: 1_000,
  marketOrderLimitPerMinute: 0,
  marketNotionalLimitPerMinute: 0,
  marketNetImbalanceLimitPerMinute: 0,
  traderOrderLimitPerMinute: 0,
  traderNotionalLimitPerMinute: 0,
  riskGovernor: {
    enabled: false,
    minStateDurationMinutes: 0,
    thresholds: {
      toxicityEnter: 1,
      toxicityExit: 0.5,
      informedFlowEnter: 1,
      informedFlowExit: 0.5,
      stressDrawdownEnter: 1,
      stressDrawdownExit: 0.5,
      stressCoverageEnter: 0.1,
      stressCoverageExit: 0.2,
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
      STRESS: {
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
    },
  },
});

describe("Clearinghouse", () => {
  it("uses cross-market marks for leverage checks", () => {
    const clearinghouse = new Clearinghouse(
      buildClearinghouseConfig(),
      new SeededRandom(42),
    );
    const traderId = clearinghouse.getTraderIds()[0];

    const openingMarks = new Map<string, number>([
      ["A", 1],
      ["B", 0],
    ]);
    clearinghouse.executeOrder(traderId, 1, 80, {
      minute: 0,
      marketId: "A",
      markPrice: 1,
      marksByMarket: openingMarks,
      halfSpread: 0,
      depth: 100_000,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 5,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 0,
    });

    const stressedMarks = new Map<string, number>([
      ["A", -4],
      ["B", 0],
    ]);
    clearinghouse.executeOrder(traderId, 1, 100, {
      minute: 1,
      marketId: "B",
      markPrice: 0,
      marksByMarket: stressedMarks,
      halfSpread: 0,
      depth: 100_000,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 0.12,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 0,
    });

    const summary = clearinghouse.summary();
    expect(summary.blockedByLeverage).toBeGreaterThan(0);
    expect(summary.totalVolume).toBeCloseTo(80, 8);
  });

  it("enforces per-trader order-rate and notional-rate limits", () => {
    const config = buildClearinghouseConfig();
    config.traderOrderLimitPerMinute = 2;
    config.traderNotionalLimitPerMinute = 50;
    const clearinghouse = new Clearinghouse(config, new SeededRandom(7));
    const traderId = clearinghouse.getTraderIds()[0];
    const marks = new Map<string, number>([["A", 0]]);

    clearinghouse.executeOrder(traderId, 1, 30, {
      minute: 3,
      marketId: "A",
      markPrice: 0,
      marksByMarket: marks,
      halfSpread: 0,
      depth: 100_000,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 10,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 0,
    });
    clearinghouse.executeOrder(traderId, 1, 30, {
      minute: 3,
      marketId: "A",
      markPrice: 0,
      marksByMarket: marks,
      halfSpread: 0,
      depth: 100_000,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 10,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 0,
    });
    clearinghouse.executeOrder(traderId, 1, 30, {
      minute: 3,
      marketId: "A",
      markPrice: 0,
      marksByMarket: marks,
      halfSpread: 0,
      depth: 100_000,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 10,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 0,
    });

    const summary = clearinghouse.summary();
    expect(summary.totalVolume).toBeCloseTo(50, 8);
    expect(summary.blockedByRateLimit).toBeGreaterThanOrEqual(1);
  });

  it("enforces per-market signed imbalance caps", () => {
    const config = buildClearinghouseConfig();
    config.marketNetImbalanceLimitPerMinute = 40;
    const clearinghouse = new Clearinghouse(config, new SeededRandom(99));
    const traderId = clearinghouse.getTraderIds()[0];
    const marks = new Map<string, number>([["A", 0]]);

    clearinghouse.executeOrder(traderId, 1, 30, {
      minute: 9,
      marketId: "A",
      markPrice: 0,
      marksByMarket: marks,
      halfSpread: 0,
      depth: 100_000,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 10,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 40,
    });
    clearinghouse.executeOrder(traderId, 1, 30, {
      minute: 9,
      marketId: "A",
      markPrice: 0,
      marksByMarket: marks,
      halfSpread: 0,
      depth: 100_000,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 10,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 40,
    });

    const summary = clearinghouse.summary();
    expect(summary.totalVolume).toBeCloseTo(40, 8);
    expect(summary.blockedByImbalanceLimit).toBeGreaterThan(0);
  });

  it("reports mmPeakToTrough as realized max drawdown, not global range", () => {
    const clearinghouse = new Clearinghouse(
      buildClearinghouseConfig(),
      new SeededRandom(314),
    );
    const traderId = clearinghouse.getTraderIds()[0];
    const marksAtZero = new Map<string, number>([["A", 0]]);

    clearinghouse.executeOrder(traderId, 1, 100, {
      minute: 0,
      marketId: "A",
      markPrice: 0,
      marksByMarket: marksAtZero,
      halfSpread: 0,
      depth: 100_000,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 10,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 0,
    });

    clearinghouse.markToMarket(new Map<string, number>([["A", -2]]), 1);
    clearinghouse.markToMarket(new Map<string, number>([["A", -1]]), 2);
    clearinghouse.markToMarket(new Map<string, number>([["A", -3]]), 3);

    const summary = clearinghouse.summary();
    expect(summary.mmEquityPeak).toBeCloseTo(20_300, 8);
    expect(summary.mmEquityMin).toBeCloseTo(20_000, 8);
    expect(summary.mmPeakToTrough).toBeCloseTo(100, 8);
  });

  it("blocks opening orders that violate projected initial margin after fill costs", () => {
    const clearinghouse = new Clearinghouse(
      buildClearinghouseConfig(),
      new SeededRandom(123),
    );
    const traderId = clearinghouse.getTraderIds()[0];
    const marks = new Map<string, number>([["A", 0]]);

    clearinghouse.executeOrder(traderId, 1, 80, {
      minute: 12,
      marketId: "A",
      markPrice: 0,
      marksByMarket: marks,
      halfSpread: 20,
      depth: 1,
      impactSlope: 0,
      feeRate: 0,
      maxLeverage: 40,
      marketOiCap: 1_000_000,
      marketOrderLimitPerMinute: 0,
      marketNotionalLimitPerMinute: 0,
      marketNetImbalanceLimitPerMinute: 0,
    });

    const summary = clearinghouse.summary();
    expect(summary.totalVolume).toBeCloseTo(0, 8);
    expect(summary.blockedByInitialMargin).toBeGreaterThan(0);
  });
});

describe("Simulation config validation", () => {
  it("rejects invalid margin hierarchy", () => {
    const config = baselineConvergenceScenario(42);
    config.clearinghouse.initialMarginRatio = 0.01;
    config.clearinghouse.maintenanceMarginRatio = 0.02;
    expect(() => new DuelArenaSimulation(config)).toThrow(
      /initial margin ratio must be > maintenance margin ratio/i,
    );
  });
});
