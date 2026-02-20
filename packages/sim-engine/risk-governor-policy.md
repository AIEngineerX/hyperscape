# baseline-convergence

## Thresholds

- enabled: `false`
- minStateDurationMinutes: `20`
- toxicity enter/exit: `0.45` / `0.3`
- informed flow enter/exit: `0.68` / `0.54`
- drawdown enter/exit: `0.18` / `0.12`
- insurance coverage enter/exit: `0.55` / `0.75`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.35 | 0.80 | 0.80 | 0.85 | 0.80 | 0.80 | 0.75 | 2.00 | 0.85 | 4.00 | 1.30 |
| STRESS | 1.75 | 0.60 | 0.65 | 0.72 | 0.55 | 0.55 | 0.45 | 6.00 | 0.55 | 8.00 | 2.20 |

# thin-liquidity-12bps

## Thresholds

- enabled: `false`
- minStateDurationMinutes: `20`
- toxicity enter/exit: `0.45` / `0.3`
- informed flow enter/exit: `0.68` / `0.54`
- drawdown enter/exit: `0.18` / `0.12`
- insurance coverage enter/exit: `0.55` / `0.75`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.35 | 0.80 | 0.80 | 0.85 | 0.80 | 0.80 | 0.75 | 2.00 | 0.85 | 4.00 | 1.30 |
| STRESS | 1.75 | 0.60 | 0.65 | 0.72 | 0.55 | 0.55 | 0.45 | 6.00 | 0.55 | 8.00 | 2.20 |

# mev-bot-attack

## Thresholds

- enabled: `false`
- minStateDurationMinutes: `20`
- toxicity enter/exit: `0.45` / `0.3`
- informed flow enter/exit: `0.68` / `0.54`
- drawdown enter/exit: `0.18` / `0.12`
- insurance coverage enter/exit: `0.55` / `0.75`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.35 | 0.80 | 0.80 | 0.85 | 0.80 | 0.80 | 0.75 | 2.00 | 0.85 | 4.00 | 1.30 |
| STRESS | 1.75 | 0.60 | 0.65 | 0.72 | 0.55 | 0.55 | 0.45 | 6.00 | 0.55 | 8.00 | 2.20 |

# mev-bot-attack-guarded

## Thresholds

- enabled: `true`
- minStateDurationMinutes: `10`
- toxicity enter/exit: `0.3` / `0.22`
- informed flow enter/exit: `0.72` / `0.58`
- drawdown enter/exit: `0.12` / `0.08`
- insurance coverage enter/exit: `0.72` / `0.85`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.80 | 0.60 | 0.65 | 0.70 | 0.60 | 0.60 | 0.45 | 8.00 | 0.65 | 10.00 | 1.80 |
| STRESS | 2.40 | 0.45 | 0.45 | 0.55 | 0.35 | 0.35 | 0.25 | 12.00 | 0.45 | 15.00 | 3.40 |

# mev-bot-attack-hardened

## Thresholds

- enabled: `true`
- minStateDurationMinutes: `10`
- toxicity enter/exit: `0.3` / `0.22`
- informed flow enter/exit: `0.72` / `0.58`
- drawdown enter/exit: `0.12` / `0.08`
- insurance coverage enter/exit: `0.72` / `0.85`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.80 | 0.60 | 0.65 | 0.70 | 0.60 | 0.60 | 0.45 | 8.00 | 0.65 | 10.00 | 1.80 |
| STRESS | 2.40 | 0.45 | 0.45 | 0.55 | 0.35 | 0.35 | 0.25 | 12.00 | 0.45 | 15.00 | 3.40 |

# mev-oracle-lag-attack

## Thresholds

- enabled: `true`
- minStateDurationMinutes: `10`
- toxicity enter/exit: `0.3` / `0.22`
- informed flow enter/exit: `0.72` / `0.58`
- drawdown enter/exit: `0.12` / `0.08`
- insurance coverage enter/exit: `0.72` / `0.85`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.80 | 0.60 | 0.65 | 0.70 | 0.60 | 0.60 | 0.45 | 8.00 | 0.65 | 10.00 | 1.80 |
| STRESS | 2.40 | 0.45 | 0.45 | 0.55 | 0.35 | 0.35 | 0.25 | 12.00 | 0.45 | 15.00 | 3.40 |

# mev-oracle-lag-hardened

## Thresholds

- enabled: `true`
- minStateDurationMinutes: `10`
- toxicity enter/exit: `0.3` / `0.22`
- informed flow enter/exit: `0.72` / `0.58`
- drawdown enter/exit: `0.12` / `0.08`
- insurance coverage enter/exit: `0.72` / `0.85`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.80 | 0.60 | 0.65 | 0.70 | 0.60 | 0.60 | 0.45 | 8.00 | 0.65 | 10.00 | 1.80 |
| STRESS | 2.40 | 0.45 | 0.45 | 0.55 | 0.35 | 0.35 | 0.25 | 12.00 | 0.45 | 15.00 | 3.40 |

# sybil-swarm-attack

## Thresholds

- enabled: `true`
- minStateDurationMinutes: `10`
- toxicity enter/exit: `0.3` / `0.22`
- informed flow enter/exit: `0.72` / `0.58`
- drawdown enter/exit: `0.12` / `0.08`
- insurance coverage enter/exit: `0.72` / `0.85`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.80 | 0.60 | 0.65 | 0.70 | 0.60 | 0.60 | 0.45 | 8.00 | 0.65 | 10.00 | 1.80 |
| STRESS | 2.40 | 0.45 | 0.45 | 0.55 | 0.35 | 0.35 | 0.25 | 12.00 | 0.45 | 15.00 | 3.40 |

# sybil-swarm-hardened

## Thresholds

- enabled: `true`
- minStateDurationMinutes: `10`
- toxicity enter/exit: `0.3` / `0.22`
- informed flow enter/exit: `0.72` / `0.58`
- drawdown enter/exit: `0.12` / `0.08`
- insurance coverage enter/exit: `0.72` / `0.85`

## State Profiles

| state | spread_x | depth_x | leverage_x | oi_cap_x | mkt_order_cap_x | mkt_notional_cap_x | mkt_imbalance_cap_x | fee_bps | attack_flow_x | attack_fee_bps | hedge_rate_x |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| NORMAL | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 0.00 | 1.00 | 0.00 | 1.00 |
| TOXIC | 1.80 | 0.60 | 0.65 | 0.70 | 0.60 | 0.60 | 0.45 | 8.00 | 0.65 | 10.00 | 1.80 |
| STRESS | 2.40 | 0.45 | 0.45 | 0.55 | 0.35 | 0.35 | 0.25 | 12.00 | 0.45 | 15.00 | 3.40 |
