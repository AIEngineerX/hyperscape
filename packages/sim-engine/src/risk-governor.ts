export type RiskState = "NORMAL" | "TOXIC" | "STRESS";

export interface RiskGovernorSignals {
  minute: number;
  toxicity: number;
  mmDrawdownRatio: number;
  insuranceCoverageRatio: number;
  informedFlowShare: number;
}

export interface RiskActionProfile {
  spreadMultiplier: number;
  depthMultiplier: number;
  leverageMultiplier: number;
  oiCapMultiplier: number;
  marketOrderLimitMultiplier: number;
  marketNotionalLimitMultiplier: number;
  marketImbalanceLimitMultiplier: number;
  feeSurchargeBps: number;
  attackFlowMultiplier: number;
  attackFeeSurchargeBps: number;
  hedgeRateMultiplier: number;
}

export interface RiskGovernorThresholds {
  toxicityEnter: number;
  toxicityExit: number;
  informedFlowEnter: number;
  informedFlowExit: number;
  stressDrawdownEnter: number;
  stressDrawdownExit: number;
  stressCoverageEnter: number;
  stressCoverageExit: number;
}

export interface RiskGovernorConfig {
  enabled: boolean;
  minStateDurationMinutes: number;
  thresholds: RiskGovernorThresholds;
  profiles: Record<RiskState, RiskActionProfile>;
}

export interface RiskGovernorSnapshot {
  minute: number;
  previousState: RiskState;
  state: RiskState;
  changed: boolean;
  transitions: number;
  latchedToxic: boolean;
  latchedStress: boolean;
  stateMinutes: Record<RiskState, number>;
  signals: RiskGovernorSignals;
  profile: RiskActionProfile;
}

export interface RiskGovernorPolicyDocument {
  name: string;
  version: string;
  enabled: boolean;
  minStateDurationMinutes: number;
  thresholds: RiskGovernorThresholds;
  profiles: Record<RiskState, RiskActionProfile>;
}

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const cloneProfile = (profile: RiskActionProfile): RiskActionProfile => ({
  spreadMultiplier: profile.spreadMultiplier,
  depthMultiplier: profile.depthMultiplier,
  leverageMultiplier: profile.leverageMultiplier,
  oiCapMultiplier: profile.oiCapMultiplier,
  marketOrderLimitMultiplier: profile.marketOrderLimitMultiplier,
  marketNotionalLimitMultiplier: profile.marketNotionalLimitMultiplier,
  marketImbalanceLimitMultiplier: profile.marketImbalanceLimitMultiplier,
  feeSurchargeBps: profile.feeSurchargeBps,
  attackFlowMultiplier: profile.attackFlowMultiplier,
  attackFeeSurchargeBps: profile.attackFeeSurchargeBps,
  hedgeRateMultiplier: profile.hedgeRateMultiplier,
});

const cloneConfig = (config: RiskGovernorConfig): RiskGovernorConfig => ({
  enabled: config.enabled,
  minStateDurationMinutes: Math.max(0, config.minStateDurationMinutes),
  thresholds: { ...config.thresholds },
  profiles: {
    NORMAL: cloneProfile(config.profiles.NORMAL),
    TOXIC: cloneProfile(config.profiles.TOXIC),
    STRESS: cloneProfile(config.profiles.STRESS),
  },
});

const stateRank = (state: RiskState): number => {
  if (state === "NORMAL") return 0;
  if (state === "TOXIC") return 1;
  return 2;
};

const sanitizeSignals = (
  signals: RiskGovernorSignals,
): RiskGovernorSignals => ({
  minute: Math.max(0, Math.floor(signals.minute)),
  toxicity: Math.max(0, signals.toxicity),
  mmDrawdownRatio: clamp(signals.mmDrawdownRatio, 0, 100),
  insuranceCoverageRatio: Math.max(0, signals.insuranceCoverageRatio),
  informedFlowShare: clamp(signals.informedFlowShare, 0, 1),
});

const defaultProfile: RiskActionProfile = {
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
};

export class RiskGovernor {
  private readonly config: RiskGovernorConfig;
  private state: RiskState = "NORMAL";
  private lastTransitionMinute = 0;
  private transitions = 0;
  private toxicLatched = false;
  private stressLatched = false;
  private minutesByState: Record<RiskState, number> = {
    NORMAL: 0,
    TOXIC: 0,
    STRESS: 0,
  };

  constructor(config: RiskGovernorConfig) {
    this.config = cloneConfig(config);
  }

  reset(minute = 0): void {
    this.state = "NORMAL";
    this.lastTransitionMinute = Math.max(0, Math.floor(minute));
    this.transitions = 0;
    this.toxicLatched = false;
    this.stressLatched = false;
    this.minutesByState = {
      NORMAL: 0,
      TOXIC: 0,
      STRESS: 0,
    };
  }

  currentState(): RiskState {
    return this.state;
  }

  transitionCount(): number {
    return this.transitions;
  }

  minutesInState(): Record<RiskState, number> {
    return { ...this.minutesByState };
  }

