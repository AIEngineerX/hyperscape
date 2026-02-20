import { useEffect, useMemo, useRef, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId } from "wagmi";

import {
  DEFAULT_AUTO_SEED_DELAY_SECONDS,
  DEFAULT_BET_FEE_BPS,
  DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS,
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_SEED_GOLD_AMOUNT,
  GOLD_DECIMALS,
  GOLD_MAINNET_MINT,
  GAME_API_URL,
  ARENA_EXTERNAL_BET_WRITE_KEY,
  BSC_CHAIN_ID,
  BASE_CHAIN_ID,
  getFixedMatchId,
  getCluster,
  toBaseUnits,
  STREAM_URL,
} from "./lib/config";
import { StreamPlayer } from "./components/StreamPlayer";
import { SpectatorPanel } from "./spectator/SpectatorPanel";
import { useStreamingState } from "./spectator/useStreamingState";
import type { AgentInfo } from "./spectator/types";
import { ChainSelector } from "./components/ChainSelector";
import { EvmBettingPanel } from "./components/EvmBettingPanel";
import { PointsDisplay } from "./components/PointsDisplay";
import { PointsLeaderboard } from "./components/PointsLeaderboard";
import { ReferralPanel } from "./components/ReferralPanel";
import { useChain } from "./lib/ChainContext";
import {
  FIGHT_ORACLE_PROGRAM_ID,
  GOLD_BINARY_MARKET_PROGRAM_ID,
  createPrograms,
  createReadonlyPrograms,
  noEnum,
  toBnAmount,
  yesEnum,
} from "./lib/programs";
import {
  findMarketConfigPda,
  findMarketPda,
  findNoVaultPda,
  findOracleConfigPda,
  findPositionPda,
  findVaultAuthorityPda,
  findYesVaultPda,
} from "./lib/pdas";
import { findAnyGoldAccount } from "./lib/token";
import { simulateFight, type FightResult } from "./lib/fight";
import { isHeadlessWalletEnabled } from "./lib/headlessWallet";

type BetSide = "YES" | "NO";

type DiscoveredMatch = {
  matchId: number;
  matchPda: PublicKey;
  status: "open" | "resolved" | "unknown";
  openTs: number;
  closeTs: number;
  resolvedTs: number | null;
  winner: BetSide | null;
  agent1Name: string;
  agent2Name: string;
};

type ProgramDeploymentState = {
  checked: boolean;
  oracle: boolean;
  market: boolean;
};

type StreamingInventoryItem = {
  slot: number;
  itemId: string;
  quantity: number;
};

type StreamingMonologue = {
  id: string;
  type: string;
  content: string;
  timestamp: number;
};

type StreamingAgentContext = {
  id: string;
  name: string;
  provider: string;
  model: string;
  hp: number;
  maxHp: number;
  combatLevel: number;
  wins: number;
  losses: number;
  damageDealtThisFight: number;
  inventory: StreamingInventoryItem[];
  monologues: StreamingMonologue[];
};

type StreamingDuelContext = {
  cycle: {
    cycleId: string;
    phase: "IDLE" | "ANNOUNCEMENT" | "COUNTDOWN" | "FIGHTING" | "RESOLUTION";
    countdown: number | null;
    winnerName: string | null;
    agent1: StreamingAgentContext | null;
    agent2: StreamingAgentContext | null;
  };
};

function mergeAgentContext(
  enriched: StreamingAgentContext | null,
  live: AgentInfo | null | undefined,
): StreamingAgentContext | null {
  if (!enriched && !live) return null;
  if (enriched && live && enriched.id === live.id) {
    return {
      ...enriched,
      ...live,
    };
  }
  if (live) {
    return {
      ...live,
      inventory: [],
      monologues: [],
    };
  }
  return enriched;
}

function isWalletReady(wallet: ReturnType<typeof useWallet>): boolean {
  return Boolean(
    wallet.publicKey && wallet.signTransaction && wallet.signAllTransactions,
  );
}

function normalizeTimestamp(value: number): number {
  if (value > 1_000_000_000_000) return Math.floor(value / 1000);
  return Math.floor(value);
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0");
  return `${m}:${s}`;
}

function enumIs(value: unknown, variant: string): boolean {
  if (!value || typeof value !== "object") return false;
  const key = Object.keys(value as Record<string, unknown>)[0];
  return key === variant;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number((value as { toString: () => string }).toString());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function sideFromEnum(value: unknown): BetSide | null {
  if (enumIs(value, "yes")) return "YES";
  if (enumIs(value, "no")) return "NO";
  return null;
}

function marketStatusLabel(value: unknown): string {
  if (enumIs(value, "open")) return "OPEN";
  if (enumIs(value, "resolved")) return "RESOLVED";
  if (enumIs(value, "void")) return "VOID";
  return "UNKNOWN";
}

function formatUtc(ts: number | null): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toISOString();
}

function isMintLookupError(error: unknown): boolean {
  const message = (error as Error)?.message?.toLowerCase?.() ?? "";
  return message.includes("could not find mint");
}

function extractTxSignature(error: unknown): string | null {
  const message = (error as Error)?.message ?? "";
  const match = message.match(/signature\s+([1-9A-HJ-NP-Za-km-z]{32,88})/i);
  return match?.[1] ?? null;
}

async function waitForTxSuccessBySignature(
  connection: Connection,
  signature: string,
  timeoutMs = 60_000,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const statuses = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const status = statuses.value[0];
    if (status) {
      if (status.err) return false;
      if (status.confirmationStatus) return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 2_000));
  }
  return false;
}

