/**
 * DuelBot - Headless bot for automated dueling
 *
 * Extends the LoadTestBot pattern but handles the complete duel flow:
 * - Auto-accept incoming duel challenges
 * - Auto-confirm rules, stakes, and final screens
 * - Auto-attack during duel combat
 * - Emit events for matchmaker coordination
 */

import { createNodeClientWorld } from "../runtime/createNodeClientWorld";
import type { World as ClientWorld } from "../core/World";
import { EventEmitter } from "events";
import { EventType } from "../types/events/event-types";

export type DuelBotConfig = {
  wsUrl: string;
  name: string;
  /** Auto-accept any incoming duel challenge */
  autoAcceptChallenges?: boolean;
  /** Auto-confirm all duel screens (rules, stakes, final) */
  autoConfirmScreens?: boolean;
  /** Connection timeout in ms */
  connectTimeoutMs?: number;
};

export type DuelBotState =
  | "disconnected"
  | "connecting"
  | "idle"
  | "challenged"
  | "in_duel_rules"
  | "in_duel_stakes"
  | "in_duel_confirm"
  | "in_duel_countdown"
  | "in_duel_fighting"
  | "duel_finished";

export type DuelBotMetrics = {
  wins: number;
  losses: number;
  totalDuels: number;
  connectedAt: number;
  lastDuelAt: number;
  isConnected: boolean;
};

type Position = { x: number; y: number; z: number };
type NetworkSender = {
  send: (method: string, data: unknown) => void;
  connected?: boolean;
  id?: string | null;
  on?: (event: string, callback: (data: unknown) => void) => void;
};

export class DuelBot extends EventEmitter {
  private config: Required<DuelBotConfig>;
  private clientWorld: ClientWorld | null = null;
  private connectionVerified = false;
  private isActive = false;
  private attackTimer: ReturnType<typeof setInterval> | null = null;
  private connectionCheckTimer: ReturnType<typeof setInterval> | null = null;
  private challengeTimeout: ReturnType<typeof setTimeout> | null = null;

  state: DuelBotState = "disconnected";
  currentDuelId: string | null = null;
  currentOpponentId: string | null = null;
  pendingChallengeId: string | null = null;

  readonly metrics: DuelBotMetrics = {
    wins: 0,
    losses: 0,
    totalDuels: 0,
    connectedAt: 0,
    lastDuelAt: 0,
    isConnected: false,
  };

