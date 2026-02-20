import {
  RiskGovernor,
  type RiskActionProfile,
  type RiskGovernorConfig,
  type RiskGovernorSnapshot,
  type RiskState,
} from "./risk-governor";

export type AgentId = string;

const MIN_SHARE = 1e-6;
const MIN_NOTIONAL = 1e-9;

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const invariant = (condition: boolean, message: string): void => {
  if (!condition) {
    throw new Error(`Invalid simulation config: ${message}`);
  }
};

const logistic = (x: number): number => 1 / (1 + Math.exp(-x));

const softmax = (scores: number[]): number[] => {
  if (scores.length === 0) return [];
  const maxScore = Math.max(...scores);
  const exps = scores.map((score) => Math.exp(score - maxScore));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    const uniform = 1 / scores.length;
    return scores.map(() => uniform);
  }
  return exps.map((value) => value / sum);
};

const shareToLogit = (share: number): number => {
  const bounded = clamp(share, MIN_SHARE, 1 - MIN_SHARE);
  return Math.log(bounded / (1 - bounded));
};

const mapValues = <T>(map: Map<string, T>, ids: string[]): T[] =>
  ids.map((id) => {
    const value = map.get(id);
    if (value === undefined) {
      throw new Error(`Missing map value for ${id}`);
    }
    return value;
  });

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x9e3779b9;
    }
  }

  next(): number {
    this.state += 0x6d2b79f5;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) {
      return minInclusive;
    }
    return (
      minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive))
    );
  }

  bool(probability: number): boolean {
    return this.next() < probability;
  }

  normal(mean = 0, stdDev = 1): number {
    const u1 = Math.max(this.next(), 1e-12);
    const u2 = this.next();
    const mag = Math.sqrt(-2 * Math.log(u1));
    const z0 = mag * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  logNormal(mean = 0, stdDev = 1): number {
    return Math.exp(this.normal(mean, stdDev));
  }

  choice<T>(items: T[]): T {
    if (items.length === 0) {
      throw new Error("Cannot choose from empty array");
    }
    return items[this.int(0, items.length)];
  }

  shuffle<T>(items: T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(0, i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  poissonApprox(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda < 10) {
      const l = Math.exp(-lambda);
      let p = 1;
      let k = 0;
      do {
        k++;
        p *= this.next();
      } while (p > l);
      return Math.max(0, k - 1);
    }
    const sample = Math.round(this.normal(lambda, Math.sqrt(lambda)));
    return Math.max(0, sample);
  }
}

export interface RatingState {
  mu: number;
  sigma: number;
  lastUpdatedMinute: number;
}

export interface RatingConfig {
  initMu: number;
  initSigma: number;
  sigmaFloor: number;
  sigmaCeil: number;
  sigmaRef: number;
  sigmaShrinkPerDuel: number;
  sigmaInactivityPerDay: number;
  patchSigmaShock: number;
  baseK: number;
  expectationScale: number;
}

export interface IndexConfig {
  beta: number;
  uncertaintyPenalty: number;
  maxLogitStepPerMinute: number;
}

export interface ClearinghouseConfig {
  traderCount: number;
  traderCollateralMean: number;
  traderCollateralStd: number;
  traderRespawnMinutes: number;
  traderRespawnCollateralMean: number;
  traderRespawnCollateralStd: number;
  initialMarginRatio: number;
  maintenanceMarginRatio: number;
  maintenanceBuffer: number;
  liquidationPenaltyRate: number;
  liquidationSlippage: number;
  feeBps: number;
  feeSplitToMm: number;
  insuranceSeed: number;
  globalOiCap: number;
  perMarketOiFloor: number;
  perMarketOiScale: number;
  listingOiMultiplier: number;
  listingPhaseMinutes: number;
  stabilizationMinutes: number;
  maxLeverageMature: number;
  maxLeverageListing: number;
  baseHalfSpread: number;
  baseDepth: number;
  impactSlope: number;
  toxicitySpreadMultiplier: number;
  toxicityDepthMultiplier: number;
  orderFlowPerMinute: number;
  informedFlowShare: number;
  signalNoise: number;
  orderSizeLogMean: number;
  orderSizeLogStd: number;
  fundingIntervalMinutes: number;
  fundingSensitivity: number;
  fundingClamp: number;
  enableAdl: boolean;
  mmInventoryCarryPerMinute: number;
  mmInventorySkewImpact: number;
  mmHedgeRatePerMinute: number;
  mmHedgeHalfSpread: number;
  maxOrderQuantity: number;
  marketOrderLimitPerMinute: number;
  marketNotionalLimitPerMinute: number;
  marketNetImbalanceLimitPerMinute: number;
  traderOrderLimitPerMinute: number;
  traderNotionalLimitPerMinute: number;
  riskGovernor: RiskGovernorConfig;
}

export interface DuelConfig {
  duelIntervalMinutes: number;
  patchIntervalMinutes: number;
  matchRepeatPenaltyMinutes: number;
  duelOutcomeScale: number;
  duelNoise: number;
}

export interface AgentEvolutionConfig {
  levelSkillCoeff: number;
  passiveXpPerMinute: number;
  duelXp: number;
  skillDriftStdPerMinute: number;
}

export interface EntrantPolicyConfig {
  intervalMinutes: number;
  enabled: boolean;
}

export interface SimulationRegime {
  name: string;
  startMinute: number;
  endMinute: number;
  orderFlowMultiplier?: number;
  informedFlowShareOverride?: number;
  signalNoiseMultiplier?: number;
  halfSpreadMultiplier?: number;
  depthMultiplier?: number;
  impactMultiplier?: number;
  oiCapMultiplier?: number;
  leverageMultiplier?: number;
  fundingSensitivityMultiplier?: number;
  mmCarryMultiplier?: number;
  mmHedgeRateMultiplier?: number;
  mmHedgeSpreadMultiplier?: number;
  mevAttackIntensity?: number;
  attackSizeMultiplier?: number;
  attackSybilShare?: number;
  oracleLagMinutes?: number;
  metaDriftPerMinute?: number;
  topAgentSkillBoostPerMinute?: number;
}

export interface SimulationConfig {
  name: string;
  totalMinutes: number;
  initialAgentCount: number;
  seed: number;
  rating: RatingConfig;
  index: IndexConfig;
  clearinghouse: ClearinghouseConfig;
  duel: DuelConfig;
  evolution: AgentEvolutionConfig;
  entrants: EntrantPolicyConfig;
  regimes?: SimulationRegime[];
}

interface AgentState {
  id: string;
  joinMinute: number;
  baseSkill: number;
  growthCeiling: number;
  growthRate: number;
  startPenalty: number;
  penaltyDecayRate: number;
  metaSensitivity: number;
  level: number;
  xp: number;
  trueSkill: number;
  wins: number;
  losses: number;
  matches: number;
  isEntrant: boolean;
}

interface EntrantSnapshot {
  id: string;
  joinedMinute: number;
  winsDay1: number | null;
  lossesDay1: number | null;
  winsDay7: number | null;
  lossesDay7: number | null;
}

interface Position {
  size: number;
  entryPrice: number;
}

interface TraderAccount {
  id: string;
  collateral: number;
  positions: Map<string, Position>;
  realizedPnl: number;
  feesPaid: number;
  liquidations: number;
  bankruptcies: number;
  respawnEligibleMinute: number;
}

interface MarketState {
  id: string;
  indexPrice: number;
  truePrice: number;
  share: number;
  ageMinutes: number;
}

interface TradeContext {
  minute: number;
  marketId: string;
  markPrice: number;
  marksByMarket: Map<string, number>;
  halfSpread: number;
  depth: number;
  impactSlope: number;
  feeRate: number;
  maxLeverage: number;
  marketOiCap: number;
  marketOrderLimitPerMinute: number;
  marketNotionalLimitPerMinute: number;
  marketNetImbalanceLimitPerMinute: number;
}

export interface EntrantOutcome {
  id: string;
  day1WinRate: number | null;
  day7WinRate: number | null;
  finalRank: number;
  finalShare: number;
}

export interface TopAgentSnapshot {
  id: string;
  mu: number;
  sigma: number;
  share: number;
  wins: number;
  losses: number;
}

export interface MarketLiquidationHotspot {
  marketId: string;
  liquidations: number;
  bankruptcies: number;
}

export interface ClearinghouseSummary {
  totalVolume: number;
  traderFeesPaid: number;
  protocolFees: number;
  mmFeePool: number;
  insuranceStart: number;
  insuranceEnd: number;
  insuranceUsed: number;
  uncoveredBadDebt: number;
  adlRecovered: number;
  liquidationCount: number;
  bankruptcies: number;
  blockedByLeverage: number;
  blockedByOiCap: number;
  blockedByRateLimit: number;
  blockedByTraderRateLimit: number;
  blockedByMarketRateLimit: number;
  blockedByImbalanceLimit: number;
  blockedByInitialMargin: number;
  traderRespawns: number;
  fundingToMm: number;
  mmEquityStart: number;
  mmEquityEnd: number;
  mmPnlTotal: number;
  mmPnlFromFeesAndFunding: number;
  mmPnlExFeesAndFunding: number;
  mmEquityMin: number;
  mmEquityPeak: number;
  mmPeakToTrough: number;
  mmStressRatioMax: number;
  mmMinMinute: number;
  mmFirstNegativeMinute: number | null;
  mmBlewOut: boolean;
  liquidationHotspots: MarketLiquidationHotspot[];
}

export interface RiskGovernorSummary {
  finalState: RiskState;
  transitions: number;
  minutesNormal: number;
  minutesToxic: number;
  minutesStress: number;
  avgObservedInformedFlowShare: number;
  maxObservedInformedFlowShare: number;
  avgObservedAttackOrderShare: number;
  maxObservedAttackOrderShare: number;
}

export interface SimulationSummary {
  scenario: string;
  seed: number;
  simulatedMinutes: number;
  totalDuels: number;
  activeAgents: number;
  maxSimplexError: number;
  maxObservedLogitStep: number;
  averageTopShare: number;
  entrants: EntrantOutcome[];
  topAgents: TopAgentSnapshot[];
  riskGovernor: RiskGovernorSummary;
  clearinghouse: ClearinghouseSummary;
}

const validateSimulationConfig = (config: SimulationConfig): void => {
  invariant(config.totalMinutes > 0, "totalMinutes must be > 0");
  invariant(config.initialAgentCount >= 2, "initialAgentCount must be >= 2");
  invariant(config.duel.duelIntervalMinutes > 0, "duel interval must be > 0");
  invariant(
    !config.entrants.enabled || config.entrants.intervalMinutes > 0,
    "entrant interval must be > 0 when entrants are enabled",
  );
  invariant(
    config.clearinghouse.traderRespawnMinutes >= 0,
    "traderRespawnMinutes must be >= 0",
  );
  invariant(
    config.clearinghouse.initialMarginRatio >
      config.clearinghouse.maintenanceMarginRatio,
    "initial margin ratio must be > maintenance margin ratio",
  );
  invariant(
    config.clearinghouse.feeSplitToMm >= 0 &&
      config.clearinghouse.feeSplitToMm <= 1,
    "feeSplitToMm must be between 0 and 1",
  );
  invariant(
    config.clearinghouse.maxLeverageListing >= 1,
    "maxLeverageListing must be >= 1",
  );
  invariant(
    config.clearinghouse.maxLeverageMature >=
      config.clearinghouse.maxLeverageListing,
    "maxLeverageMature must be >= maxLeverageListing",
  );
  const rg = config.clearinghouse.riskGovernor;
  invariant(
    rg.thresholds.toxicityEnter >= rg.thresholds.toxicityExit,
    "risk toxicity enter threshold must be >= exit threshold",
  );
  invariant(
    rg.thresholds.informedFlowEnter >= rg.thresholds.informedFlowExit,
    "risk informed-flow enter threshold must be >= exit threshold",
  );
  invariant(
    rg.thresholds.stressDrawdownEnter >= rg.thresholds.stressDrawdownExit,
    "risk drawdown enter threshold must be >= exit threshold",
  );
  invariant(
    rg.thresholds.stressCoverageEnter <= rg.thresholds.stressCoverageExit,
    "risk coverage enter threshold must be <= exit threshold",
  );
};

export class RatingEngine {
  private readonly config: RatingConfig;

  constructor(config: RatingConfig) {
    this.config = config;
  }

  initRating(minute: number): RatingState {
    return {
      mu: this.config.initMu,
      sigma: this.config.initSigma,
      lastUpdatedMinute: minute,
    };
  }

  advanceToMinute(rating: RatingState, minute: number): void {
    if (minute <= rating.lastUpdatedMinute) return;
    const deltaMinutes = minute - rating.lastUpdatedMinute;
    const sigmaIncrease =
      (this.config.sigmaInactivityPerDay * deltaMinutes) / (24 * 60);
    rating.sigma = clamp(
      Math.sqrt(rating.sigma * rating.sigma + sigmaIncrease * sigmaIncrease),
      this.config.sigmaFloor,
      this.config.sigmaCeil,
    );
    rating.lastUpdatedMinute = minute;
  }

  applyPatchShock(ratings: Map<string, RatingState>): void {
    for (const rating of ratings.values()) {
      rating.sigma = clamp(
        rating.sigma + this.config.patchSigmaShock,
        this.config.sigmaFloor,
        this.config.sigmaCeil,
      );
    }
  }

  updateDuel(
    winner: RatingState,
    loser: RatingState,
    minute: number,
  ): { expectedWinner: number } {
    this.advanceToMinute(winner, minute);
    this.advanceToMinute(loser, minute);

    const delta = winner.mu - loser.mu;
    const expectedWinner = logistic(delta / this.config.expectationScale);
    const expectedLoser = 1 - expectedWinner;

    const winnerK =
      this.config.baseK * clamp(winner.sigma / this.config.sigmaRef, 0.25, 2);
    const loserK =
      this.config.baseK * clamp(loser.sigma / this.config.sigmaRef, 0.25, 2);

    winner.mu += winnerK * (1 - expectedWinner);
    loser.mu += loserK * (0 - expectedLoser);

    winner.sigma = clamp(
      winner.sigma * this.config.sigmaShrinkPerDuel,
      this.config.sigmaFloor,
      this.config.sigmaCeil,
    );
    loser.sigma = clamp(
      loser.sigma * this.config.sigmaShrinkPerDuel,
      this.config.sigmaFloor,
      this.config.sigmaCeil,
    );

    return { expectedWinner };
  }
}

export interface IndexSnapshot {
  shares: Map<string, number>;
  logits: Map<string, number>;
  scoreVector: Map<string, number>;
  maxLogitStep: number;
  simplexError: number;
}

export class IndexOracle {
  private readonly config: IndexConfig;
  private publishedScores: Map<string, number> | null = null;
  private publishedLogits: Map<string, number> | null = null;

  constructor(config: IndexConfig) {
    this.config = config;
  }

  publish(rawScoresById: Map<string, number>, ids: string[]): IndexSnapshot {
    const rawScores = mapValues(rawScoresById, ids);
    if (!this.publishedScores || !this.publishedLogits) {
      const initialShares = softmax(rawScores);
      const initialLogits = initialShares.map(shareToLogit);
      this.publishedScores = new Map(
        ids.map((id, index) => [id, rawScores[index]]),
      );
      this.publishedLogits = new Map(
        ids.map((id, index) => [id, initialLogits[index]]),
      );
      return this.snapshotFromScores(ids, rawScores, 0);
    }

    const previousScores = ids.map((id, index) => {
      const previous = this.publishedScores?.get(id);
      if (previous !== undefined) return previous;
      return rawScores[index];
    });
    const fallbackShares = softmax(previousScores);
    const previousLogits = ids.map((id, index) => {
      const previous = this.publishedLogits?.get(id);
      if (previous !== undefined) return previous;
      return shareToLogit(fallbackShares[index]);
    });
    const allowedStep = this.config.maxLogitStepPerMinute;

    const maxDeltaAtAlpha = (alpha: number): number => {
      const scores = previousScores.map(
        (previous, index) => previous + alpha * (rawScores[index] - previous),
      );
      const shares = softmax(scores);
      let maxDelta = 0;
      for (let i = 0; i < shares.length; i++) {
        const delta = Math.abs(shareToLogit(shares[i]) - previousLogits[i]);
        if (delta > maxDelta) {
          maxDelta = delta;
        }
      }
      return maxDelta;
    };

    let alpha = 1;
    if (maxDeltaAtAlpha(1) > allowedStep) {
      let low = 0;
      let high = 1;
      for (let i = 0; i < 28; i++) {
        const mid = (low + high) / 2;
        if (maxDeltaAtAlpha(mid) <= allowedStep) {
          low = mid;
        } else {
          high = mid;
        }
      }
      alpha = low;
    }

    const cappedScores = previousScores.map(
      (previous, index) => previous + alpha * (rawScores[index] - previous),
    );
    const snapshot = this.snapshotFromScores(ids, cappedScores, 0);
    this.publishedScores = snapshot.scoreVector;
    this.publishedLogits = snapshot.logits;

    let maxObserved = 0;
    for (let i = 0; i < ids.length; i++) {
      const current = snapshot.logits.get(ids[i]) ?? 0;
      const delta = Math.abs(current - previousLogits[i]);
      if (delta > maxObserved) {
        maxObserved = delta;
      }
    }
    snapshot.maxLogitStep = maxObserved;
    return snapshot;
  }

  private snapshotFromScores(
    ids: string[],
    scores: number[],
    maxLogitStep: number,
  ): IndexSnapshot {
    const sharesArray = softmax(scores);
    const logitsArray = sharesArray.map(shareToLogit);
    const shares = new Map<string, number>();
    const logits = new Map<string, number>();
    const scoreVector = new Map<string, number>();
    let sum = 0;
    for (let i = 0; i < ids.length; i++) {
      const share = clamp(sharesArray[i], MIN_SHARE, 1 - MIN_SHARE);
      sum += share;
      shares.set(ids[i], share);
      logits.set(ids[i], logitsArray[i]);
      scoreVector.set(ids[i], scores[i]);
    }
    const simplexError = Math.abs(1 - sum);
    return { shares, logits, scoreVector, maxLogitStep, simplexError };
  }
}

export class Clearinghouse {
  private readonly config: ClearinghouseConfig;
  private readonly rng: SeededRandom;
  private readonly traders: TraderAccount[];
  private readonly traderById = new Map<string, TraderAccount>();
  private readonly traderMinuteFlow = new Map<
    string,
    { minute: number; orders: number; notional: number }
  >();
  private readonly marketMinuteFlow = new Map<
    string,
    { minute: number; orders: number; notional: number; net: number }
  >();
  private readonly marketOi = new Map<string, number>();
  private readonly mmInventory = new Map<string, number>();

  private insuranceFund: number;
  private protocolFees = 0;
  private mmFeePool = 0;
  private mmCash: number;
  private mmEquityPeak: number;
  private mmEquityMin: number;
  private mmEquityLast: number;
  private mmStressRatioMax = 0;
  private mmMaxDrawdownAbs = 0;
  private mmMinMinute = 0;
  private mmFirstNegativeMinute: number | null = null;
  private mmBlewOut = false;

  private totalVolume = 0;
  private traderFeesPaid = 0;
  private insuranceUsed = 0;
  private uncoveredBadDebt = 0;
  private adlRecovered = 0;
  private liquidationCount = 0;
  private bankruptcies = 0;
  private blockedByLeverage = 0;
  private blockedByOiCap = 0;
  private blockedByRateLimit = 0;
  private blockedByTraderRateLimit = 0;
  private blockedByMarketRateLimit = 0;
  private blockedByImbalanceLimit = 0;
  private blockedByInitialMargin = 0;
  private traderRespawns = 0;
  private fundingToMm = 0;
  private marketLiquidations = new Map<string, number>();
  private marketBankruptcies = new Map<string, number>();

  private globalOi = 0;

  constructor(config: ClearinghouseConfig, rng: SeededRandom) {
    this.config = config;
    this.rng = rng;
    this.insuranceFund = config.insuranceSeed;
    this.mmCash = config.insuranceSeed;
    this.mmEquityPeak = this.mmCash;
    this.mmEquityMin = this.mmCash;
    this.mmEquityLast = this.mmCash;

    this.traders = Array.from({ length: config.traderCount }, (_, index) => {
      const collateral = Math.max(
        10,
        rng.normal(config.traderCollateralMean, config.traderCollateralStd),
      );
      return {
        id: `trader-${index + 1}`,
        collateral,
        positions: new Map(),
        realizedPnl: 0,
        feesPaid: 0,
        liquidations: 0,
        bankruptcies: 0,
        respawnEligibleMinute: 0,
      };
    });
    for (const trader of this.traders) {
      this.traderById.set(trader.id, trader);
    }
  }

  getTraderIds(): string[] {
    return this.traders.map((trader) => trader.id);
  }

  getMmRiskState(): {
    equity: number;
    peak: number;
    drawdown: number;
    drawdownRatio: number;
  } {
    const drawdown = Math.max(0, this.mmEquityPeak - this.mmEquityLast);
    const drawdownRatio =
      this.mmEquityPeak > 0 ? drawdown / this.mmEquityPeak : 0;
    return {
      equity: this.mmEquityLast,
      peak: this.mmEquityPeak,
      drawdown,
      drawdownRatio,
    };
  }

  insuranceCoverageRatio(): number {
    if (this.config.insuranceSeed <= 0) {
      return 0;
    }
    return this.insuranceFund / this.config.insuranceSeed;
  }

  executeOrder(
    traderId: string,
    side: 1 | -1,
    quantity: number,
    context: TradeContext,
  ): void {
    const trader = this.traderById.get(traderId);
    if (!trader || quantity <= 0) return;
    this.maybeRespawnTrader(trader, context.minute);
    const cappedQuantity =
      this.config.maxOrderQuantity > 0
        ? Math.min(quantity, this.config.maxOrderQuantity)
        : quantity;
    if (cappedQuantity <= MIN_NOTIONAL) return;

    const currentPosition = trader.positions.get(context.marketId)?.size ?? 0;
    let delta = side * cappedQuantity;

    const increaseInMarketOi = this.positionIncreaseDelta(
      currentPosition,
      delta,
    );
    const marketOi = this.marketOi.get(context.marketId) ?? 0;
    const availableMarketOi = context.marketOiCap - marketOi;
    const availableGlobalOi = this.config.globalOiCap - this.globalOi;
    const available = Math.min(availableMarketOi, availableGlobalOi);

    if (increaseInMarketOi > available + MIN_NOTIONAL) {
      if (available <= MIN_NOTIONAL) {
        this.blockedByOiCap++;
        return;
      }
      const reducedAbsDelta = this.reduceDeltaForCap(
        currentPosition,
        delta,
        available,
      );
      if (Math.abs(reducedAbsDelta) <= MIN_NOTIONAL) {
        this.blockedByOiCap++;
        return;
      }
      delta = reducedAbsDelta;
      this.blockedByOiCap++;
    }

    const before = this.accountMetrics(trader, context.marksByMarket);
    const leverageCap = context.maxLeverage;
    if (before.equity <= 0) {
      this.blockedByLeverage++;
      return;
    }

    const maxNotional = before.equity * leverageCap;
    const currentNotional = before.notional;
    const increaseAllowed = maxNotional - currentNotional;
    const increaseRequested = this.positionIncreaseDelta(
      currentPosition,
      delta,
    );
    if (increaseRequested > increaseAllowed + MIN_NOTIONAL) {
      if (increaseAllowed <= MIN_NOTIONAL) {
        this.blockedByLeverage++;
        return;
      }
      const reducedDelta = this.reduceDeltaForCap(
        currentPosition,
        delta,
        increaseAllowed,
      );
      if (Math.abs(reducedDelta) <= MIN_NOTIONAL) {
        this.blockedByLeverage++;
        return;
      }
      delta = reducedDelta;
      this.blockedByLeverage++;
    }

    delta = this.applyMarketRateLimits(
      context.marketId,
      context.minute,
      delta,
      context.marketOrderLimitPerMinute,
      context.marketNotionalLimitPerMinute,
      context.marketNetImbalanceLimitPerMinute,
    );
    if (Math.abs(delta) <= MIN_NOTIONAL) return;

    delta = this.applyTraderRateLimits(trader.id, context.minute, delta);
    if (Math.abs(delta) <= MIN_NOTIONAL) return;

    const tradeSide: 1 | -1 = delta > 0 ? 1 : -1;
    const mmInventory = this.mmInventory.get(context.marketId) ?? 0;
    const projectedMmInventory = mmInventory - delta;
    const inventoryRiskIncrease = Math.max(
      0,
      Math.abs(projectedMmInventory) - Math.abs(mmInventory),
    );
    const inventorySkew =
      Math.max(0, this.config.mmInventorySkewImpact) * inventoryRiskIncrease;
    const executionPrice =
      context.markPrice +
      tradeSide *
        (context.halfSpread +
          (Math.abs(delta) / Math.max(context.depth, 1e-6)) *
            context.impactSlope +
          inventorySkew);
    const openingDelta = this.positionIncreaseDelta(currentPosition, delta);
    if (openingDelta > MIN_NOTIONAL) {
      const currentMarketNotional = Math.abs(currentPosition);
      const projectedPosition = currentPosition + delta;
      const projectedMarketNotional = Math.abs(projectedPosition);
      const projectedNotional =
        before.notional - currentMarketNotional + projectedMarketNotional;
      const immediateMarkout =
        Math.abs(executionPrice - context.markPrice) * Math.abs(delta);
      const projectedEquity =
        before.equity - Math.abs(delta) * context.feeRate - immediateMarkout;
      if (
        projectedNotional > MIN_NOTIONAL &&
        projectedEquity / projectedNotional < this.config.initialMarginRatio
      ) {
        this.blockedByInitialMargin++;
        return;
      }
    }
    this.applyTrade(
      trader,
      context.marketId,
      delta,
      executionPrice,
      context.feeRate,
      false,
      context.markPrice,
    );
  }

  processFunding(
    minute: number,
    marksByMarket: Map<string, number>,
    sensitivityMultiplier = 1,
  ): void {
    if (this.config.fundingIntervalMinutes <= 0) return;
    if (minute % this.config.fundingIntervalMinutes !== 0) return;

    for (const [marketId] of marksByMarket) {
      let totalNotional = 0;
      let netPosition = 0;
      for (const trader of this.traders) {
        const size = trader.positions.get(marketId)?.size ?? 0;
        totalNotional += Math.abs(size);
        netPosition += size;
      }

      if (totalNotional <= MIN_NOTIONAL) continue;

      const rawRate =
        (netPosition / totalNotional) *
        this.config.fundingSensitivity *
        Math.max(0, sensitivityMultiplier);
      const fundingRate = clamp(
        rawRate,
        -this.config.fundingClamp,
        this.config.fundingClamp,
      );
      if (Math.abs(fundingRate) <= 1e-9) continue;

      let netPaid = 0;
      for (const trader of this.traders) {
        const size = trader.positions.get(marketId)?.size ?? 0;
        if (Math.abs(size) <= MIN_NOTIONAL) continue;
        const payment = size * fundingRate;
        trader.collateral -= payment;
        netPaid += payment;
      }
      this.mmCash += netPaid;
      this.fundingToMm += netPaid;
    }
  }

  runLiquidations(minute: number, marksByMarket: Map<string, number>): void {
    const targetRatio =
      this.config.maintenanceMarginRatio + this.config.maintenanceBuffer;

    for (const trader of this.traders) {
      let metrics = this.accountMetrics(trader, marksByMarket);
      if (metrics.notional <= MIN_NOTIONAL) continue;
      if (
        metrics.equity / metrics.notional >=
        this.config.maintenanceMarginRatio
      ) {
        continue;
      }

      let guard = 0;
      while (
        metrics.notional > MIN_NOTIONAL &&
        metrics.equity / metrics.notional < targetRatio &&
        guard < 10
      ) {
        guard++;
        const largestPosition = this.findLargestPosition(trader);
        if (!largestPosition) break;
        const marketPrice = marksByMarket.get(largestPosition.marketId) ?? 0;
        const requiredNotional = Math.max(0, metrics.equity / targetRatio);
        const desiredClose = Math.max(
          metrics.notional - requiredNotional,
          Math.abs(largestPosition.position.size) * 0.25,
        );
        const closeQuantity = Math.min(
          Math.abs(largestPosition.position.size),
          desiredClose,
        );
        if (closeQuantity <= MIN_NOTIONAL) break;

        const side: 1 | -1 = largestPosition.position.size > 0 ? -1 : 1;
        const delta = side * closeQuantity;
        const liquidationPrice =
          marketPrice + side * this.config.liquidationSlippage;
        this.applyTrade(
          trader,
          largestPosition.marketId,
          delta,
          liquidationPrice,
          0,
          true,
          marketPrice,
        );

        const penalty = closeQuantity * this.config.liquidationPenaltyRate;
        trader.collateral -= penalty;
        this.insuranceFund += penalty;
        trader.liquidations++;
        this.liquidationCount++;
        this.incrementCount(
          this.marketLiquidations,
          largestPosition.marketId,
          1,
        );
        metrics = this.accountMetrics(trader, marksByMarket);
      }

      metrics = this.accountMetrics(trader, marksByMarket);
      if (metrics.equity >= 0) {
        continue;
      }

      const largestBeforeBankruptcy = this.findLargestPosition(trader);
      this.closeAllPositionsAtMark(trader, marksByMarket);
      metrics = this.accountMetrics(trader, marksByMarket);
      let badDebt = Math.max(0, -metrics.equity);
      if (badDebt > 0) {
        const covered = Math.min(this.insuranceFund, badDebt);
        this.insuranceFund -= covered;
        this.insuranceUsed += covered;
        badDebt -= covered;

        if (badDebt > 0 && this.config.enableAdl) {
          const recovered = this.applyAdl(badDebt, marksByMarket);
          this.adlRecovered += recovered;
          badDebt -= recovered;
        }

        if (badDebt > 0) {
          this.uncoveredBadDebt += badDebt;
        }
      }

      trader.collateral = 0;
      trader.bankruptcies++;
      if (this.config.traderRespawnMinutes > 0) {
        trader.respawnEligibleMinute =
          minute + this.config.traderRespawnMinutes;
      }
      this.bankruptcies++;
      if (largestBeforeBankruptcy) {
        this.incrementCount(
          this.marketBankruptcies,
          largestBeforeBankruptcy.marketId,
          1,
        );
      }
    }
  }

  markToMarket(
    marksByMarket: Map<string, number>,
    minute: number,
    carryMultiplier = 1,
  ): void {
    let inventoryValue = 0;
    let inventoryAbs = 0;
    for (const [marketId, inventory] of this.mmInventory) {
      const mark = marksByMarket.get(marketId) ?? 0;
      inventoryValue += inventory * mark;
      inventoryAbs += Math.abs(inventory);
    }
    if (this.config.mmInventoryCarryPerMinute > 0 && inventoryAbs > 0) {
      this.mmCash -=
        inventoryAbs *
        this.config.mmInventoryCarryPerMinute *
        Math.max(0, carryMultiplier);
    }
    const equity = this.mmCash + inventoryValue + this.mmFeePool;
    this.mmEquityLast = equity;
    this.mmEquityPeak = Math.max(this.mmEquityPeak, equity);
    if (equity < this.mmEquityMin) {
      this.mmEquityMin = equity;
      this.mmMinMinute = minute;
    }
    const drawdown = Math.max(0, this.mmEquityPeak - equity);
    const drawdownRatio =
      this.mmEquityPeak > 0 ? drawdown / this.mmEquityPeak : 0;
    if (drawdownRatio > this.mmStressRatioMax) {
      this.mmStressRatioMax = drawdownRatio;
    }
    if (drawdown > this.mmMaxDrawdownAbs) {
      this.mmMaxDrawdownAbs = drawdown;
    }
    if (equity < 0) {
      this.mmBlewOut = true;
      if (this.mmFirstNegativeMinute === null) {
        this.mmFirstNegativeMinute = minute;
      }
    }
  }

  summary(): ClearinghouseSummary {
    const mmEquityEnd = this.mmEquityLast;
    const mmPnlTotal = mmEquityEnd - this.config.insuranceSeed;
    const mmPnlFromFeesAndFunding = this.mmFeePool + this.fundingToMm;
    const mmPnlExFeesAndFunding = mmPnlTotal - mmPnlFromFeesAndFunding;
    const mmPeakToTrough = this.mmMaxDrawdownAbs;
    return {
      totalVolume: this.totalVolume,
      traderFeesPaid: this.traderFeesPaid,
      protocolFees: this.protocolFees,
      mmFeePool: this.mmFeePool,
      insuranceStart: this.config.insuranceSeed,
      insuranceEnd: this.insuranceFund,
      insuranceUsed: this.insuranceUsed,
      uncoveredBadDebt: this.uncoveredBadDebt,
      adlRecovered: this.adlRecovered,
      liquidationCount: this.liquidationCount,
      bankruptcies: this.bankruptcies,
      blockedByLeverage: this.blockedByLeverage,
      blockedByOiCap: this.blockedByOiCap,
      blockedByRateLimit: this.blockedByRateLimit,
      blockedByTraderRateLimit: this.blockedByTraderRateLimit,
      blockedByMarketRateLimit: this.blockedByMarketRateLimit,
      blockedByImbalanceLimit: this.blockedByImbalanceLimit,
      blockedByInitialMargin: this.blockedByInitialMargin,
      traderRespawns: this.traderRespawns,
      fundingToMm: this.fundingToMm,
      mmEquityStart: this.config.insuranceSeed,
      mmEquityEnd,
      mmPnlTotal,
      mmPnlFromFeesAndFunding,
      mmPnlExFeesAndFunding,
      mmEquityMin: this.mmEquityMin,
      mmEquityPeak: this.mmEquityPeak,
      mmPeakToTrough,
      mmStressRatioMax: this.mmStressRatioMax,
      mmMinMinute: this.mmMinMinute,
      mmFirstNegativeMinute: this.mmFirstNegativeMinute,
      mmBlewOut: this.mmBlewOut,
      liquidationHotspots: this.buildLiquidationHotspots(),
    };
  }

  private closeAllPositionsAtMark(
    trader: TraderAccount,
    marksByMarket: Map<string, number>,
  ): void {
    const openPositions = Array.from(trader.positions.entries());
    for (const [marketId, position] of openPositions) {
      if (Math.abs(position.size) <= MIN_NOTIONAL) continue;
      const mark = marksByMarket.get(marketId) ?? position.entryPrice;
      this.applyTrade(trader, marketId, -position.size, mark, 0, true, mark);
    }
  }

  private applyAdl(amount: number, marksByMarket: Map<string, number>): number {
    if (amount <= 0) return 0;

    const profitable: Array<{ trader: TraderAccount; unrealized: number }> = [];
    let totalPositive = 0;
    for (const trader of this.traders) {
      const metrics = this.accountMetrics(trader, marksByMarket);
      if (metrics.unrealized > 0 && trader.collateral > 0) {
        profitable.push({ trader, unrealized: metrics.unrealized });
        totalPositive += metrics.unrealized;
      }
    }
    if (totalPositive <= 0) return 0;

    const ratio = clamp(amount / totalPositive, 0, 1);
    let recovered = 0;
    for (const entry of profitable) {
      const haircutTarget = entry.unrealized * ratio;
      const haircut = Math.min(entry.trader.collateral, haircutTarget);
      if (haircut <= 0) continue;
      entry.trader.collateral -= haircut;
      recovered += haircut;
    }
    return recovered;
  }

  private findLargestPosition(
    trader: TraderAccount,
  ): { marketId: string; position: Position } | null {
    let best: { marketId: string; position: Position } | null = null;
    for (const [marketId, position] of trader.positions) {
      if (!best || Math.abs(position.size) > Math.abs(best.position.size)) {
        best = { marketId, position };
      }
    }
    return best;
  }

  private accountMetrics(
    trader: TraderAccount,
    marksByMarket: Map<string, number>,
  ): { unrealized: number; notional: number; equity: number } {
    let unrealized = 0;
    let notional = 0;
    for (const [marketId, position] of trader.positions) {
      const mark = marksByMarket.get(marketId) ?? position.entryPrice;
      unrealized += position.size * (mark - position.entryPrice);
      notional += Math.abs(position.size);
    }
    const equity = trader.collateral + unrealized;
    return { unrealized, notional, equity };
  }

  private maybeRespawnTrader(trader: TraderAccount, minute: number): void {
    if (trader.positions.size > 0) return;
    if (trader.collateral > 0) return;
    if (minute < trader.respawnEligibleMinute) return;
    if (this.config.traderRespawnMinutes <= 0) return;

    trader.collateral = Math.max(
      10,
      this.rng.normal(
        this.config.traderRespawnCollateralMean,
        this.config.traderRespawnCollateralStd,
      ),
    );
    this.traderRespawns++;
  }

  private applyTraderRateLimits(
    traderId: string,
    minute: number,
    delta: number,
  ): number {
    if (Math.abs(delta) <= MIN_NOTIONAL) return 0;

    const orderLimit = this.config.traderOrderLimitPerMinute;
    const notionalLimit = this.config.traderNotionalLimitPerMinute;
    if (orderLimit <= 0 && notionalLimit <= 0) {
      return delta;
    }

    let bucket = this.traderMinuteFlow.get(traderId);
    if (!bucket || bucket.minute !== minute) {
      bucket = {
        minute,
        orders: 0,
        notional: 0,
      };
      this.traderMinuteFlow.set(traderId, bucket);
    }

    if (orderLimit > 0 && bucket.orders >= orderLimit) {
      this.blockedByRateLimit++;
      this.blockedByTraderRateLimit++;
      return 0;
    }

    let permittedDelta = delta;
    if (notionalLimit > 0) {
      const remaining = Math.max(0, notionalLimit - bucket.notional);
      if (remaining <= MIN_NOTIONAL) {
        this.blockedByRateLimit++;
        this.blockedByTraderRateLimit++;
        return 0;
      }
      if (Math.abs(permittedDelta) > remaining + MIN_NOTIONAL) {
        permittedDelta = Math.sign(permittedDelta) * remaining;
        this.blockedByRateLimit++;
        this.blockedByTraderRateLimit++;
      }
    }

    if (Math.abs(permittedDelta) <= MIN_NOTIONAL) {
      return 0;
    }

    bucket.orders += 1;
    bucket.notional += Math.abs(permittedDelta);
    return permittedDelta;
  }

  private applyMarketRateLimits(
    marketId: string,
    minute: number,
    delta: number,
    orderLimit: number,
    notionalLimit: number,
    imbalanceLimit: number,
  ): number {
    if (Math.abs(delta) <= MIN_NOTIONAL) return 0;
    if (orderLimit <= 0 && notionalLimit <= 0 && imbalanceLimit <= 0) {
      return delta;
    }

    let bucket = this.marketMinuteFlow.get(marketId);
    if (!bucket || bucket.minute !== minute) {
      bucket = {
        minute,
        orders: 0,
        notional: 0,
        net: 0,
      };
      this.marketMinuteFlow.set(marketId, bucket);
    }

    if (orderLimit > 0 && bucket.orders >= orderLimit) {
      this.blockedByRateLimit++;
      this.blockedByMarketRateLimit++;
      return 0;
    }

    let permittedDelta = delta;
    if (notionalLimit > 0) {
      const remaining = Math.max(0, notionalLimit - bucket.notional);
      if (remaining <= MIN_NOTIONAL) {
        this.blockedByRateLimit++;
        this.blockedByMarketRateLimit++;
        return 0;
      }
      if (Math.abs(permittedDelta) > remaining + MIN_NOTIONAL) {
        permittedDelta = Math.sign(permittedDelta) * remaining;
        this.blockedByRateLimit++;
        this.blockedByMarketRateLimit++;
      }
    }

    if (imbalanceLimit > 0) {
      const minAllowed = -imbalanceLimit - bucket.net;
      const maxAllowed = imbalanceLimit - bucket.net;
      const clampedDelta = clamp(permittedDelta, minAllowed, maxAllowed);
      if (Math.abs(clampedDelta) <= MIN_NOTIONAL) {
        this.blockedByRateLimit++;
        this.blockedByMarketRateLimit++;
        this.blockedByImbalanceLimit++;
        return 0;
      }
      if (Math.abs(clampedDelta - permittedDelta) > MIN_NOTIONAL) {
        permittedDelta = clampedDelta;
        this.blockedByRateLimit++;
        this.blockedByMarketRateLimit++;
        this.blockedByImbalanceLimit++;
      }
    }

    if (Math.abs(permittedDelta) <= MIN_NOTIONAL) {
      return 0;
    }

    bucket.orders += 1;
    bucket.notional += Math.abs(permittedDelta);
    bucket.net += permittedDelta;
    return permittedDelta;
  }

  private positionIncreaseDelta(currentSize: number, delta: number): number {
    const sameDirection =
      currentSize === 0 || Math.sign(currentSize) === Math.sign(delta);
    if (sameDirection) {
      return Math.abs(delta);
    }
    const closeAmount = Math.min(Math.abs(currentSize), Math.abs(delta));
    return Math.max(0, Math.abs(delta) - closeAmount);
  }

  private reduceDeltaForCap(
    currentSize: number,
    delta: number,
    capIncrease: number,
  ): number {
    const sign = delta >= 0 ? 1 : -1;
    const absDelta = Math.abs(delta);
    if (currentSize === 0 || Math.sign(currentSize) === Math.sign(delta)) {
      return sign * Math.min(absDelta, capIncrease);
    }
    const closeAmount = Math.min(Math.abs(currentSize), absDelta);
    const opening = Math.max(0, absDelta - closeAmount);
    const allowedOpening = Math.min(opening, capIncrease);
    return sign * (closeAmount + allowedOpening);
  }

  private applyTrade(
    trader: TraderAccount,
    marketId: string,
    delta: number,
    executionPrice: number,
    feeRate: number,
    liquidation: boolean,
    markPrice: number,
  ): void {
    if (Math.abs(delta) <= MIN_NOTIONAL) return;
    const previous = trader.positions.get(marketId) ?? {
      size: 0,
      entryPrice: markPrice,
    };
    const result = this.applyPositionMath(previous, delta, executionPrice);

    this.updateOi(marketId, previous.size, result.size);

    if (Math.abs(result.size) <= MIN_NOTIONAL) {
      trader.positions.delete(marketId);
    } else {
      trader.positions.set(marketId, {
        size: result.size,
        entryPrice: result.entryPrice,
      });
    }

    trader.realizedPnl += result.realized;
    trader.collateral += result.realized;

    if (!liquidation && feeRate > 0) {
      const fee = Math.abs(delta) * feeRate;
      trader.collateral -= fee;
      trader.feesPaid += fee;
      this.traderFeesPaid += fee;

      const mmShare = fee * this.config.feeSplitToMm;
      this.mmFeePool += mmShare;
      this.protocolFees += fee - mmShare;
    }

    const mmInventory = this.mmInventory.get(marketId) ?? 0;
    this.mmInventory.set(marketId, mmInventory - delta);
    this.mmCash += delta * executionPrice;
    this.totalVolume += Math.abs(delta);
  }

  private updateOi(
    marketId: string,
    previousSize: number,
    nextSize: number,
  ): void {
    const previousOi = Math.abs(previousSize);
    const nextOi = Math.abs(nextSize);
    const delta = nextOi - previousOi;
    const market = this.marketOi.get(marketId) ?? 0;
    this.marketOi.set(marketId, Math.max(0, market + delta));
    this.globalOi = Math.max(0, this.globalOi + delta);
  }

  private applyPositionMath(
    current: Position,
    delta: number,
    executionPrice: number,
  ): { size: number; entryPrice: number; realized: number } {
    const currentSize = current.size;
    if (Math.abs(currentSize) <= MIN_NOTIONAL) {
      return {
        size: delta,
        entryPrice: executionPrice,
        realized: 0,
      };
    }

    const sameDirection = Math.sign(currentSize) === Math.sign(delta);
    if (sameDirection) {
      const nextSize = currentSize + delta;
      const weightedEntry =
        (currentSize * current.entryPrice + delta * executionPrice) / nextSize;
      return { size: nextSize, entryPrice: weightedEntry, realized: 0 };
    }

    const closeQuantity = Math.min(Math.abs(currentSize), Math.abs(delta));
    const realized =
      closeQuantity *
      (executionPrice - current.entryPrice) *
      Math.sign(currentSize);
    const remaining = currentSize + delta;
    if (Math.abs(remaining) <= MIN_NOTIONAL) {
      return { size: 0, entryPrice: executionPrice, realized };
    }
    if (Math.sign(remaining) === Math.sign(currentSize)) {
      return { size: remaining, entryPrice: current.entryPrice, realized };
    }
    return { size: remaining, entryPrice: executionPrice, realized };
  }

  rebalanceInventory(
    marksByMarket: Map<string, number>,
    hedgeRateMultiplier = 1,
    hedgeSpreadMultiplier = 1,
  ): void {
    const rate = clamp(
      this.config.mmHedgeRatePerMinute * Math.max(0, hedgeRateMultiplier),
      0,
      1,
    );
    if (rate <= 0) return;
    for (const [marketId, inventory] of this.mmInventory) {
      if (Math.abs(inventory) <= MIN_NOTIONAL) continue;
      const mark = marksByMarket.get(marketId) ?? 0;
      const hedgeQty = Math.abs(inventory) * rate;
      const trade = inventory > 0 ? -hedgeQty : hedgeQty;
      const side = Math.sign(trade);
      const price =
        mark +
        side *
          this.config.mmHedgeHalfSpread *
          Math.max(0, hedgeSpreadMultiplier);
      this.mmCash -= trade * price;
      this.mmInventory.set(marketId, inventory + trade);
    }
  }

  private incrementCount(
    map: Map<string, number>,
    key: string,
    delta: number,
  ): void {
    map.set(key, (map.get(key) ?? 0) + delta);
  }

  private buildLiquidationHotspots(): MarketLiquidationHotspot[] {
    const marketIds = new Set([
      ...this.marketLiquidations.keys(),
      ...this.marketBankruptcies.keys(),
    ]);
    const hotspots: MarketLiquidationHotspot[] = [];
    for (const marketId of marketIds) {
      hotspots.push({
        marketId,
        liquidations: this.marketLiquidations.get(marketId) ?? 0,
        bankruptcies: this.marketBankruptcies.get(marketId) ?? 0,
      });
    }
    hotspots.sort((a, b) => {
      if (b.liquidations !== a.liquidations) {
        return b.liquidations - a.liquidations;
      }
      return b.bankruptcies - a.bankruptcies;
    });
    return hotspots.slice(0, 8);
  }
}

class Matchmaker {
  private readonly repeatPenaltyMinutes: number;
  private readonly recentPairs = new Map<string, number>();

  constructor(repeatPenaltyMinutes: number) {
    this.repeatPenaltyMinutes = repeatPenaltyMinutes;
  }

  pickPair(
    agentIds: string[],
    ratingById: Map<string, RatingState>,
    matchCountById: Map<string, number>,
    minute: number,
    rng: SeededRandom,
  ): [string, string] | null {
    if (agentIds.length < 2) return null;

    const sorted = [...agentIds].sort((a, b) => {
      const aCount = matchCountById.get(a) ?? 0;
      const bCount = matchCountById.get(b) ?? 0;
      if (aCount !== bCount) return aCount - bCount;
      return (ratingById.get(a)?.mu ?? 0) - (ratingById.get(b)?.mu ?? 0);
    });

    const poolSize = Math.max(2, Math.ceil(sorted.length / 2));
    const primary = sorted[rng.int(0, poolSize)];

    let bestCandidate: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of sorted) {
      if (candidate === primary) continue;
      const matchGap = Math.abs(
        (matchCountById.get(primary) ?? 0) -
          (matchCountById.get(candidate) ?? 0),
      );
      const ratingGap = Math.abs(
        (ratingById.get(primary)?.mu ?? 0) -
          (ratingById.get(candidate)?.mu ?? 0),
      );
      const pairKey = this.pairKey(primary, candidate);
      const lastSeen = this.recentPairs.get(pairKey) ?? -Infinity;
      const recentPenalty =
        minute - lastSeen < this.repeatPenaltyMinutes ? 4 : 0;
      const noise = rng.next() * 0.2;
      const score = matchGap * 1.3 + ratingGap * 0.9 + recentPenalty + noise;
      if (score < bestScore) {
        bestScore = score;
        bestCandidate = candidate;
      }
    }

    if (!bestCandidate) {
      return null;
    }

    this.recentPairs.set(this.pairKey(primary, bestCandidate), minute);
    return [primary, bestCandidate];
  }

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
  }
}

