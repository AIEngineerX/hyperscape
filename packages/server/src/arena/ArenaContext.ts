import type { World } from "@hyperscape/shared";
import type { ArenaRuntimeConfig } from "./config.js";
import type { SolanaArenaOperator } from "./SolanaArenaOperator.js";
import type { DatabaseSystem } from "../systems/DatabaseSystem/index.js";
import type { DuelSystem } from "../systems/DuelSystem/index.js";
import {
  isLikelyDevelopmentRuntime,
  readBooleanEnv,
  readIntegerEnv,
} from "./arena-utils.js";
import type { getSolanaArenaConfig } from "./config.js";

export class ArenaContext {
  public static readonly IS_PLAYWRIGHT_TEST =
    process.env.PLAYWRIGHT_TEST === "true";
  public static readonly IS_DEVELOPMENT_RUNTIME = isLikelyDevelopmentRuntime();

  public readonly world: World;
  public readonly config: ArenaRuntimeConfig;
  public readonly solanaConfig: ReturnType<typeof getSolanaArenaConfig>;
  public readonly solanaOperator: SolanaArenaOperator | null;

  private dbUnavailableLogged = false;
  private tablesUnavailableLogged = false;
  public stakingAccrualDisabled = false;
  private stakingAccrualDisabledLogged = false;

  constructor(
    world: World,
    config: ArenaRuntimeConfig,
    solanaConfig: ReturnType<typeof getSolanaArenaConfig>,
    solanaOperator: SolanaArenaOperator | null,
  ) {
    this.world = world;
    this.config = config;
    this.solanaConfig = solanaConfig;
    this.solanaOperator = solanaOperator;
  }

  public getDb() {
    const dbSystem = this.world.getSystem("database") as
      | DatabaseSystem
      | undefined;
    const db = dbSystem?.getDb() ?? null;
    if (!db && !this.dbUnavailableLogged) {
      console.warn(
        "[ArenaService] Database unavailable; arena persistence disabled",
      );
      this.dbUnavailableLogged = true;
    }
    return db;
  }

  public getDuelSystem(): DuelSystem | null {
    const duel = this.world.getSystem("duel") as DuelSystem | undefined;
    return duel ?? null;
  }

  public logDbWriteError(action: string, error: unknown): void {
    this.logTableMissingError(error);
    if (ArenaContext.IS_PLAYWRIGHT_TEST) {
      if (action === "accrue staking points" || action === "record fee share") {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : String(error ?? "unknown error");
      if (message.includes("this.dialect")) {
        return;
      }
    }
    console.warn(`[ArenaService] Failed to ${action}:`, error);
  }

  public logTableMissingError(error: unknown): void {
    if (this.tablesUnavailableLogged) return;
    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    if (
      message.includes("does not exist") ||
      message.includes("relation") ||
      message.includes("undefined_table")
    ) {
      this.tablesUnavailableLogged = true;
      this.disableStakingAccrual(
        "Disabling staking accrual until arena migrations are applied.",
      );
      console.warn(
        "[ArenaService] Arena tables appear missing. Run database migrations before enabling streamed arena betting.",
      );
    }
  }

  public isStakingAccrualConflictError(error: unknown): boolean {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : null;
    if (code === "42P10") return true;

    const message =
      error instanceof Error ? error.message : String(error ?? "unknown error");
    return (
      message.includes("ON CONFLICT") &&
      message.includes("no unique or exclusion constraint")
    );
  }

  public disableStakingAccrual(reason: string, error?: unknown): void {
    this.stakingAccrualDisabled = true;
    if (this.stakingAccrualDisabledLogged) return;
    this.stakingAccrualDisabledLogged = true;
    console.warn(`[ArenaService] ${reason}`);
    if (error != null) {
      const message =
        error instanceof Error ? error.message : String(error ?? "unknown");
      console.warn(`[ArenaService] Staking accrual error detail: ${message}`);
    }
  }

  public async fetchSolanaRpcJson<T>(params: {
    id: number;
    method: string;
    params: unknown[];
  }): Promise<T | null> {
    const SOLANA_RPC_TIMEOUT_MS = readIntegerEnv(
      "ARENA_SOLANA_RPC_TIMEOUT_MS",
      ArenaContext.IS_DEVELOPMENT_RUNTIME ? 3_000 : 8_000,
      500,
      60_000,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOLANA_RPC_TIMEOUT_MS);
    try {
      const response = await fetch(this.solanaConfig.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: params.id,
          method: params.method,
          params: params.params,
        }),
        signal: controller.signal,
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
