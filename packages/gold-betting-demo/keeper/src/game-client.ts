export class GameClient {
  private url: string;
  private pollInterval: any = null;
  private onDuelStartCb: ((data: any) => void) | null = null;
  private onDuelEndCb: ((data: any) => void) | null = null;
  private pollInFlight = false;
  private readonly pollTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private pollBackoffUntil = 0;
  private consecutivePollFailures = 0;

  private lastCycleId: string | null = null;
  private lastPhase: string | null = null;

  constructor(url: string) {
    this.url = url.replace(/\/$/, "");
    const configuredTimeout = Number(process.env.GAME_STATE_POLL_TIMEOUT_MS);
    this.pollTimeoutMs =
      Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 1500;
    const configuredInterval = Number(process.env.GAME_STATE_POLL_INTERVAL_MS);
    this.pollIntervalMs =
      Number.isFinite(configuredInterval) && configuredInterval >= 1_000
        ? configuredInterval
        : 2_000;
  }

  public connect() {
    console.log(
      `[GameClient] Connected via HTTP polling to ${this.url} (interval=${this.pollIntervalMs}ms timeout=${this.pollTimeoutMs}ms)`,
    );
    this.pollInterval = setInterval(() => this.poll(), this.pollIntervalMs);
    this.poll();
  }

  private registerPollFailure(reason: string) {
    this.consecutivePollFailures += 1;
    const backoffStep = Math.min(this.consecutivePollFailures, 5);
    const backoffMs = Math.min(30_000, this.pollIntervalMs * 2 ** backoffStep);
    this.pollBackoffUntil = Date.now() + backoffMs;

    if (
      this.consecutivePollFailures === 1 ||
      this.consecutivePollFailures % 10 === 0
    ) {
      console.warn(
        `[GameClient] streaming poll failed (${reason}); backing off ${backoffMs}ms (consecutive=${this.consecutivePollFailures})`,
      );
    }
  }

  private resetPollFailures() {
    this.consecutivePollFailures = 0;
    this.pollBackoffUntil = 0;
  }

  private async poll() {
    if (Date.now() < this.pollBackoffUntil) {
      return;
    }

    if (this.pollInFlight) {
      return;
    }
    this.pollInFlight = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.pollTimeoutMs);

    try {
      const res = await fetch(`${this.url}/api/streaming/state`, {
        cache: "no-store",
        headers: {
          connection: "close",
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // Ignore cancellation issues when the transport is already closed.
        }
        this.registerPollFailure(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as any;
      this.resetPollFailures();

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
      const message =
        err instanceof Error
          ? err.name === "AbortError"
            ? `timeout after ${this.pollTimeoutMs}ms`
            : err.message
          : "request failed";
      this.registerPollFailure(message);
    } finally {
      clearTimeout(timeoutId);
      this.pollInFlight = false;
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