interface ResolvedRegime {
  name: string;
  orderFlowMultiplier: number;
  informedFlowShareOverride: number | null;
  signalNoiseMultiplier: number;
  halfSpreadMultiplier: number;
  depthMultiplier: number;
  impactMultiplier: number;
  oiCapMultiplier: number;
  leverageMultiplier: number;
  fundingSensitivityMultiplier: number;
  mmCarryMultiplier: number;
  mmHedgeRateMultiplier: number;
  mmHedgeSpreadMultiplier: number;
  mevAttackIntensity: number;
  attackSizeMultiplier: number;
  attackSybilShare: number;
  oracleLagMinutes: number;
  metaDriftPerMinute: number;
  topAgentSkillBoostPerMinute: number;
}

interface OrderFlowStats {
  totalOrders: number;
  informedOrders: number;
  attackOrders: number;
}

export class DuelArenaSimulation {
  private readonly config: SimulationConfig;
  private readonly rng: SeededRandom;
  private readonly ratingEngine: RatingEngine;
  private readonly indexOracle: IndexOracle;
  private readonly clearinghouse: Clearinghouse;
  private readonly matchmaker: Matchmaker;
  private readonly riskGovernor: RiskGovernor;

  private readonly agents = new Map<string, AgentState>();
  private readonly ratings = new Map<string, RatingState>();
  private readonly matchCounts = new Map<string, number>();
  private readonly entrantSnapshots = new Map<string, EntrantSnapshot>();
  private readonly indexLogitHistory: Array<Map<string, number>> = [];

