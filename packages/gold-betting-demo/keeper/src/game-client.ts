export class GameClient {
  private url: string;
  private pollInterval: any = null;
  private onDuelStartCb: ((data: any) => void) | null = null;
  private onDuelEndCb: ((data: any) => void) | null = null;

  private lastCycleId: string | null = null;
  private lastPhase: string | null = null;

  constructor(url: string) {
    this.url = url.replace(/\/$/, "");
  }

  public connect() {
    console.log(`[GameClient] Connected via HTTP polling to ${this.url}`);
    this.pollInterval = setInterval(() => this.poll(), 2000);
    this.poll();
  }

  private async poll() {
    try {
      const res = await fetch(`${this.url}/api/streaming/state`);
      if (!res.ok) return;
      const data = (await res.json()) as any;

      if (data?.type !== "STREAMING_STATE_UPDATE" || !data.cycle) return;

      const cycle = data.cycle;
      const currentCycleId = cycle.cycleId;
      const currentPhase = cycle.phase;

      let numericMatchId = 0;
      for (let i = 0; i < currentCycleId.length; i++) {
        numericMatchId =
          (numericMatchId * 31 + currentCycleId.charCodeAt(i)) >>> 0;
      }
      numericMatchId = Math.abs(numericMatchId) || 1;

      if (currentCycleId !== this.lastCycleId) {
        this.lastCycleId = currentCycleId;
        this.lastPhase = currentPhase;

        if (this.onDuelStartCb) {
          this.onDuelStartCb({
            duelId: numericMatchId,
            agent1: cycle.agent1,
            agent2: cycle.agent2,
          });
        }
      } else if (
        this.lastPhase !== "RESOLUTION" &&
        currentPhase === "RESOLUTION"
      ) {
        this.lastPhase = currentPhase;
        if (this.onDuelEndCb) {
          this.onDuelEndCb({
            duelId: numericMatchId,
            winnerId: cycle.winnerId,
            agent1: cycle.agent1,
          });
        }
      }
    } catch (err) {
      // Ignore network errors
    }
  }

  public onDuelStart(callback: (data: any) => void) {
    this.onDuelStartCb = callback;
  }

  public onDuelEnd(callback: (data: any) => void) {
    this.onDuelEndCb = callback;
  }

  public disconnect() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }
}
