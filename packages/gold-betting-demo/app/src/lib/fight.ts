export type Fighter = "A" | "B";

export type SwingEvent = {
  round: number;
  attacker: Fighter;
  defender: Fighter;
  hit: boolean;
  damage: number;
  attackerHp: number;
  defenderHp: number;
};

export type FightResult = {
  seed: bigint;
  winner: Fighter;
  events: SwingEvent[];
  replayHash: Uint8Array;
};

function seededRandom(seed: bigint): () => number {
  let state = seed;
  return () => {
    state ^= state << 13n;
    state ^= state >> 7n;
    state ^= state << 17n;
    const out = Number(state & 0xffff_ffffn);
    return Math.abs(out) / 0xffff_ffff;
  };
}

function toReplayHash(events: SwingEvent[]): Uint8Array {
  const raw = new TextEncoder().encode(JSON.stringify(events));
  const out = new Uint8Array(32);
  for (let i = 0; i < raw.length; i += 1) {
    out[i % 32] = out[i % 32] ^ raw[i];
  }
  return out;
}

export function simulateFight(seed: bigint): FightResult {
  const rand = seededRandom(seed);

  let hpA = 10;
  let hpB = 10;
  let round = 0;
  const events: SwingEvent[] = [];

  while (hpA > 0 && hpB > 0 && round < 128) {
    round += 1;

    for (const [attacker, defender] of [
      ["A", "B"],
      ["B", "A"],
    ] as const) {
      if (hpA <= 0 || hpB <= 0) break;

      const hit = rand() > 0.35;
      const damage = hit ? (rand() > 0.8 ? 2 : 1) : 0;

      if (defender === "A") hpA = Math.max(0, hpA - damage);
      if (defender === "B") hpB = Math.max(0, hpB - damage);

      events.push({
        round,
        attacker,
        defender,
        hit,
        damage,
        attackerHp: attacker === "A" ? hpA : hpB,
        defenderHp: defender === "A" ? hpA : hpB,
      });
    }
  }

  const winner: Fighter = hpA > 0 ? "A" : "B";

  return {
    seed,
    winner,
    events,
    replayHash: toReplayHash(events),
  };
}