  private totalDuels = 0;
  private maxSimplexError = 0;
  private maxObservedLogitStep = 0;
  private topShareAccumulator = 0;
  private topShareSamples = 0;
  private globalMetaShift = 0;
  private latestRiskSnapshot: RiskGovernorSnapshot | null = null;
  private lastObservedInformedFlowShare: number;
  private flowSampleCount = 0;
  private informedFlowShareAccumulator = 0;
  private maxObservedInformedFlowShare = 0;
  private attackOrderShareAccumulator = 0;
  private maxObservedAttackOrderShare = 0;

  constructor(config: SimulationConfig, seedOverride?: number) {
    validateSimulationConfig(config);
    this.config = config;
    this.rng = new SeededRandom(seedOverride ?? config.seed);
    this.ratingEngine = new RatingEngine(config.rating);
    this.indexOracle = new IndexOracle(config.index);
    this.clearinghouse = new Clearinghouse(config.clearinghouse, this.rng);
    this.matchmaker = new Matchmaker(config.duel.matchRepeatPenaltyMinutes);
    this.riskGovernor = new RiskGovernor(config.clearinghouse.riskGovernor);
    this.lastObservedInformedFlowShare = config.clearinghouse.informedFlowShare;

    for (let i = 0; i < config.initialAgentCount; i++) {
      this.addAgent(0, false);
    }
  }