async function recoverTimedOutTransaction(
  connection: Connection,
  error: unknown,
  timeoutMs = 60_000,
): Promise<boolean> {
  const signature = extractTxSignature(error);
  if (!signature) return false;
  try {
    return await waitForTxSuccessBySignature(connection, signature, timeoutMs);
  } catch {
    return false;
  }
}

function goldDisplay(amount: unknown): string {
  const raw = asNumber(amount, 0);
  return (raw / 10 ** GOLD_DECIMALS).toFixed(6);
}

export function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { address: evmWalletAddress } = useAccount();
  const connectedEvmChainId = useChainId();
  const { activeChain } = useChain();
  const isEvmChain = activeChain === "bsc" || activeChain === "base";
  const autoSeedEnabled = import.meta.env.VITE_ENABLE_AUTO_SEED !== "false";
  const solanaWalletAddress = wallet.publicKey?.toBase58() ?? null;
  const evmWalletPlatform = useMemo<"BSC" | "BASE" | null>(() => {
    if (connectedEvmChainId === BSC_CHAIN_ID) return "BSC";
    if (connectedEvmChainId === BASE_CHAIN_ID) return "BASE";
    if (activeChain === "bsc") return "BSC";
    if (activeChain === "base") return "BASE";
    return null;
  }, [activeChain, connectedEvmChainId]);
  const pointsWalletAddress = useMemo(() => {
    if (activeChain === "solana" && solanaWalletAddress)
      return solanaWalletAddress;
    if ((activeChain === "bsc" || activeChain === "base") && evmWalletAddress) {
      return evmWalletAddress;
    }
    return solanaWalletAddress ?? evmWalletAddress ?? null;
  }, [activeChain, evmWalletAddress, solanaWalletAddress]);

  const [amountInput, setAmountInput] = useState<string>("1");
  const [side, setSide] = useState<BetSide>("YES");
  const [status, setStatus] = useState<string>(
    "Connect wallet to place your bet",
  );
  const [fightResult, setFightResult] = useState<FightResult | null>(null);
  const [currentMatch, setCurrentMatch] = useState<DiscoveredMatch | null>(
    null,
  );
  const [lastResolvedMatch, setLastResolvedMatch] =
    useState<DiscoveredMatch | null>(null);
  const [currentMarketState, setCurrentMarketState] = useState<any>(null);
  const [marketConfigState, setMarketConfigState] = useState<any>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [streamingContext, setStreamingContext] =
    useState<StreamingDuelContext | null>(null);
  const [streamingContextError, setStreamingContextError] = useState<
    string | null
  >(null);
  const [configuredGoldTokenProgram, setConfiguredGoldTokenProgram] =
    useState<PublicKey>(TOKEN_2022_PROGRAM_ID);
  const [programDeployment, setProgramDeployment] =
    useState<ProgramDeploymentState>({
      checked: false,
      oracle: false,
      market: false,
    });
  const autoSeededMarketsRef = useRef<Set<string>>(new Set());
  const { state: liveStreamingState, isConnected: isStreamingStateConnected } =
    useStreamingState();

  const programs = useMemo(() => {
    if (!isWalletReady(wallet)) return null;
    return createPrograms(connection, wallet);
  }, [connection, wallet]);

  const readonlyPrograms = useMemo(
    () => createReadonlyPrograms(connection),
    [connection],
  );

  const configuredGoldMint = GOLD_MAINNET_MINT;
  const fixedMatchId = getFixedMatchId();
  const marketConfigPda = useMemo(
    () => findMarketConfigPda(GOLD_BINARY_MARKET_PROGRAM_ID),
    [],
  );

  const programsReady =
    programDeployment.checked &&
    programDeployment.oracle &&
    programDeployment.market;

  const missingProgramMessage = useMemo(() => {
    if (programDeployment.oracle && programDeployment.market) return "";
    return `Betting is temporarily unavailable on ${getCluster()}. Please try again later or switch chain.`;
  }, [programDeployment.oracle, programDeployment.market]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const mintAccount = await connection.getAccountInfo(
          configuredGoldMint,
          "confirmed",
        );
        if (cancelled || !mintAccount) return;
        if (mintAccount.owner.equals(TOKEN_PROGRAM_ID)) {
          setConfiguredGoldTokenProgram(TOKEN_PROGRAM_ID);
          return;
        }
        if (mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID)) {
          setConfiguredGoldTokenProgram(TOKEN_2022_PROGRAM_ID);
        }
      } catch {
        if (!cancelled) setConfiguredGoldTokenProgram(TOKEN_2022_PROGRAM_ID);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, configuredGoldMint]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [oracleInfo, marketInfo] = await Promise.all([
          connection.getAccountInfo(FIGHT_ORACLE_PROGRAM_ID, "confirmed"),
          connection.getAccountInfo(GOLD_BINARY_MARKET_PROGRAM_ID, "confirmed"),
        ]);
        if (cancelled) return;
        setProgramDeployment({
          checked: true,
          oracle: Boolean(oracleInfo?.executable),
          market: Boolean(marketInfo?.executable),
        });
      } catch {
        if (cancelled) return;
        setProgramDeployment({ checked: true, oracle: false, market: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection]);

  useEffect(() => {
    if (!programDeployment.checked) return;
    if (programsReady) return;
    setStatus(missingProgramMessage);
  }, [programDeployment.checked, programsReady, missingProgramMessage]);

  useEffect(() => {
    if (!isHeadlessWalletEnabled()) return;

    const selected = wallet.wallet?.adapter?.name?.toLowerCase?.() ?? "";
    const hasHeadlessSelected =
      selected.includes("headless") || selected.includes("e2e wallet");

    if (!wallet.wallet) {
      const candidate = wallet.wallets.find((entry) => {
        const name = entry.adapter.name.toLowerCase();
        return name.includes("headless") || name.includes("e2e wallet");
      });
      if (candidate) wallet.select(candidate.adapter.name);
      return;
    }

    if (!hasHeadlessSelected) return;
    if (wallet.connected || wallet.connecting) return;
    void wallet.connect();
  }, [
    wallet.wallet,
    wallet.wallets,
    wallet.connected,
    wallet.connecting,
    wallet.select,
    wallet.connect,
  ]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRefreshNonce((value) => value + 1);
    }, DEFAULT_REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;
    let intervalId: number | null = null;
    let intervalMs = document.visibilityState === "visible" ? 10_000 : 30_000;

    const fetchStreamingContext = async () => {
      try {
        const response = await fetch(
          `${GAME_API_URL}/api/streaming/duel-context`,
        );
        if (!response.ok) {
          if (!active) return;
          setStreamingContext(null);
          setStreamingContextError(
            `Streaming context unavailable (${response.status})`,
          );
          return;
        }

        const payload = (await response.json()) as StreamingDuelContext;
        if (!active) return;
        setStreamingContext(payload);
        setStreamingContextError(null);
      } catch {
        if (!active) return;
        setStreamingContext(null);
        setStreamingContextError("Streaming context fetch failed");
      }
    };

    const armInterval = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = window.setInterval(() => {
        void fetchStreamingContext();
      }, intervalMs);
    };

    const onVisibilityChange = () => {
      const nextInterval =
        document.visibilityState === "visible" ? 10_000 : 30_000;
      if (nextInterval === intervalMs) return;
      intervalMs = nextInterval;
      armInterval();
      void fetchStreamingContext();
    };

    void fetchStreamingContext();
    armInterval();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setIsRefreshing(true);
      try {
        const fightProgram: any = readonlyPrograms.fightOracle;
        const marketProgram: any = readonlyPrograms.goldBinaryMarket;

        const allMatchesRaw = await fightProgram.account.matchResult.all();
        const matches = (allMatchesRaw as any[])
          .map<DiscoveredMatch>((entry: any) => {
            const account = entry.account;
            const status = enumIs(account.status, "open")
              ? "open"
              : enumIs(account.status, "resolved")
                ? "resolved"
                : "unknown";

            const matchId = asNumber(account.matchId, 0);
            const openTs = normalizeTimestamp(asNumber(account.openTs, 0));
            const closeTs = normalizeTimestamp(asNumber(account.betCloseTs, 0));
            const resolvedTs = account.resolvedTs
              ? normalizeTimestamp(asNumber(account.resolvedTs))
              : null;

            const metadataUri = account.metadataUri ?? "";
            let agent1Name = "Agent A";
            let agent2Name = "Agent B";
            try {
              if (metadataUri.startsWith("{")) {
                const meta = JSON.parse(metadataUri);
                agent1Name = meta.agent1 || "Agent A";
                agent2Name = meta.agent2 || "Agent B";
              }
            } catch {}

            return {
              matchId,
              matchPda: entry.publicKey as PublicKey,
              status,
              openTs,
              closeTs,
              resolvedTs,
              winner: sideFromEnum(account.winner),
              agent1Name,
              agent2Name,
            };
          })
          .sort(
            (a: DiscoveredMatch, b: DiscoveredMatch) =>
              b.openTs - a.openTs ||
              b.matchId - a.matchId ||
              b.closeTs - a.closeTs,
          );

        let nextCurrent: DiscoveredMatch | null = null;
        const openMatches = matches
          .filter((value) => value.status === "open")
          .sort(
            (a, b) =>
              b.openTs - a.openTs ||
              b.matchId - a.matchId ||
              b.closeTs - a.closeTs,
          );

        if (fixedMatchId) {
          nextCurrent =
            matches.find((value) => value.matchId === fixedMatchId) ?? null;
        }

        if (!nextCurrent) {
          nextCurrent = openMatches[0] ?? matches[0] ?? null;
        }

        const resolved = matches.filter((value) => value.status === "resolved");
        const nextLastResolved =
          resolved.find((value) => value.matchId !== nextCurrent?.matchId) ??
          resolved[0] ??
          null;

        let nextMarketState: any = null;
        let nextMarketConfigState: any = null;
        if (nextCurrent) {
          const marketPda = findMarketPda(
            GOLD_BINARY_MARKET_PROGRAM_ID,
            nextCurrent.matchPda,
          );
          try {
            nextMarketState =
              await marketProgram.account.market.fetch(marketPda);
          } catch {
            nextMarketState = null;
          }
        }

        try {
          nextMarketConfigState =
            await marketProgram.account.marketConfig.fetch(marketConfigPda);
        } catch {
          nextMarketConfigState = null;
        }

        if (cancelled) return;

        setCurrentMatch(nextCurrent);
        setLastResolvedMatch(nextLastResolved);
        setCurrentMarketState(nextMarketState);
        setMarketConfigState(nextMarketConfigState);
      } catch (error) {
        if (!cancelled) {
          setStatus(`Refresh failed: ${(error as Error).message}`);
        }
      } finally {
        if (!cancelled) setIsRefreshing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [readonlyPrograms, refreshNonce, fixedMatchId, marketConfigPda]);

  const addresses = useMemo(() => {
    if (!currentMatch) return null;
    const market = findMarketPda(
      GOLD_BINARY_MARKET_PROGRAM_ID,
      currentMatch.matchPda,
    );
    const vaultAuthority = findVaultAuthorityPda(
      GOLD_BINARY_MARKET_PROGRAM_ID,
      market,
    );
    const yesVault = findYesVaultPda(GOLD_BINARY_MARKET_PROGRAM_ID, market);
    const noVault = findNoVaultPda(GOLD_BINARY_MARKET_PROGRAM_ID, market);
    return {
      match: currentMatch.matchPda,
      market,
      vaultAuthority,
      yesVault,
      noVault,
    };
  }, [currentMatch]);

  const marketGoldMint = useMemo(() => {
    try {
      const value = currentMarketState?.goldMint;
      if (value && typeof value.toBase58 === "function") {
        return value as PublicKey;
      }
      if (typeof value === "string") {
        return new PublicKey(value);
      }
      return configuredGoldMint;
    } catch {
      return configuredGoldMint;
    }
  }, [currentMarketState, configuredGoldMint]);

  const marketTokenProgram = useMemo(() => {
    try {
      const value = currentMarketState?.tokenProgram;
      if (value && typeof value.toBase58 === "function") {
        return value as PublicKey;
      }
      if (typeof value === "string") {
        return new PublicKey(value);
      }
      return configuredGoldTokenProgram;
    } catch {
      return configuredGoldTokenProgram;
    }
  }, [currentMarketState, configuredGoldTokenProgram]);

  const canAttemptSeed = useMemo(() => {
    if (!addresses || !currentMarketState || !wallet.publicKey) return false;
    if (!enumIs(currentMarketState.status, "open")) return false;
    const marketMaker = currentMarketState.marketMaker as PublicKey | undefined;
    if (!marketMaker) return false;
    if (!wallet.publicKey.equals(marketMaker)) return false;

    const openTs = asNumber(currentMarketState.openTs, 0);
    const autoDelay = asNumber(
      currentMarketState.autoSeedDelaySeconds,
      DEFAULT_AUTO_SEED_DELAY_SECONDS,
    );

    const hasUserBets =
      asNumber(currentMarketState.userYesTotal, 0) > 0 ||
      asNumber(currentMarketState.userNoTotal, 0) > 0;
    const hasMakerBets =
      asNumber(currentMarketState.makerYesTotal, 0) > 0 ||
      asNumber(currentMarketState.makerNoTotal, 0) > 0;

    return nowTs >= openTs + autoDelay && !hasUserBets && !hasMakerBets;
  }, [addresses, currentMarketState, wallet.publicKey, nowTs]);

  const handleRefresh = () => {
    setRefreshNonce((value) => value + 1);
  };

  const ensureMarketConfig = async (marketProgram: any): Promise<any> => {
    if (!wallet.publicKey) {
      throw new Error("Wallet connection is required");
    }

    try {
      await marketProgram.methods
        .initializeMarketConfig(
          wallet.publicKey,
          wallet.publicKey,
          DEFAULT_BET_FEE_BPS,
        )
        .accounts({
          authority: wallet.publicKey,
          marketConfig: marketConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (error) {
      const recovered = await recoverTimedOutTransaction(connection, error);
      if (!recovered) throw error;
    }

    const config =
      await marketProgram.account.marketConfig.fetchNullable(marketConfigPda);
    if (!config) {
      throw new Error("Market config not initialized");
    }
    return config;
  };

  const createNewRound = async (): Promise<{
    match: DiscoveredMatch;
    market: any;
    roundAddresses: {
      match: PublicKey;
      market: PublicKey;
      vaultAuthority: PublicKey;
      yesVault: PublicKey;
      noVault: PublicKey;
    };
  } | null> => {
    if (!programsReady) {
      setStatus(missingProgramMessage);
      return null;
    }
    if (!programs || !wallet.publicKey) {
      setStatus("Wallet connection is required");
      return null;
    }

    const matchId = Date.now();
    const fightProgram: any = programs.fightOracle;
    const marketProgram: any = programs.goldBinaryMarket;
    const oracleConfig = findOracleConfigPda(FIGHT_ORACLE_PROGRAM_ID);
    const matchIdBn = new BN(matchId.toString());
    const matchPda = PublicKey.findProgramAddressSync(
      [Buffer.from("match"), matchIdBn.toArrayLike(Buffer, "le", 8)],
      FIGHT_ORACLE_PROGRAM_ID,
    )[0];
    const marketPda = findMarketPda(GOLD_BINARY_MARKET_PROGRAM_ID, matchPda);
    const vaultAuthority = findVaultAuthorityPda(
      GOLD_BINARY_MARKET_PROGRAM_ID,
      marketPda,
    );
    const yesVault = findYesVaultPda(GOLD_BINARY_MARKET_PROGRAM_ID, marketPda);
    const noVault = findNoVaultPda(GOLD_BINARY_MARKET_PROGRAM_ID, marketPda);

    try {
      setStatus("Initializing oracle + creating new market...");
      await fightProgram.methods
        .initializeOracle()
        .accounts({
          authority: wallet.publicKey,
          oracleConfig,
        })
        .rpc();

      const marketConfig = await ensureMarketConfig(marketProgram);

      await fightProgram.methods
        .createMatch(
          matchIdBn,
          new BN(DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS.toString()),
          JSON.stringify({
            agent1: "Manual Agent A",
            agent2: "Manual Agent B",
          }),
        )
        .accounts({
          authority: wallet.publicKey,
          oracleConfig,
          matchResult: matchPda,
        })
        .rpc();

      await marketProgram.methods
        .initializeMarket(new BN(DEFAULT_AUTO_SEED_DELAY_SECONDS.toString()))
        .accounts({
          payer: wallet.publicKey,
          marketMaker: wallet.publicKey,
          oracleMatch: matchPda,
          marketConfig: marketConfigPda,
          market: marketPda,
          vaultAuthority,
          yesVault,
          noVault,
          goldMint: configuredGoldMint,
          tokenProgram: configuredGoldTokenProgram,
        })
        .rpc();

      let matchAccount: any = null;
      let marketAccount: any = null;
      try {
        matchAccount =
          await fightProgram.account.matchResult.fetchNullable(matchPda);
      } catch {
        matchAccount = null;
      }
      try {
        marketAccount =
          await marketProgram.account.market.fetchNullable(marketPda);
      } catch {
        marketAccount = null;
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const fallbackCloseTs = nowSeconds + DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS;

      const discoveredMatch: DiscoveredMatch = {
        matchId,
        matchPda,
        status: "open",
        openTs: normalizeTimestamp(asNumber(matchAccount?.openTs, nowSeconds)),
        closeTs: normalizeTimestamp(
          asNumber(matchAccount?.betCloseTs, fallbackCloseTs),
        ),
        resolvedTs: null,
        winner: null,
        agent1Name: "Agent A",
        agent2Name: "Agent B",
      };

      const roundAddresses = {
        match: matchPda,
        market: marketPda,
        vaultAuthority,
        yesVault,
        noVault,
      };

      autoSeededMarketsRef.current.delete(marketPda.toBase58());
      setCurrentMatch(discoveredMatch);
      if (marketAccount) setCurrentMarketState(marketAccount);
      setMarketConfigState(marketConfig);
      setStatus(`Created market for match ${matchId}`);
      setRefreshNonce((value) => value + 1);
      return { match: discoveredMatch, market: marketAccount, roundAddresses };
    } catch (error) {
      const recovered = await recoverTimedOutTransaction(connection, error);
      if (recovered) {
        setStatus(`Created market for match ${matchId}`);
        setRefreshNonce((value) => value + 1);
        return null;
      }
      setStatus(`Create round failed: ${(error as Error).message}`);
      return null;
    }
  };

  const handleStartNewRound = async () => {
    await createNewRound();
  };

  const handleSeedIfEmpty = async (
    source: "manual" | "auto" = "manual",
  ): Promise<void> => {
    if (!programsReady) {
      if (source === "manual") setStatus(missingProgramMessage);
      return;
    }
    if (!wallet.publicKey || !programs || !addresses || !currentMarketState) {
      if (source === "manual")
        setStatus("Wallet and active market are required");
      return;
    }

    try {
      const marketProgram: any = programs.goldBinaryMarket;
      const marketMaker = currentMarketState.marketMaker as PublicKey;
      if (!wallet.publicKey.equals(marketMaker)) {
        throw new Error("Only market maker wallet can seed liquidity");
      }

      const marketMakerGoldAta = await findAnyGoldAccount(
        connection,
        wallet.publicKey,
        marketGoldMint,
      );
      if (!marketMakerGoldAta) {
        throw new Error("Market maker GOLD token account not found");
      }

      const makerPosition = findPositionPda(
        GOLD_BINARY_MARKET_PROGRAM_ID,
        addresses.market,
        wallet.publicKey,
      );

      const amountEach = toBaseUnits(DEFAULT_SEED_GOLD_AMOUNT, GOLD_DECIMALS);
      setStatus(
        source === "auto"
          ? "Auto-seeding market-maker liquidity..."
          : "Seeding market-maker liquidity...",
      );
      await marketProgram.methods
        .seedLiquidityIfEmpty(toBnAmount(amountEach))
        .accounts({
          marketMaker: wallet.publicKey,
          market: addresses.market,
          marketMakerGoldAta,
          yesVault: addresses.yesVault,
          noVault: addresses.noVault,
          marketMakerPosition: makerPosition,
          goldMint: marketGoldMint,
          tokenProgram: marketTokenProgram,
        })
        .rpc();

      setStatus("Market-maker liquidity seeded");
      setRefreshNonce((value) => value + 1);
    } catch (error) {
      const recovered = await recoverTimedOutTransaction(connection, error);
      if (recovered) {
        setStatus("Market-maker liquidity seeded");
        setRefreshNonce((value) => value + 1);
        return;
      }
      if (source === "manual") {
        setStatus(`Seed failed: ${(error as Error).message}`);
      }
    }
  };

  useEffect(() => {
    if (!autoSeedEnabled) return;
    if (!canAttemptSeed || !addresses) return;
    const key = addresses.market.toBase58();
    if (autoSeededMarketsRef.current.has(key)) return;
    autoSeededMarketsRef.current.add(key);
    void handleSeedIfEmpty("auto");
  }, [autoSeedEnabled, canAttemptSeed, addresses]);

  const handlePlaceBet = async () => {
    if (!programsReady) {
      setStatus(missingProgramMessage);
      return;
    }
    if (!wallet.publicKey || !programs) {
      setStatus("Wallet connection is required");
      return;
    }

    try {
      const marketProgram: any = programs.goldBinaryMarket;
      let activeAddresses = addresses;
      let activeMarketState = currentMarketState;

      if (!activeAddresses || !activeMarketState) {
        setStatus("No active market found. Auto-creating a fresh round...");
        const created = await createNewRound();
        if (!created) {
          setStatus(
            "Auto-create failed. Start the bot or use oracle authority wallet.",
          );
          return;
        }
        activeAddresses = created.roundAddresses;
        activeMarketState = created.market;
      }

      const activeGoldMint = (() => {
        try {
          const value = activeMarketState.goldMint;
          if (value && typeof value.toBase58 === "function") {
            return value as PublicKey;
          }
          if (typeof value === "string") {
            return new PublicKey(value);
          }
          return configuredGoldMint;
        } catch {
          return configuredGoldMint;
        }
      })();

      const activeTokenProgram = (() => {
        try {
          const value = activeMarketState.tokenProgram;
          if (value && typeof value.toBase58 === "function") {
            return value as PublicKey;
          }
          if (typeof value === "string") {
            return new PublicKey(value);
          }
          return configuredGoldTokenProgram;
        } catch {
          return configuredGoldTokenProgram;
        }
      })();

      const baseAmount = toBaseUnits(Number(amountInput), GOLD_DECIMALS);
      if (baseAmount <= 0n) {
        throw new Error("Order amount must be > 0");
      }

      // Bet using the configured source asset directly
      // The on-chain market will be initialized with the correct mint

      const mintAccountInfo = await connection.getAccountInfo(
        activeGoldMint,
        "confirmed",
      );
      if (!mintAccountInfo) {
        throw new Error(
          `GOLD mint ${activeGoldMint.toBase58()} not found on ${getCluster()}`,
        );
      }

      const goldAccount = await findAnyGoldAccount(
        connection,
        wallet.publicKey,
        activeGoldMint,
      );

      if (!goldAccount) {
        throw new Error("No GOLD token account found in wallet");
      }

      const marketConfig =
        marketConfigState ||
        (await marketProgram.account.marketConfig.fetch(marketConfigPda));
      if (!marketConfigState) {
        setMarketConfigState(marketConfig);
      }
      const feeWallet = marketConfig.feeWallet as PublicKey;
      const feeWalletGoldAta = await findAnyGoldAccount(
        connection,
        feeWallet,
        activeGoldMint,
      );
      if (!feeWalletGoldAta) {
        throw new Error("Fee wallet GOLD token account not found");
      }

      const positionPda = findPositionPda(
        GOLD_BINARY_MARKET_PROGRAM_ID,
        activeAddresses.market,
        wallet.publicKey,
      );

      setStatus("Placing order on-chain...");
      const txSignature = (await marketProgram.methods
        .placeBet(side === "YES" ? yesEnum() : noEnum(), toBnAmount(baseAmount))
        .accounts({
          bettor: wallet.publicKey,
          market: activeAddresses.market,
          bettorGoldAta: goldAccount,
          marketConfig: marketConfigPda,
          feeWalletGoldAta,
          vaultAuthority: activeAddresses.vaultAuthority,
          yesVault: activeAddresses.yesVault,
          noVault: activeAddresses.noVault,
          position: positionPda,
          goldMint: activeGoldMint,
          tokenProgram: activeTokenProgram,
        })
        .rpc()) as string;

      let trackingError: string | null = null;
      try {
        const response = await fetch(
          `${GAME_API_URL}/api/arena/bet/record-external`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(ARENA_EXTERNAL_BET_WRITE_KEY
                ? { "x-arena-write-key": ARENA_EXTERNAL_BET_WRITE_KEY }
                : {}),
            },
            body: JSON.stringify({
              bettorWallet: wallet.publicKey.toBase58(),
              chain: "SOLANA",
              sourceAsset: "GOLD",
              sourceAmount: amountInput,
              goldAmount: amountInput,
              feeBps: asNumber(marketConfig?.feeBps, DEFAULT_BET_FEE_BPS),
              txSignature,
              externalBetRef: currentMatch
                ? `solana:match:${currentMatch.matchId}`
                : `solana:market:${activeAddresses.market.toBase58()}`,
            }),
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          trackingError = payload.error ?? `HTTP ${response.status}`;
        }
      } catch {
        trackingError = "request failed";
      }

      setStatus(
        trackingError
          ? `Order placed on-chain. Tracking failed: ${trackingError}`
          : "Order placed",
      );
      setRefreshNonce((value) => value + 1);
    } catch (error) {
      if (isMintLookupError(error)) {
        setStatus(
          `Place order failed: configured GOLD mint is unavailable on ${getCluster()}`,
        );
        return;
      }

      const recovered = await recoverTimedOutTransaction(connection, error);
      if (recovered) {
        setStatus("Order placed");
        setRefreshNonce((value) => value + 1);
        return;
      }

      setStatus(`Place order failed: ${(error as Error).message}`);
    }
  };

  const handlePostResultAndResolve = async () => {
    if (!programsReady) {
      setStatus(missingProgramMessage);
      return;
    }
    if (!wallet.publicKey || !programs || !addresses || !currentMatch) {
      setStatus("Wallet and active market are required");
      return;
    }

    const fightProgram: any = programs.fightOracle;
    const marketProgram: any = programs.goldBinaryMarket;
    const oracleConfig = findOracleConfigPda(FIGHT_ORACLE_PROGRAM_ID);
    const seed = BigInt(Date.now());
    const result = simulateFight(seed);

    const syncResolvedStateFromChain = async (): Promise<boolean> => {
      try {
        const marketState = await marketProgram.account.market.fetch(
          addresses.market,
        );
        const isResolved =
          enumIs(marketState.status, "resolved") ||
          enumIs(marketState.status, "void");
        if (!isResolved) return false;

        const winner = sideFromEnum(marketState.resolvedWinner);
        setFightResult(result);
        setRefreshNonce((value) => value + 1);
        setStatus(
          `Resolved. Winner: ${winner ?? (result.winner === "A" ? "YES" : "NO")}`,
        );
        return true;
      } catch {
        return false;
      }
    };

    try {
      setStatus("Posting oracle result...");
      await fightProgram.methods
        .postResult(
          result.winner === "A" ? yesEnum() : noEnum(),
          new BN(result.seed.toString()),
          Array.from(result.replayHash),
        )
        .accounts({
          authority: wallet.publicKey,
          oracleConfig,
          matchResult: addresses.match,
        })
        .rpc();

      setStatus("Resolving market from oracle...");
      await marketProgram.methods
        .resolveFromOracle()
        .accounts({
          resolver: wallet.publicKey,
          market: addresses.market,
          oracleMatch: addresses.match,
        })
        .rpc();

      setFightResult(result);
      setRefreshNonce((value) => value + 1);
      setStatus(`Resolved. Winner: ${result.winner === "A" ? "YES" : "NO"}`);
    } catch (error) {
      const recovered = await recoverTimedOutTransaction(
        connection,
        error,
        90_000,
      );
      if (recovered) {
        try {
          await marketProgram.methods
            .resolveFromOracle()
            .accounts({
              resolver: wallet.publicKey,
              market: addresses.market,
              oracleMatch: addresses.match,
            })
            .rpc();
        } catch (retryError) {
          await recoverTimedOutTransaction(connection, retryError, 90_000);
        }
      }

      const synced = await syncResolvedStateFromChain();
      if (synced) return;
      setStatus(`Resolve failed: ${(error as Error).message}`);
    }
  };

  const handleClaim = async () => {
    if (!programsReady) {
      setStatus(missingProgramMessage);
      return;
    }
    if (!wallet.publicKey || !programs || !addresses) {
      setStatus("Wallet and market are required");
      return;
    }

    try {
      const marketProgram: any = programs.goldBinaryMarket;
      const goldAccount = await findAnyGoldAccount(
        connection,
        wallet.publicKey,
        marketGoldMint,
      );
      if (!goldAccount) {
        throw new Error("No GOLD token account found in wallet");
      }

      const positionPda = findPositionPda(
        GOLD_BINARY_MARKET_PROGRAM_ID,
        addresses.market,
        wallet.publicKey,
      );

      setStatus("Claiming payout...");
      await marketProgram.methods
        .claim()
        .accounts({
          bettor: wallet.publicKey,
          market: addresses.market,
          position: positionPda,
          bettorGoldAta: goldAccount,
          vaultAuthority: addresses.vaultAuthority,
          yesVault: addresses.yesVault,
          noVault: addresses.noVault,
          goldMint: marketGoldMint,
          tokenProgram: marketTokenProgram,
        })
        .rpc();

      setRefreshNonce((value) => value + 1);
      setStatus("Claim complete");
    } catch (error) {
      const recovered = await recoverTimedOutTransaction(connection, error);
      if (recovered) {
        setRefreshNonce((value) => value + 1);
        setStatus("Claim complete");
        return;
      }
      setStatus(`Claim failed: ${(error as Error).message}`);
    }
  };

  const userYes = asNumber(currentMarketState?.userYesTotal, 0);
  const userNo = asNumber(currentMarketState?.userNoTotal, 0);
  const makerYes = asNumber(currentMarketState?.makerYesTotal, 0);
  const makerNo = asNumber(currentMarketState?.makerNoTotal, 0);
  const yesPot = userYes + makerYes;
  const noPot = userNo + makerNo;
  const totalPot = yesPot + noPot;
  const yesSharePercent =
    totalPot > 0 ? Math.round((yesPot / totalPot) * 100) : 50;
  const noSharePercent = 100 - yesSharePercent;
  const resolvedWinner = sideFromEnum(currentMarketState?.resolvedWinner);
  const marketFeeBps = asNumber(marketConfigState?.feeBps, DEFAULT_BET_FEE_BPS);
  const feeWalletAddress = (() => {
    try {
      const value = marketConfigState?.feeWallet;
      if (value && typeof value.toBase58 === "function") {
        return (value as PublicKey).toBase58();
      }
      if (typeof value === "string") return value;
      return wallet.publicKey?.toBase58() ?? "-";
    } catch {
      return "-";
    }
  })();
  const streamAgentA = mergeAgentContext(
    streamingContext?.cycle.agent1 ?? null,
    liveStreamingState?.cycle.agent1 ?? null,
  );
  const streamAgentB = mergeAgentContext(
    streamingContext?.cycle.agent2 ?? null,
    liveStreamingState?.cycle.agent2 ?? null,
  );
  const statusColor = /failed|error|unavailable|required|not found/i.test(
    status,
  )
    ? "#fda4af"
    : /placed|complete|seeded|created|linked/i.test(status)
      ? "#86efac"
      : "rgba(255,255,255,0.78)";

  return (
    <div className="app-root">
      {/* Stream Background */}
      {STREAM_URL && (
        <div className="stream-bg">
          <StreamPlayer streamUrl={STREAM_URL} />
        </div>
      )}

      {/* Top Bar — chain + wallet connections */}
      <div className="top-bar">
        <div className="top-bar-left">
          <ChainSelector />
        </div>
        <div className="top-bar-wallets">
          <WalletMultiButton />
          <ConnectButton.Custom>
            {({
              openConnectModal,
              openAccountModal,
              openChainModal,
              account,
              chain,
              mounted,
            }) => {
              if (!mounted || !account) {
                return (
                  <button
                    type="button"
                    className="evm-connect-btn"
                    onClick={openConnectModal}
                  >
                    Add EVM Wallet
                  </button>
                );
              }
              if (chain?.unsupported) {
                return (
                  <button
                    type="button"
                    className="evm-connect-btn"
                    onClick={openChainModal}
                  >
                    Switch EVM Network
                  </button>
                );
              }
              return (
                <button
                  type="button"
                  className="evm-connect-btn is-linked"
                  onClick={openAccountModal}
                >
                  EVM {account.displayName}
                </button>
              );
            }}
          </ConnectButton.Custom>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-layout">
        {/* Left Panel — all agent/match data, no tabs */}
        <div className="panel panel-left">
          <div className="panel-inner">
            <SpectatorPanel
              state={liveStreamingState}
              isConnected={isStreamingStateConnected}
              agentA={streamAgentA}
              agentB={streamAgentB}
            />
          </div>
        </div>

        {/* Center — stream fills the gap */}
        <div className="center-spacer" />

        {/* Right Panel — wallet setup + betting */}
        <div className="panel panel-right">
          <div className="panel-inner">
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                padding: 14,
                borderRadius: 12,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  textTransform: "uppercase",
                  opacity: 0.65,
                }}
              >
                My Points
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)" }}>
                {pointsWalletAddress
                  ? `Tracking wallet: ${pointsWalletAddress.slice(0, 6)}...${pointsWalletAddress.slice(-4)}`
                  : "Connect Solana or EVM wallet to view points"}
              </div>
              <PointsDisplay walletAddress={pointsWalletAddress} />
            </div>

            <ReferralPanel
              activeChain={activeChain}
              solanaWallet={solanaWalletAddress}
              evmWallet={evmWalletAddress ?? null}
              evmWalletPlatform={evmWalletPlatform}
            />
            <PointsLeaderboard />

            {/* Betting / Order Placement */}
            {isEvmChain ? (
              <EvmBettingPanel />
            ) : (
              <div
                style={{ display: "flex", flexDirection: "column", gap: 16 }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 1.5,
                    color: "rgba(255,255,255,0.5)",
                  }}
                >
                  Bet on Match Winner
                </div>

                <div style={{ display: "flex", gap: 12 }}>
                  <button
                    type="button"
                    className="side-btn"
                    aria-pressed={side === "YES"}
                    style={{
                      flex: 1,
                      padding: "16px",
                      background:
                        side === "YES"
                          ? "rgba(34,197,94,0.15)"
                          : "rgba(255,255,255,0.03)",
                      border:
                        side === "YES"
                          ? "1px solid #22c55e"
                          : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 12,
                      color: "#fff",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => setSide("YES")}
                  >
                    <div
                      style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}
                    >
                      Agent A
                    </div>
                    <div
                      style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}
                    >
                      {yesSharePercent}% of pool
                    </div>
                  </button>
                  <button
                    type="button"
                    className="side-btn"
                    aria-pressed={side === "NO"}
                    style={{
                      flex: 1,
                      padding: "16px",
                      background:
                        side === "NO"
                          ? "rgba(239,68,68,0.15)"
                          : "rgba(255,255,255,0.03)",
                      border:
                        side === "NO"
                          ? "1px solid #ef4444"
                          : "1px solid rgba(255,255,255,0.08)",
                      borderRadius: 12,
                      color: "#fff",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => setSide("NO")}
                  >
                    <div
                      style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}
                    >
                      Agent B
                    </div>
                    <div
                      style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}
                    >
                      {noSharePercent}% of pool
                    </div>
                  </button>
                </div>

                <label
                  style={{
                    fontSize: 11,
                    color: "rgba(255,255,255,0.5)",
                    textTransform: "uppercase",
                    letterSpacing: 1.1,
                  }}
                >
                  Bet Amount (GOLD)
                </label>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <input
                    type="number"
                    min="0"
                    step="0.000001"
                    inputMode="decimal"
                    aria-label="Bet amount in GOLD"
                    placeholder="Enter amount"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    style={{
                      flex: 1,
                      padding: "14px 16px",
                      background: "rgba(0,0,0,0.4)",
                      border: "1px solid rgba(255,255,255,0.1)",
                      borderRadius: 12,
                      color: "#fff",
                      fontSize: 16,
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                <button
                  className="place-order-btn"
                  disabled={!isWalletReady(wallet) || !programsReady}
                  onClick={handlePlaceBet}
                >
                  {isWalletReady(wallet)
                    ? `Bet on ${side === "YES" ? "Agent A" : "Agent B"}`
                    : "Connect Solana Wallet"}
                </button>

                <div
                  style={{
                    fontSize: 12,
                    color: "rgba(255,255,255,0.65)",
                    lineHeight: 1.45,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                >
                  Stream visuals can lag behind real-time. Outcome and
                  settlement are finalized by on-chain market resolution.
                </div>
              </div>
            )}

            <div
              style={{
                marginTop: 14,
                fontSize: 12,
                color: statusColor,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 10,
                padding: "10px 12px",
                lineHeight: 1.4,
              }}
            >
              {status}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