  evaluate(rawSignals: RiskGovernorSignals): RiskGovernorSnapshot {
    const signals = sanitizeSignals(rawSignals);
    const previousState = this.state;

    if (!this.config.enabled) {
      this.minutesByState[this.state] += 1;
      return {
        minute: signals.minute,
        previousState,
        state: this.state,
        changed: false,
        transitions: this.transitions,
        latchedToxic: false,
        latchedStress: false,
        stateMinutes: this.minutesInState(),
        signals,
        profile: cloneProfile(defaultProfile),
      };
    }

    this.updateLatches(signals);
    const desiredState = this.stressLatched
      ? "STRESS"
      : this.toxicLatched
        ? "TOXIC"
        : "NORMAL";
    const elapsedSinceTransition = signals.minute - this.lastTransitionMinute;
    const minDurationSatisfied =
      elapsedSinceTransition >= this.config.minStateDurationMinutes;
    const escalation = stateRank(desiredState) > stateRank(this.state);
    const canTransition = escalation || minDurationSatisfied;

    let changed = false;
    if (desiredState !== this.state && canTransition) {
      this.state = desiredState;
      this.lastTransitionMinute = signals.minute;
      this.transitions += 1;
      changed = true;
    }

    this.minutesByState[this.state] += 1;
    return {
      minute: signals.minute,
      previousState,
      state: this.state,
      changed,
      transitions: this.transitions,
      latchedToxic: this.toxicLatched,
      latchedStress: this.stressLatched,
      stateMinutes: this.minutesInState(),
      signals,
      profile: cloneProfile(this.config.profiles[this.state] ?? defaultProfile),
    };
  }

  private updateLatches(signals: RiskGovernorSignals): void {
    const t = this.config.thresholds;

    if (this.toxicLatched) {
      const clearToxic =
        signals.toxicity <= t.toxicityExit &&
        signals.informedFlowShare <= t.informedFlowExit;
      if (clearToxic) {
        this.toxicLatched = false;
      }
    } else {
      const triggerToxic =
        signals.toxicity >= t.toxicityEnter ||
        signals.informedFlowShare >= t.informedFlowEnter;
      if (triggerToxic) {
        this.toxicLatched = true;
      }
    }

    if (this.stressLatched) {
      const clearStress =
        signals.mmDrawdownRatio <= t.stressDrawdownExit &&
        signals.insuranceCoverageRatio >= t.stressCoverageExit;
      if (clearStress) {
        this.stressLatched = false;
      }
    } else {
      const triggerStress =
        signals.mmDrawdownRatio >= t.stressDrawdownEnter ||
        signals.insuranceCoverageRatio <= t.stressCoverageEnter;
      if (triggerStress) {
        this.stressLatched = true;
      }
    }
  }
}

export const buildRiskGovernorPolicy = (
  name: string,
  config: RiskGovernorConfig,
): RiskGovernorPolicyDocument => ({
  name,
  version: "1.0.0",
  enabled: config.enabled,
  minStateDurationMinutes: config.minStateDurationMinutes,
  thresholds: { ...config.thresholds },
  profiles: {
    NORMAL: cloneProfile(config.profiles.NORMAL),
    TOXIC: cloneProfile(config.profiles.TOXIC),
    STRESS: cloneProfile(config.profiles.STRESS),
  },
});

export const riskGovernorPolicyMarkdown = (
  policy: RiskGovernorPolicyDocument,
): string => {
  const rows = (["NORMAL", "TOXIC", "STRESS"] as RiskState[])
    .map((state) => {
      const profile = policy.profiles[state];
      return `| ${state} | ${profile.spreadMultiplier.toFixed(2)} | ${profile.depthMultiplier.toFixed(2)} | ${profile.leverageMultiplier.toFixed(2)} | ${profile.oiCapMultiplier.toFixed(2)} | ${profile.marketOrderLimitMultiplier.toFixed(2)} | ${profile.marketNotionalLimitMultiplier.toFixed(2)} | ${profile.marketImbalanceLimitMultiplier.toFixed(2)} | ${profile.feeSurchargeBps.toFixed(2)} | ${profile.attackFlowMultiplier.toFixed(2)} | ${profile.attackFeeSurchargeBps.toFixed(2)} | ${profile.hedgeRateMultiplier.toFixed(2)} |`;
    })
    .join("\n");

  return [
    `# ${policy.name}`,
    "",
    "## Thresholds",
    "",
    `- enabled: \`${policy.enabled}\``,
    `- minStateDurationMinutes: \`${policy.minStateDurationMinutes}\``,
    `- toxicity enter/exit: \`${policy.thresholds.toxicityEnter}\` / \`${policy.thresholds.toxicityExit}\``,
    `- informed flow enter/exit: \`${policy.thresholds.informedFlowEnter}\` / \`${policy.thresholds.informedFlowExit}\``,
    `- drawdown enter/exit: \`${policy.thresholds.stressDrawdownEnter}\` / \`${policy.thresholds.stressDrawdownExit}\``,
    `- insurance coverage enter/exit: \`${policy.thresholds.stressCoverageEnter}\` / \`${policy.thresholds.stressCoverageExit}\``,
    "",
    "## State Profiles",
    "",
    "| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    rows,
    "",
  ].join("\n");
};