  private resolveRegime(minute: number): ResolvedRegime {
    const defaultRegime: ResolvedRegime = {
      name: "default",
      orderFlowMultiplier: 1,
      informedFlowShareOverride: null,
      signalNoiseMultiplier: 1,
      halfSpreadMultiplier: 1,
      depthMultiplier: 1,
      impactMultiplier: 1,
      oiCapMultiplier: 1,
      leverageMultiplier: 1,
      fundingSensitivityMultiplier: 1,
      mmCarryMultiplier: 1,
      mmHedgeRateMultiplier: 1,
      mmHedgeSpreadMultiplier: 1,
      mevAttackIntensity: 0,
      attackSizeMultiplier: 1,
      attackSybilShare: 1,
      oracleLagMinutes: 0,
      metaDriftPerMinute: 0,
      topAgentSkillBoostPerMinute: 0,
    };

    const regimes = this.config.regimes ?? [];
    const active = regimes.find(
      (regime) => minute >= regime.startMinute && minute < regime.endMinute,
    );
    if (!active) return defaultRegime;

    return {
      name: active.name,
      orderFlowMultiplier: active.orderFlowMultiplier ?? 1,
      informedFlowShareOverride: active.informedFlowShareOverride ?? null,
      signalNoiseMultiplier: active.signalNoiseMultiplier ?? 1,
      halfSpreadMultiplier: active.halfSpreadMultiplier ?? 1,
      depthMultiplier: active.depthMultiplier ?? 1,
      impactMultiplier: active.impactMultiplier ?? 1,
      oiCapMultiplier: active.oiCapMultiplier ?? 1,
      leverageMultiplier: active.leverageMultiplier ?? 1,
      fundingSensitivityMultiplier: active.fundingSensitivityMultiplier ?? 1,
      mmCarryMultiplier: active.mmCarryMultiplier ?? 1,
      mmHedgeRateMultiplier: active.mmHedgeRateMultiplier ?? 1,
      mmHedgeSpreadMultiplier: active.mmHedgeSpreadMultiplier ?? 1,
      mevAttackIntensity: active.mevAttackIntensity ?? 0,
      attackSizeMultiplier: active.attackSizeMultiplier ?? 1,
      attackSybilShare: active.attackSybilShare ?? 1,
      oracleLagMinutes: Math.max(0, Math.floor(active.oracleLagMinutes ?? 0)),
      metaDriftPerMinute: active.metaDriftPerMinute ?? 0,
      topAgentSkillBoostPerMinute: active.topAgentSkillBoostPerMinute ?? 0,
    };
  }