  constructor(config: DuelBotConfig) {
    super();
    this.config = {
      autoAcceptChallenges: true,
      autoConfirmScreens: true,
      connectTimeoutMs: 15000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    this.state = "connecting";
    const url = new URL(this.config.wsUrl);
    // Reuse load-test bot auth bypass path so duel bots can connect without
    // requiring user JWT credentials in local/dev environments.
    url.searchParams.set("loadTestBot", "true");
    url.searchParams.set("duelBot", "true");
    url.searchParams.set("botName", this.config.name);

    const clientWorld = createNodeClientWorld();
    await clientWorld.init({
      wsUrl: url.toString(),
      name: this.config.name,
    } as { wsUrl: string; name: string });

    this.clientWorld = clientWorld;
    this.metrics.connectedAt = Date.now();

    // Wait for network connection
    const startWait = Date.now();
    while (Date.now() - startWait < this.config.connectTimeoutMs) {
      if (this.getNetworkSystem()?.connected === true) {
        this.connectionVerified = true;
        this.metrics.isConnected = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    if (!this.connectionVerified) {
      this.state = "disconnected";
      throw new Error(`Connection timeout for ${this.config.name}`);
    }

    // Wait for network ID
    const startIdWait = Date.now();
    while (Date.now() - startIdWait < 5000) {
      if (this.getNetworkSystem()?.id) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Enter world
    this.sendPacket("enterWorld", {
      // Keep server-side enterWorld handling on the load-test bot path so
      // persistence/session logic doesn't require a DB-backed character row.
      loadTestBot: true,
      duelBot: true,
      botName: this.config.name,
    });
    await new Promise((r) => setTimeout(r, 500));

    if (this.getNetworkSystem()?.connected !== true) {
      this.metrics.isConnected = false;
      this.connectionVerified = false;
      this.state = "disconnected";
      throw new Error(`${this.config.name} disconnected after enterWorld`);
    }

    // Wait for player entity
    const startPlayerWait = Date.now();
    while (Date.now() - startPlayerWait < 5000) {
      if (this.getLocalPlayerEntity()) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Mark the spawned player as active/targetable (mirrors browser client flow).
    if (this.getLocalPlayerEntity()) {
      this.sendPacket("clientReady", {});
    }

    this.isActive = true;
    this.state = "idle";
    this.setupPacketListeners();
    this.startConnectionMonitor();

    this.emit("connected", { name: this.config.name, id: this.getId() });
    console.log(
      `[DuelBot] ${this.config.name} connected (id: ${this.getId()})`,
    );
  }

  disconnect(): void {
    this.isActive = false;
    this.connectionVerified = false;
    this.state = "disconnected";
    if (this.attackTimer) clearInterval(this.attackTimer);
    if (this.connectionCheckTimer) clearInterval(this.connectionCheckTimer);
    if (this.challengeTimeout) clearTimeout(this.challengeTimeout);
    this.attackTimer = null;
    this.connectionCheckTimer = null;
    this.challengeTimeout = null;
    if (this.clientWorld) this.clientWorld.destroy();
    this.clientWorld = null;
    this.metrics.isConnected = false;
    this.emit("disconnected", { name: this.config.name });
  }

  getId(): string | null {
    return this.getNetworkSystem()?.id ?? null;
  }

  getPosition(): Position | null {
    const player = this.getLocalPlayerEntity();
    if (!player) return null;

    if (player.node?.position) return player.node.position;
    if (player.position) return player.position as Position;
    if (player.getPosition) return player.getPosition();

    const dataPos = player.data?.position;
    if (Array.isArray(dataPos) && dataPos.length === 3) {
      return { x: dataPos[0], y: dataPos[1], z: dataPos[2] };
    }
    if (dataPos && !Array.isArray(dataPos)) return dataPos as Position;

    return null;
  }

  /** Challenge another player to a duel */
  challengePlayer(targetId: string): void {
    if (this.state !== "idle") {
      console.log(
        `[DuelBot] ${this.config.name} cannot challenge: state=${this.state}`,
      );
      return;
    }
    this.state = "challenged";
    this.startChallengeTimeout();
    console.log(`[DuelBot] ${this.config.name} challenging ${targetId}`);
    this.sendPacket("duel:challenge", { targetPlayerId: targetId });
  }

  /** Move to a position */
  moveTo(x: number, z: number, runMode = false): void {
    this.sendPacket("moveRequest", { target: [x, 0, z], runMode });
  }

  /** Teleport to arena spawn (used by matchmaker) */
  teleportTo(x: number, y: number, z: number): void {
    // Server handles teleport via duel system, but we can request move
    this.sendPacket("moveRequest", { target: [x, y, z], runMode: true });
  }

  private setupPacketListeners(): void {
    const network = this.getNetworkSystem();
    if (!network?.on) {
      console.warn(`[DuelBot] ${this.config.name} - network.on not available`);
      return;
    }

    // Listen for duel packets by subscribing to world events
    const world = this.clientWorld;
    if (!world) return;

    // Modern client networking emits duel lifecycle updates through UI_UPDATE.
    world.on(EventType.UI_UPDATE, (event: unknown) => {
      this.handleUiUpdate(event);
    });

    // Incoming duel challenge
    world.on("duelChallengeIncoming", (data: unknown) => {
      this.handleDuelChallengeIncoming(data);
    });

    // Duel session started (entering rules screen)
    world.on("duelSessionStarted", (data: unknown) => {
      this.handleDuelSessionStarted(data);
    });

    // Duel state changed (rules -> stakes -> confirm)
    world.on("duelStateChanged", (data: unknown) => {
      this.handleDuelStateChanged(data);
    });

    // Duel countdown starting
    world.on("duelCountdownStart", (data: unknown) => {
      this.handleDuelCountdownStart(data);
    });

    // Duel fight starting
    world.on("duelFightStart", (data: unknown) => {
      this.handleDuelFightStart(data);
    });

    world.on("duelFightBegin", (data: unknown) => {
      this.handleDuelFightStart(data);
    });

    // Duel ended
    world.on("duelEnded", (data: unknown) => {
      this.handleDuelEnded(data);
    });

    world.on("duelCompleted", (data: unknown) => {
      this.handleDuelEnded(data);
    });

    // Acceptance state updated
    world.on("duelAcceptanceUpdated", (data: unknown) => {
      this.handleDuelAcceptanceUpdated(data);
    });
  }

  private handleUiUpdate(event: unknown): void {
    const update = event as { component?: string; data?: unknown } | undefined;
    const component = update?.component;
    const data = update?.data;
    if (!component) return;

    switch (component) {
      case "duelChallenge": {
        const challengeData = data as
          | {
              visible?: boolean;
              challengeId?: string;
              fromPlayer?: { id?: string; name?: string };
            }
          | undefined;
        if (
          challengeData?.visible &&
          challengeData.challengeId &&
          challengeData.fromPlayer?.id
        ) {
          this.handleDuelChallengeIncoming({
            challengeId: challengeData.challengeId,
            challengerId: challengeData.fromPlayer.id,
            challengerName:
              challengeData.fromPlayer.name || challengeData.fromPlayer.id,
          });
        } else if (
          challengeData?.visible === false &&
          this.state === "challenged" &&
          !this.currentDuelId
        ) {
          this.clearChallengeTimeout();
          this.state = "idle";
        }
        break;
      }
      case "duel": {
        const duelData = data as
          | {
              duelId?: string;
              opponent?: { id?: string; name?: string };
            }
          | undefined;
        if (duelData?.duelId && duelData.opponent?.id) {
          this.handleDuelSessionStarted({
            duelId: duelData.duelId,
            opponentId: duelData.opponent.id,
            opponentName: duelData.opponent.name || duelData.opponent.id,
          });
        }
        break;
      }
      case "duelStateChange": {
        const stateData = data as
          | {
              duelId?: string;
              state?: string;
            }
          | undefined;
        if (stateData?.duelId && stateData.state) {
          this.handleDuelStateChanged({
            duelId: stateData.duelId,
            newState: stateData.state,
          });
        }
        break;
      }
      case "duelAcceptanceUpdate": {
        const acceptanceData = data as
          | {
              challengerAccepted?: boolean;
              targetAccepted?: boolean;
            }
          | undefined;
        this.handleDuelAcceptanceUpdated({
          myAccepted: Boolean(acceptanceData?.challengerAccepted),
          opponentAccepted: Boolean(acceptanceData?.targetAccepted),
        });
        break;
      }
      case "duelCountdown":
      case "duelCountdownTick":
        this.handleDuelCountdownStart(data);
        break;
      case "duelFightBegin":
      case "duelFightStart":
        this.handleDuelFightStart(data);
        break;
      case "duelEnded":
        this.handleDuelEnded(data);
        break;
      default:
        break;
    }
  }

  private handleDuelChallengeIncoming(data: unknown): void {
    const challenge = data as {
      challengeId: string;
      challengerId: string;
      challengerName: string;
    };

    console.log(
      `[DuelBot] ${this.config.name} received challenge from ${challenge.challengerName}`,
    );

    this.pendingChallengeId = challenge.challengeId;
    this.state = "challenged";
    this.emit("challengeReceived", {
      botName: this.config.name,
      challengerId: challenge.challengerId,
      challengerName: challenge.challengerName,
    });

    if (this.config.autoAcceptChallenges) {
      // Small delay to simulate human reaction
      setTimeout(() => {
        this.acceptChallenge(challenge.challengeId);
      }, 500);
    }
  }

  private acceptChallenge(challengeId: string): void {
    console.log(`[DuelBot] ${this.config.name} accepting challenge`);
    this.sendPacket("duel:challenge:respond", {
      challengeId,
      accept: true,
    });
  }

  private handleDuelSessionStarted(data: unknown): void {
    const session = data as {
      duelId: string;
      opponentId: string;
      opponentName: string;
    };

    console.log(
      `[DuelBot] ${this.config.name} duel session started vs ${session.opponentName}`,
    );

    this.currentDuelId = session.duelId;
    this.currentOpponentId = session.opponentId;
    this.state = "in_duel_rules";
    this.pendingChallengeId = null;
    this.clearChallengeTimeout();

    this.emit("duelStarted", {
      botName: this.config.name,
      duelId: session.duelId,
      opponentId: session.opponentId,
    });

    if (this.config.autoConfirmScreens) {
      // Auto-accept rules after short delay
      setTimeout(() => {
        this.acceptRules();
      }, 1000);
    }
  }

  private handleDuelStateChanged(data: unknown): void {
    const stateChange = data as {
      duelId: string;
      newState: string;
    };

    console.log(
      `[DuelBot] ${this.config.name} duel state: ${stateChange.newState}`,
    );

    switch (stateChange.newState) {
      case "STAKES":
        this.state = "in_duel_stakes";
        if (this.config.autoConfirmScreens) {
          setTimeout(() => this.acceptStakes(), 1000);
        }
        break;
      case "CONFIRMING":
        this.state = "in_duel_confirm";
        if (this.config.autoConfirmScreens) {
          setTimeout(() => this.acceptFinal(), 1000);
        }
        break;
      case "COUNTDOWN":
        this.state = "in_duel_countdown";
        break;
      case "FIGHTING":
        this.state = "in_duel_fighting";
        this.startCombat();
        break;
      case "FINISHED":
        this.state = "duel_finished";
        this.stopCombat();
        break;
    }
  }

  private handleDuelCountdownStart(data: unknown): void {
    console.log(`[DuelBot] ${this.config.name} countdown starting`);
    this.state = "in_duel_countdown";
  }

  private handleDuelFightStart(data: unknown): void {
    console.log(`[DuelBot] ${this.config.name} FIGHT!`);
    this.state = "in_duel_fighting";
    this.startCombat();
  }

  private handleDuelEnded(data: unknown): void {
    const result = data as {
      duelId: string;
      winnerId: string;
      loserId: string;
      winnerName: string;
      loserName: string;
    };

    const myId = this.getId();
    const won = result.winnerId === myId;

    console.log(
      `[DuelBot] ${this.config.name} duel ended - ${won ? "WON!" : "LOST"}`,
    );

    this.metrics.totalDuels++;
    this.metrics.lastDuelAt = Date.now();
    if (won) {
      this.metrics.wins++;
    } else {
      this.metrics.losses++;
    }

    this.state = "idle";
    this.currentDuelId = null;
    this.currentOpponentId = null;
    this.stopCombat();
    this.clearChallengeTimeout();

    this.emit("duelEnded", {
      botName: this.config.name,
      duelId: result.duelId,
      won,
      winnerId: result.winnerId,
      loserId: result.loserId,
    });
  }

  private handleDuelAcceptanceUpdated(data: unknown): void {
    // Server sends acceptance updates - we can use this to know when opponent accepted
    const update = data as {
      myAccepted: boolean;
      opponentAccepted: boolean;
    };
    console.log(
      `[DuelBot] ${this.config.name} acceptance: me=${update.myAccepted}, opponent=${update.opponentAccepted}`,
    );
  }

  private acceptRules(): void {
    console.log(`[DuelBot] ${this.config.name} accepting rules`);
    if (!this.currentDuelId) return;
    this.sendPacket("duel:accept:rules", { duelId: this.currentDuelId });
  }

  private acceptStakes(): void {
    console.log(`[DuelBot] ${this.config.name} accepting stakes (no stakes)`);
    if (!this.currentDuelId) return;
    this.sendPacket("duel:accept:stakes", { duelId: this.currentDuelId });
  }

  private acceptFinal(): void {
    console.log(`[DuelBot] ${this.config.name} final confirmation`);
    if (!this.currentDuelId) return;
    this.sendPacket("duel:accept:final", { duelId: this.currentDuelId });
  }

  private startCombat(): void {
    if (this.attackTimer) return;

    console.log(`[DuelBot] ${this.config.name} starting combat loop`);

    // Attack every 600ms (game tick)
    this.attackTimer = setInterval(() => {
      if (this.state !== "in_duel_fighting" || !this.currentOpponentId) {
        this.stopCombat();
        return;
      }
      this.attack();
    }, 600);

    // Initial attack
    this.attack();
  }

  private stopCombat(): void {
    if (this.attackTimer) {
      clearInterval(this.attackTimer);
      this.attackTimer = null;
    }
  }

  private attack(): void {
    if (!this.currentOpponentId) return;
    this.sendPacket("attackPlayer", {
      targetPlayerId: this.currentOpponentId,
    });
  }

  private startConnectionMonitor(): void {
    this.connectionCheckTimer = setInterval(() => {
      if (!this.isActive) return;
      const connected = this.getNetworkSystem()?.connected === true;
      if (!connected && this.metrics.isConnected) {
        this.metrics.isConnected = false;
        this.state = "disconnected";
        this.emit("disconnected", { name: this.config.name, reason: "lost" });
      }
    }, 2000);
  }

  private startChallengeTimeout(): void {
    this.clearChallengeTimeout();
    this.challengeTimeout = setTimeout(() => {
      if (this.state === "challenged" && !this.currentDuelId) {
        console.log(
          `[DuelBot] ${this.config.name} challenge timed out, returning to idle`,
        );
        this.state = "idle";
        this.pendingChallengeId = null;
      }
    }, 8000);
  }

  private clearChallengeTimeout(): void {
    if (this.challengeTimeout) {
      clearTimeout(this.challengeTimeout);
      this.challengeTimeout = null;
    }
  }

  private sendPacket(method: string, data: unknown): void {
    const network = this.getNetworkSystem();
    if (!network?.send || network.connected === false) {
      console.warn(`[DuelBot] ${this.config.name} cannot send: not connected`);
      return;
    }
    network.send(method, data);
  }

  private getNetworkSystem(): NetworkSender | null {
    if (!this.clientWorld) return null;
    const network = this.clientWorld.getSystem("network");
    return network ? (network as unknown as NetworkSender) : null;
  }

  private getLocalPlayerEntity(): {
    node?: { position?: Position };
    position?: unknown;
    getPosition?: () => Position;
    data?: { position?: Position | [number, number, number] };
  } | null {
    const entities = this.clientWorld?.entities;
    if (!entities) return null;
    if ((entities as { player?: unknown }).player)
      return (entities as { player: unknown }).player as {
        node?: { position?: Position };
        position?: unknown;
        getPosition?: () => Position;
        data?: { position?: Position | [number, number, number] };
      };

    const networkId = this.getNetworkSystem()?.id;
    if (!networkId) return null;
    const playerFromMap = (
      entities as { players?: Map<string, unknown> }
    ).players?.get(networkId);
    return playerFromMap as {
      node?: { position?: Position };
      position?: unknown;
      getPosition?: () => Position;
      data?: { position?: Position | [number, number, number] };
    } | null;
  }

  get name(): string {
    return this.config.name;
  }

  get connected(): boolean {
    return (
      this.connectionVerified &&
      this.metrics.isConnected &&
      this.isActive &&
      this.getNetworkSystem()?.connected === true
    );
  }
}

export default DuelBot;
