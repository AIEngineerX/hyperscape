import { describe, expect, it } from "vitest";
import { RiskGovernor, type RiskGovernorConfig } from "./risk-governor";

const config: RiskGovernorConfig = {
  enabled: true,
  minStateDurationMinutes: 5,
  thresholds: {
    toxicityEnter: 0.5,
    toxicityExit: 0.3,
    informedFlowEnter: 0.7,
    informedFlowExit: 0.55,
    stressDrawdownEnter: 0.2,
    stressDrawdownExit: 0.1,
    stressCoverageEnter: 0.6,
    stressCoverageExit: 0.8,
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
      spreadMultiplier: 1.5,
      depthMultiplier: 0.8,
      leverageMultiplier: 0.8,
      oiCapMultiplier: 0.8,
      marketOrderLimitMultiplier: 0.8,
      marketNotionalLimitMultiplier: 0.8,
      marketImbalanceLimitMultiplier: 0.8,
      feeSurchargeBps: 4,
      attackFlowMultiplier: 0.8,
      attackFeeSurchargeBps: 6,
      hedgeRateMultiplier: 1.4,
    },
    STRESS: {
      spreadMultiplier: 2.1,
      depthMultiplier: 0.6,
      leverageMultiplier: 0.6,
      oiCapMultiplier: 0.6,
      marketOrderLimitMultiplier: 0.6,
      marketNotionalLimitMultiplier: 0.6,
      marketImbalanceLimitMultiplier: 0.6,
      feeSurchargeBps: 8,
      attackFlowMultiplier: 0.5,
      attackFeeSurchargeBps: 12,
      hedgeRateMultiplier: 2.2,
    },
  },
};

describe("RiskGovernor", () => {
  it("escalates immediately and de-escalates with minimum state duration", () => {
    const governor = new RiskGovernor(config);

    const normal = governor.evaluate({
      minute: 0,
      toxicity: 0.1,
      mmDrawdownRatio: 0,
      insuranceCoverageRatio: 1,
      informedFlowShare: 0.2,
    });
    expect(normal.state).toBe("NORMAL");

    const toxic = governor.evaluate({
      minute: 1,
      toxicity: 0.8,
      mmDrawdownRatio: 0,
      insuranceCoverageRatio: 1,
      informedFlowShare: 0.2,
    });
    expect(toxic.state).toBe("TOXIC");

    const stress = governor.evaluate({
      minute: 2,
      toxicity: 0.8,
      mmDrawdownRatio: 0.25,
      insuranceCoverageRatio: 0.55,
      informedFlowShare: 0.8,
    });
    expect(stress.state).toBe("STRESS");

    const tooSoon = governor.evaluate({
      minute: 4,
      toxicity: 0.1,
      mmDrawdownRatio: 0.01,
      insuranceCoverageRatio: 1,
      informedFlowShare: 0.2,
    });
    expect(tooSoon.state).toBe("STRESS");

    const deescalated = governor.evaluate({
      minute: 8,
      toxicity: 0.1,
      mmDrawdownRatio: 0.01,
      insuranceCoverageRatio: 1,
      informedFlowShare: 0.2,
    });
    expect(deescalated.state).toBe("NORMAL");
  });

  it("can escalate from toxic to stress before minimum duration is met", () => {
    const governor = new RiskGovernor(config);
    governor.evaluate({
      minute: 0,
      toxicity: 0.6,
      mmDrawdownRatio: 0.02,
      insuranceCoverageRatio: 1,
      informedFlowShare: 0.2,
    });
    const stress = governor.evaluate({
      minute: 1,
      toxicity: 0.6,
      mmDrawdownRatio: 0.22,
      insuranceCoverageRatio: 0.55,
      informedFlowShare: 0.72,
    });
    expect(stress.state).toBe("STRESS");
    expect(stress.changed).toBe(true);
  });

  it("returns identity behavior when disabled", () => {
    const disabled: RiskGovernorConfig = {
      ...config,
      enabled: false,
    };
    const governor = new RiskGovernor(disabled);
    const snapshot = governor.evaluate({
      minute: 10,
      toxicity: 10,
      mmDrawdownRatio: 10,
      insuranceCoverageRatio: 0,
      informedFlowShare: 1,
    });
    expect(snapshot.state).toBe("NORMAL");
    expect(snapshot.profile.spreadMultiplier).toBe(1);
    expect(snapshot.profile.feeSurchargeBps).toBe(0);
  });
});