  run(): SimulationSummary {
    for (let minute = 0; minute < this.config.totalMinutes; minute++) {
      const regime = this.resolveRegime(minute);
      this.maybeAddEntrant(minute);
      this.maybePatch(minute);
      this.advanceAgents(minute, regime);

      if (minute % this.config.duel.duelIntervalMinutes === 0) {
        this.runDuel(minute);
      }

      const agentIds = Array.from(this.agents.keys()).sort();
      const scoreById = this.buildRatingScoreVector(agentIds);
      const indexSnapshot = this.indexOracle.publish(scoreById, agentIds);
      this.indexLogitHistory[minute] = new Map(indexSnapshot.logits);
      this.maxSimplexError = Math.max(
        this.maxSimplexError,
        indexSnapshot.simplexError,
      );
      this.maxObservedLogitStep = Math.max(
        this.maxObservedLogitStep,
        indexSnapshot.maxLogitStep,
      );

      const topShare = Math.max(...Array.from(indexSnapshot.shares.values()));
      this.topShareAccumulator += topShare;
      this.topShareSamples++;

      const truePrices = this.buildTruePriceVector(agentIds);
      const tradableLogits = this.resolveTradableLogits(
        minute,
        agentIds,
        regime.oracleLagMinutes,
      );
      const markets = this.buildMarketStates(
        agentIds,
        tradableLogits,
        truePrices,
        indexSnapshot.shares,
        minute,
      );
      const marksByMarket = new Map(
        markets.map((market) => [market.id, market.indexPrice]),
      );
      const riskSnapshot = this.updateRiskGovernor(minute, markets);
      this.latestRiskSnapshot = riskSnapshot;

      const flowStats = this.runOrderFlow(
        minute,
        markets,
        marksByMarket,
        regime,
        riskSnapshot.profile,
      );
      this.captureFlowStats(flowStats);
      this.clearinghouse.processFunding(
        minute,
        marksByMarket,
        regime.fundingSensitivityMultiplier,
      );
      this.clearinghouse.runLiquidations(minute, marksByMarket);
      this.clearinghouse.rebalanceInventory(
        marksByMarket,
        regime.mmHedgeRateMultiplier * riskSnapshot.profile.hedgeRateMultiplier,
        regime.mmHedgeSpreadMultiplier,
      );
      this.clearinghouse.markToMarket(
        marksByMarket,
        minute,
        regime.mmCarryMultiplier,
      );
      this.captureEntrantSnapshots(minute);
    }

    const rankedAgents = this.buildRankedAgents();
    const entrants = this.buildEntrantOutcomes(rankedAgents);

    return {
      scenario: this.config.name,
      seed: this.config.seed,
      simulatedMinutes: this.config.totalMinutes,
      totalDuels: this.totalDuels,
      activeAgents: this.agents.size,
      maxSimplexError: this.maxSimplexError,
      maxObservedLogitStep: this.maxObservedLogitStep,
      averageTopShare:
        this.topShareSamples > 0
          ? this.topShareAccumulator / this.topShareSamples
          : 0,
      entrants,
      topAgents: rankedAgents.slice(0, 12),
      riskGovernor: this.buildRiskGovernorSummary(),
      clearinghouse: this.clearinghouse.summary(),
    };
  }

  private addAgent(joinMinute: number, isEntrant: boolean): string {
    const id = `agent-${this.agents.size + 1}`;
    const baseSkill = this.rng.normal(0, 0.7);
    const growthCeiling = isEntrant
      ? this.rng.normal(1.7, 0.35)
      : this.rng.normal(0.9, 0.2);
    const growthRate = isEntrant
      ? clamp(this.rng.normal(0.55, 0.12), 0.25, 1.1)
      : clamp(this.rng.normal(0.22, 0.05), 0.1, 0.45);
    const startPenalty = isEntrant
      ? clamp(this.rng.normal(2.0, 0.25), 1.3, 2.6)
      : clamp(this.rng.normal(0.5, 0.15), 0.1, 1.1);
    const penaltyDecayRate = isEntrant
      ? clamp(this.rng.normal(0.45, 0.1), 0.2, 0.9)
      : clamp(this.rng.normal(0.2, 0.05), 0.08, 0.4);

    const agent: AgentState = {
      id,
      joinMinute,
      baseSkill,
      growthCeiling,
      growthRate,
      startPenalty,
      penaltyDecayRate,
      metaSensitivity: this.rng.normal(0, 0.45),
      level: isEntrant ? 1 : clamp(this.rng.normal(8, 2), 3, 14),
      xp: isEntrant ? 0 : this.rng.normal(900, 250),
      trueSkill: 0,
      wins: 0,
      losses: 0,
      matches: 0,
      isEntrant,
    };
    this.agents.set(id, agent);
    this.ratings.set(id, this.ratingEngine.initRating(joinMinute));
    this.matchCounts.set(id, 0);
    if (isEntrant) {
      this.entrantSnapshots.set(id, {
        id,
        joinedMinute: joinMinute,
        winsDay1: null,
        lossesDay1: null,
        winsDay7: null,
        lossesDay7: null,
      });
    }
    return id;
  }

  private maybeAddEntrant(minute: number): void {
    if (!this.config.entrants.enabled) return;
    if (minute === 0) return;
    if (minute % this.config.entrants.intervalMinutes !== 0) return;
    this.addAgent(minute, true);
  }

  private maybePatch(minute: number): void {
    if (minute === 0) return;
    if (this.config.duel.patchIntervalMinutes <= 0) return;
    if (minute % this.config.duel.patchIntervalMinutes !== 0) return;
    this.globalMetaShift += this.rng.normal(0, 1);
    this.ratingEngine.applyPatchShock(this.ratings);
  }

  private advanceAgents(minute: number, regime: ResolvedRegime): void {
    if (regime.metaDriftPerMinute !== 0) {
      this.globalMetaShift += regime.metaDriftPerMinute;
    }

    if (regime.topAgentSkillBoostPerMinute > 0 && this.agents.size > 0) {
      const topAgent = Array.from(this.agents.values()).sort(
        (a, b) => b.trueSkill - a.trueSkill,
      )[0];
      if (topAgent) {
        topAgent.baseSkill += regime.topAgentSkillBoostPerMinute;
      }
    }

    for (const agent of this.agents.values()) {
      const ageDays = Math.max(0, (minute - agent.joinMinute) / (24 * 60));
      const growth =
        agent.growthCeiling * (1 - Math.exp(-agent.growthRate * ageDays));
      const penalty =
        agent.startPenalty * Math.exp(-agent.penaltyDecayRate * ageDays);
      agent.xp += this.config.evolution.passiveXpPerMinute;
      agent.level = 1 + Math.sqrt(Math.max(agent.xp, 0)) * 0.18;

      const drift = this.rng.normal(
        0,
        this.config.evolution.skillDriftStdPerMinute,
      );
      agent.trueSkill =
        agent.baseSkill +
        growth -
        penalty +
        agent.level * this.config.evolution.levelSkillCoeff +
        this.globalMetaShift * agent.metaSensitivity +
        drift;

      const rating = this.ratings.get(agent.id);
      if (rating) {
        this.ratingEngine.advanceToMinute(rating, minute);
      }
    }
  }

  private runDuel(minute: number): void {
    const ids = Array.from(this.agents.keys());
    const pair = this.matchmaker.pickPair(
      ids,
      this.ratings,
      this.matchCounts,
      minute,
      this.rng,
    );
    if (!pair) return;
    const [aId, bId] = pair;
    const agentA = this.agents.get(aId);
    const agentB = this.agents.get(bId);
    const ratingA = this.ratings.get(aId);
    const ratingB = this.ratings.get(bId);
    if (!agentA || !agentB || !ratingA || !ratingB) return;

    const duelEdge =
      (agentA.trueSkill - agentB.trueSkill) /
        this.config.duel.duelOutcomeScale +
      this.rng.normal(0, this.config.duel.duelNoise);
    const probabilityA = logistic(duelEdge);
    const aWins = this.rng.bool(probabilityA);
    const winnerAgent = aWins ? agentA : agentB;
    const loserAgent = aWins ? agentB : agentA;
    const winnerRating = aWins ? ratingA : ratingB;
    const loserRating = aWins ? ratingB : ratingA;

    winnerAgent.wins++;
    winnerAgent.matches++;
    winnerAgent.xp += this.config.evolution.duelXp;
    loserAgent.losses++;
    loserAgent.matches++;
    loserAgent.xp += this.config.evolution.duelXp;
    this.matchCounts.set(aId, (this.matchCounts.get(aId) ?? 0) + 1);
    this.matchCounts.set(bId, (this.matchCounts.get(bId) ?? 0) + 1);

    this.ratingEngine.updateDuel(winnerRating, loserRating, minute);
    this.totalDuels++;
  }

  private buildRatingScoreVector(agentIds: string[]): Map<string, number> {
    const scoreVector = new Map<string, number>();
    for (const id of agentIds) {
      const rating = this.ratings.get(id);
      if (!rating) continue;
      const score =
        this.config.index.beta *
        (rating.mu - this.config.index.uncertaintyPenalty * rating.sigma);
      scoreVector.set(id, score);
    }
    return scoreVector;
  }

  private buildTruePriceVector(agentIds: string[]): Map<string, number> {
    const scores = agentIds.map((id) => {
      const agent = this.agents.get(id);
      return this.config.index.beta * (agent?.trueSkill ?? 0);
    });
    const shares = softmax(scores).map((share) =>
      clamp(share, MIN_SHARE, 1 - MIN_SHARE),
    );
    const logits = shares.map(shareToLogit);
    return new Map(agentIds.map((id, index) => [id, logits[index]]));
  }

  private resolveTradableLogits(
    minute: number,
    agentIds: string[],
    lagMinutes: number,
  ): Map<string, number> {
    const current = this.indexLogitHistory[minute] ?? new Map<string, number>();
    const laggedMinute = Math.max(0, minute - Math.max(0, lagMinutes));
    const lagged = this.indexLogitHistory[laggedMinute] ?? current;
    const merged = new Map<string, number>();
    for (const id of agentIds) {
      const laggedValue = lagged.get(id);
      if (laggedValue !== undefined) {
        merged.set(id, laggedValue);
      } else {
        merged.set(id, current.get(id) ?? 0);
      }
    }
    return merged;
  }

  private buildMarketStates(
    agentIds: string[],
    indexLogits: Map<string, number>,
    trueLogits: Map<string, number>,
    shares: Map<string, number>,
    minute: number,
  ): MarketState[] {
    const markets: MarketState[] = [];
    for (const id of agentIds) {
      const agent = this.agents.get(id);
      if (!agent) continue;
      markets.push({
        id,
        indexPrice: indexLogits.get(id) ?? 0,
        truePrice: trueLogits.get(id) ?? 0,
        share: shares.get(id) ?? 1 / agentIds.length,
        ageMinutes: minute - agent.joinMinute,
      });
    }
    return markets;
  }

  private runOrderFlow(
    minute: number,
    markets: MarketState[],
    marksByMarket: Map<string, number>,
    regime: ResolvedRegime,
    riskProfile: RiskActionProfile,
  ): OrderFlowStats {
    const traderIds = this.clearinghouse.getTraderIds();
    const baseFeeRate = this.config.clearinghouse.feeBps / 10_000;
    const stats: OrderFlowStats = {
      totalOrders: 0,
      informedOrders: 0,
      attackOrders: 0,
    };

    for (const market of markets) {
      const expectedMove = market.truePrice - market.indexPrice;
      const toxicity = clamp(Math.abs(expectedMove), 0, 3);
      const profileForMarket = this.resolveMarketRiskProfile(
        riskProfile,
        toxicity,
      );
      const feeSurchargeRate =
        Math.max(0, profileForMarket.feeSurchargeBps) / 10_000;
      const protectiveMode =
        (this.latestRiskSnapshot !== null &&
          this.latestRiskSnapshot.state !== "NORMAL") ||
        profileForMarket.spreadMultiplier > 1.05 ||
        profileForMarket.marketOrderLimitMultiplier < 0.99 ||
        profileForMarket.marketNotionalLimitMultiplier < 0.99 ||
        profileForMarket.marketImbalanceLimitMultiplier < 0.99 ||
        regime.oracleLagMinutes > 0;
      const oracleLag = Math.max(0, regime.oracleLagMinutes);
      const lagSpreadMultiplier = 1 + oracleLag * 0.12;
      let halfSpread =
        this.config.clearinghouse.baseHalfSpread *
        regime.halfSpreadMultiplier *
        (1 + toxicity * this.config.clearinghouse.toxicitySpreadMultiplier) *
        Math.max(1, profileForMarket.spreadMultiplier) *
        lagSpreadMultiplier;
      const depth =
        ((this.config.clearinghouse.baseDepth * regime.depthMultiplier) /
          (1 + toxicity * this.config.clearinghouse.toxicityDepthMultiplier)) *
        clamp(profileForMarket.depthMultiplier, 0.05, 1);
      const orders = this.rng.poissonApprox(
        this.config.clearinghouse.orderFlowPerMinute *
          regime.orderFlowMultiplier *
          (1 + toxicity * 0.4),
      );

      let maxLeverage = Math.max(
        1,
        this.maxLeverageForAge(market.ageMinutes) *
          regime.leverageMultiplier *
          clamp(profileForMarket.leverageMultiplier, 0.1, 1),
      );
      let marketOiCap =
        this.marketOiCapForShare(market.share, market.ageMinutes) *
        regime.oiCapMultiplier *
        clamp(profileForMarket.oiCapMultiplier, 0.1, 1);
      let marketOrderLimitPerMinute =
        this.config.clearinghouse.marketOrderLimitPerMinute *
        clamp(profileForMarket.marketOrderLimitMultiplier, 0.05, 1);
      let marketNotionalLimitPerMinute =
        this.config.clearinghouse.marketNotionalLimitPerMinute *
        clamp(profileForMarket.marketNotionalLimitMultiplier, 0.05, 1);
      let marketNetImbalanceLimitPerMinute =
        this.config.clearinghouse.marketNetImbalanceLimitPerMinute *
        clamp(profileForMarket.marketImbalanceLimitMultiplier, 0.05, 1);
      const lagTightener = 1 / (1 + oracleLag * 0.18);
      if (lagTightener < 1) {
        maxLeverage = Math.max(1, maxLeverage * lagTightener);
        marketOiCap = Math.max(1, marketOiCap * lagTightener);
        marketOrderLimitPerMinute = Math.max(
          1,
          marketOrderLimitPerMinute * lagTightener,
        );
        marketNotionalLimitPerMinute = Math.max(
          1,
          marketNotionalLimitPerMinute * lagTightener,
        );
        marketNetImbalanceLimitPerMinute = Math.max(
          1,
          marketNetImbalanceLimitPerMinute * lagTightener,
        );
      }
      const informedShare =
        regime.informedFlowShareOverride === null
          ? this.config.clearinghouse.informedFlowShare
          : regime.informedFlowShareOverride;
      const toxicityFeeRate = (Math.max(0, toxicity - 0.25) * 2.2) / 10_000;
      const lagFeeRate = (oracleLag * 0.8) / 10_000;
      const feeRate =
        baseFeeRate + feeSurchargeRate + toxicityFeeRate + lagFeeRate;

      for (let i = 0; i < orders; i++) {
        const informed = this.rng.bool(clamp(informedShare, 0, 1));
        stats.totalOrders++;
        if (informed) {
          stats.informedOrders++;
        }
        let side: 1 | -1 = this.rng.bool(0.5) ? 1 : -1;
        if (informed) {
          const signal =
            expectedMove +
            this.rng.normal(
              0,
              this.config.clearinghouse.signalNoise *
                regime.signalNoiseMultiplier,
            );
          if (signal !== 0) {
            side = signal > 0 ? 1 : -1;
          }
        }

        const quantity = this.rng.logNormal(
          this.config.clearinghouse.orderSizeLogMean,
          this.config.clearinghouse.orderSizeLogStd,
        );
        const traderId = traderIds[this.rng.int(0, traderIds.length)];
        this.clearinghouse.executeOrder(traderId, side, quantity, {
          minute,
          marketId: market.id,
          markPrice: market.indexPrice,
          marksByMarket,
          halfSpread: Math.max(0, halfSpread),
          depth: Math.max(1, depth),
          impactSlope:
            this.config.clearinghouse.impactSlope * regime.impactMultiplier,
          feeRate,
          maxLeverage,
          marketOiCap,
          marketOrderLimitPerMinute,
          marketNotionalLimitPerMinute,
          marketNetImbalanceLimitPerMinute,
        });
      }

      if (regime.mevAttackIntensity > 0) {
        const mmRisk = this.clearinghouse.getMmRiskState();
        const insuranceCoverage = this.clearinghouse.insuranceCoverageRatio();
        const riskState: RiskState =
          this.latestRiskSnapshot?.state ??
          (protectiveMode ? "TOXIC" : "NORMAL");
        const stateFlowClamp =
          riskState === "STRESS" ? 0.35 : riskState === "TOXIC" ? 0.65 : 1;
        const drawdownFlowClamp = clamp(1 - mmRisk.drawdownRatio * 8, 0.2, 1);
        const coverageFlowClamp = clamp(insuranceCoverage, 0.2, 1);
        const lagFlowClamp = 1 / (1 + oracleLag * 0.12);
        const attackFlow =
          regime.mevAttackIntensity *
          clamp(profileForMarket.attackFlowMultiplier, 0.05, 1) *
          stateFlowClamp *
          drawdownFlowClamp *
          coverageFlowClamp *
          lagFlowClamp;
        const attackOrders = this.rng.poissonApprox(
          attackFlow *
            (1 + toxicity * 0.8) *
            this.config.clearinghouse.orderFlowPerMinute,
        );
        const attackFeeRate =
          feeRate +
          Math.max(0, profileForMarket.attackFeeSurchargeBps) / 10_000;
        const attackHalfSpread = protectiveMode
          ? Math.max(
              halfSpread,
              halfSpread * (1.2 + (1 - stateFlowClamp) * 0.8),
            )
          : halfSpread * 0.6;
        const attackDepth = protectiveMode
          ? Math.max(10, depth * (0.25 + stateFlowClamp * 0.2))
          : Math.max(20, depth * 0.5);
        const attackLeverage = protectiveMode
          ? Math.max(
              1,
              maxLeverage *
                (0.45 + stateFlowClamp * 0.35) *
                clamp(coverageFlowClamp, 0.35, 1),
            )
          : maxLeverage * 1.2;
        const attackPoolSize = Math.max(
          1,
          Math.floor(
            traderIds.length * clamp(regime.attackSybilShare, 0.01, 1),
          ),
        );
        const attackOffset = minute % traderIds.length;
        for (let i = 0; i < attackOrders; i++) {
          stats.totalOrders++;
          stats.informedOrders++;
          stats.attackOrders++;
          const signal = expectedMove + this.rng.normal(0, 0.01);
          const side: 1 | -1 = signal >= 0 ? 1 : -1;
          const quantity =
            this.rng.logNormal(
              this.config.clearinghouse.orderSizeLogMean,
              this.config.clearinghouse.orderSizeLogStd,
            ) * regime.attackSizeMultiplier;
          const traderId =
            traderIds[
              (attackOffset + this.rng.int(0, attackPoolSize)) %
                traderIds.length
            ];
          this.clearinghouse.executeOrder(traderId, side, quantity, {
            minute,
            marketId: market.id,
            markPrice: market.indexPrice,
            marksByMarket,
            halfSpread: attackHalfSpread,
            depth: attackDepth,
            impactSlope:
              this.config.clearinghouse.impactSlope *
              regime.impactMultiplier *
              1.2,
            feeRate: attackFeeRate,
            maxLeverage: attackLeverage,
            marketOiCap,
            marketOrderLimitPerMinute,
            marketNotionalLimitPerMinute,
            marketNetImbalanceLimitPerMinute,
          });
        }
      }
    }
    return stats;
  }

  private updateRiskGovernor(
    minute: number,
    markets: MarketState[],
  ): RiskGovernorSnapshot {
    let weightedToxicity = 0;
    let totalShare = 0;
    let maxToxicity = 0;
    for (const market of markets) {
      const move = Math.abs(market.truePrice - market.indexPrice);
      weightedToxicity += move * Math.max(0, market.share);
      totalShare += Math.max(0, market.share);
      if (move > maxToxicity) {
        maxToxicity = move;
      }
    }
    const avgToxicity =
      totalShare > 0 ? weightedToxicity / totalShare : maxToxicity;
    const toxicitySignal = Math.max(avgToxicity * 1.25, maxToxicity * 0.85);
    const mmRisk = this.clearinghouse.getMmRiskState();

    return this.riskGovernor.evaluate({
      minute,
      toxicity: toxicitySignal,
      mmDrawdownRatio: mmRisk.drawdownRatio,
      insuranceCoverageRatio: this.clearinghouse.insuranceCoverageRatio(),
      informedFlowShare: this.lastObservedInformedFlowShare,
    });
  }

  private resolveMarketRiskProfile(
    globalProfile: RiskActionProfile,
    toxicity: number,
  ): RiskActionProfile {
    const governor = this.config.clearinghouse.riskGovernor;
    if (!governor.enabled) {
      return globalProfile;
    }

    let profile = globalProfile;
    if (toxicity >= governor.thresholds.toxicityEnter) {
      profile = this.mergeRiskProfiles(profile, governor.profiles.TOXIC);
    }
    if (toxicity >= governor.thresholds.toxicityEnter * 1.8) {
      profile = this.mergeRiskProfiles(profile, governor.profiles.STRESS);
    }
    return profile;
  }

  private mergeRiskProfiles(
    left: RiskActionProfile,
    right: RiskActionProfile,
  ): RiskActionProfile {
    return {
      spreadMultiplier: Math.max(left.spreadMultiplier, right.spreadMultiplier),
      depthMultiplier: Math.min(left.depthMultiplier, right.depthMultiplier),
      leverageMultiplier: Math.min(
        left.leverageMultiplier,
        right.leverageMultiplier,
      ),
      oiCapMultiplier: Math.min(left.oiCapMultiplier, right.oiCapMultiplier),
      marketOrderLimitMultiplier: Math.min(
        left.marketOrderLimitMultiplier,
        right.marketOrderLimitMultiplier,
      ),
      marketNotionalLimitMultiplier: Math.min(
        left.marketNotionalLimitMultiplier,
        right.marketNotionalLimitMultiplier,
      ),
      marketImbalanceLimitMultiplier: Math.min(
        left.marketImbalanceLimitMultiplier,
        right.marketImbalanceLimitMultiplier,
      ),
      feeSurchargeBps: Math.max(left.feeSurchargeBps, right.feeSurchargeBps),
      attackFlowMultiplier: Math.min(
        left.attackFlowMultiplier,
        right.attackFlowMultiplier,
      ),
      attackFeeSurchargeBps: Math.max(
        left.attackFeeSurchargeBps,
        right.attackFeeSurchargeBps,
      ),
      hedgeRateMultiplier: Math.max(
        left.hedgeRateMultiplier,
        right.hedgeRateMultiplier,
      ),
    };
  }

  private captureFlowStats(stats: OrderFlowStats): void {
    if (stats.totalOrders <= 0) {
      return;
    }
    const informedShare = stats.informedOrders / stats.totalOrders;
    const attackShare = stats.attackOrders / stats.totalOrders;
    this.lastObservedInformedFlowShare = informedShare;
    this.flowSampleCount += 1;
    this.informedFlowShareAccumulator += informedShare;
    this.attackOrderShareAccumulator += attackShare;
    if (informedShare > this.maxObservedInformedFlowShare) {
      this.maxObservedInformedFlowShare = informedShare;
    }
    if (attackShare > this.maxObservedAttackOrderShare) {
      this.maxObservedAttackOrderShare = attackShare;
    }
  }

  private buildRiskGovernorSummary(): RiskGovernorSummary {
    const minutes = this.riskGovernor.minutesInState();
    const divisor = Math.max(this.flowSampleCount, 1);
    return {
      finalState: this.riskGovernor.currentState(),
      transitions: this.riskGovernor.transitionCount(),
      minutesNormal: minutes.NORMAL,
      minutesToxic: minutes.TOXIC,
      minutesStress: minutes.STRESS,
      avgObservedInformedFlowShare: this.informedFlowShareAccumulator / divisor,
      maxObservedInformedFlowShare: this.maxObservedInformedFlowShare,
      avgObservedAttackOrderShare: this.attackOrderShareAccumulator / divisor,
      maxObservedAttackOrderShare: this.maxObservedAttackOrderShare,
    };
  }

  private maxLeverageForAge(ageMinutes: number): number {
    if (ageMinutes <= this.config.clearinghouse.listingPhaseMinutes) {
      return this.config.clearinghouse.maxLeverageListing;
    }
    if (ageMinutes >= this.config.clearinghouse.stabilizationMinutes) {
      return this.config.clearinghouse.maxLeverageMature;
    }

    const span =
      this.config.clearinghouse.stabilizationMinutes -
      this.config.clearinghouse.listingPhaseMinutes;
    const progress =
      (ageMinutes - this.config.clearinghouse.listingPhaseMinutes) /
      Math.max(span, 1);
    return (
      this.config.clearinghouse.maxLeverageListing +
      progress *
        (this.config.clearinghouse.maxLeverageMature -
          this.config.clearinghouse.maxLeverageListing)
    );
  }

  private marketOiCapForShare(share: number, ageMinutes: number): number {
    const base =
      this.config.clearinghouse.perMarketOiFloor +
      this.config.clearinghouse.perMarketOiScale * share;
    if (ageMinutes <= this.config.clearinghouse.listingPhaseMinutes) {
      return base * this.config.clearinghouse.listingOiMultiplier;
    }
    if (ageMinutes >= this.config.clearinghouse.stabilizationMinutes) {
      return base;
    }

    const progress =
      (ageMinutes - this.config.clearinghouse.listingPhaseMinutes) /
      Math.max(
        this.config.clearinghouse.stabilizationMinutes -
          this.config.clearinghouse.listingPhaseMinutes,
        1,
      );
    const multiplier =
      this.config.clearinghouse.listingOiMultiplier +
      progress * (1 - this.config.clearinghouse.listingOiMultiplier);
    return base * multiplier;
  }

  private captureEntrantSnapshots(minute: number): void {
    for (const snapshot of this.entrantSnapshots.values()) {
      const agent = this.agents.get(snapshot.id);
      if (!agent) continue;
      const age = minute - snapshot.joinedMinute;
      if (snapshot.winsDay1 === null && age >= 24 * 60) {
        snapshot.winsDay1 = agent.wins;
        snapshot.lossesDay1 = agent.losses;
      }
      if (snapshot.winsDay7 === null && age >= 7 * 24 * 60) {
        snapshot.winsDay7 = agent.wins;
        snapshot.lossesDay7 = agent.losses;
      }
    }
  }

  private buildRankedAgents(): TopAgentSnapshot[] {
    const ids = Array.from(this.agents.keys()).sort();
    const scoreVector = this.buildRatingScoreVector(ids);
    const index = this.indexOracle.publish(scoreVector, ids);
    const snapshots: TopAgentSnapshot[] = [];

    for (const id of ids) {
      const rating = this.ratings.get(id);
      const agent = this.agents.get(id);
      if (!rating || !agent) continue;
      snapshots.push({
        id,
        mu: rating.mu,
        sigma: rating.sigma,
        share: index.shares.get(id) ?? 0,
        wins: agent.wins,
        losses: agent.losses,
      });
    }

    snapshots.sort((a, b) => b.share - a.share);
    return snapshots;
  }

  private buildEntrantOutcomes(
    rankedAgents: TopAgentSnapshot[],
  ): EntrantOutcome[] {
    const rankMap = new Map<string, number>();
    rankedAgents.forEach((agent, index) => {
      rankMap.set(agent.id, index + 1);
    });

    const outcomes: EntrantOutcome[] = [];
    for (const snapshot of this.entrantSnapshots.values()) {
      const agent = this.agents.get(snapshot.id);
      if (!agent) continue;
      const day1Total = (snapshot.winsDay1 ?? 0) + (snapshot.lossesDay1 ?? 0);
      const day7Total = (snapshot.winsDay7 ?? 0) + (snapshot.lossesDay7 ?? 0);
      outcomes.push({
        id: snapshot.id,
        day1WinRate:
          day1Total > 0 ? (snapshot.winsDay1 ?? 0) / day1Total : null,
        day7WinRate:
          day7Total > 0 ? (snapshot.winsDay7 ?? 0) / day7Total : null,
        finalRank: rankMap.get(snapshot.id) ?? rankedAgents.length + 1,
        finalShare:
          rankedAgents.find((agentSnapshot) => agentSnapshot.id === snapshot.id)
            ?.share ?? 0,
      });
    }
    outcomes.sort((a, b) => a.finalRank - b.finalRank);
    return outcomes;
  }
}
