/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import {
  DEFAULT_AUTO_SEED_DELAY_SECONDS,
  DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS,
  DEFAULT_REFRESH_INTERVAL_MS,
  DEFAULT_SEED_GOLD_AMOUNT,
  GOLD_DECIMALS,
  GOLD_MAINNET_MINT,
  SOL_MINT,
  USDC_MINT,
  getCluster,
  toBaseUnits,
} from "./lib/config";
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
  findMarketPda,
  findNoVaultPda,
  findOracleConfigPda,
  findPositionPda,
  findVaultAuthorityPda,
  findYesVaultPda,
} from "./lib/pdas";
import { findAnyGoldAccount } from "./lib/token";
import { getJupiterQuote, swapToGoldViaJupiter } from "./lib/jupiter";
import { fetchGoldPriceUsd } from "./lib/birdeye";
import { simulateFight, type FightResult } from "./lib/fight";
import { isHeadlessWalletEnabled } from "./lib/headlessWallet";

type PayAsset = "GOLD" | "SOL" | "USDC";
type BetSide = "YES" | "NO";

type DiscoveredMatch = {
  matchId: number;
  matchPda: PublicKey;
  status: "open" | "resolved" | "unknown";
  openTs: number;
  closeTs: number;
  resolvedTs: number | null;
  winner: BetSide | null;
};

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

function goldDisplay(amount: unknown): string {
  const raw = asNumber(amount, 0);
  return (raw / 10 ** GOLD_DECIMALS).toFixed(6);
}

export function App() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const autoSeedEnabled = import.meta.env.VITE_ENABLE_AUTO_SEED !== "false";

  const [amountInput, setAmountInput] = useState<string>("1");
  const [side, setSide] = useState<BetSide>("YES");
  const [payAsset, setPayAsset] = useState<PayAsset>("GOLD");
  const [status, setStatus] = useState<string>(
    "Connect wallet to place bet or start a round",
  );
  const [fightResult, setFightResult] = useState<FightResult | null>(null);
  const [goldPriceUsd, setGoldPriceUsd] = useState<number | null>(null);
  const [currentMatch, setCurrentMatch] = useState<DiscoveredMatch | null>(
    null,
  );
  const [lastResolvedMatch, setLastResolvedMatch] =
    useState<DiscoveredMatch | null>(null);
  const [currentMarketState, setCurrentMarketState] = useState<any>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  const [isRefreshing, setIsRefreshing] = useState(false);
  const autoSeededMarketsRef = useRef<Set<string>>(new Set());

  const programs = useMemo(() => {
    if (!isWalletReady(wallet)) return null;
    return createPrograms(connection, wallet);
  }, [connection, wallet]);

  const readonlyPrograms = useMemo(
    () => createReadonlyPrograms(connection),
    [connection],
  );

  const configuredGoldMint = GOLD_MAINNET_MINT;

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

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
    let cancelled = false;
    const loadPrice = async () => {
      const price = await fetchGoldPriceUsd(configuredGoldMint.toBase58());
      if (!cancelled) setGoldPriceUsd(price);
    };
    void loadPrice();
    const id = window.setInterval(loadPrice, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [configuredGoldMint]);

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

            return {
              matchId,
              matchPda: entry.publicKey as PublicKey,
              status,
              openTs,
              closeTs,
              resolvedTs,
              winner: sideFromEnum(account.winner),
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

        nextCurrent = openMatches[0] ?? matches[0] ?? null;

        const resolved = matches.filter((value) => value.status === "resolved");
        const nextLastResolved =
          resolved.find((value) => value.matchId !== nextCurrent?.matchId) ??
          resolved[0] ??
          null;

        let nextMarketState: any = null;
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

        if (cancelled) return;

        setCurrentMatch(nextCurrent);
        setLastResolvedMatch(nextLastResolved);
        setCurrentMarketState(nextMarketState);
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
  }, [readonlyPrograms, refreshNonce]);

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

  const remainingSeconds = useMemo(() => {
    if (!currentMatch) return 0;
    return Math.max(0, currentMatch.closeTs - nowTs);
  }, [currentMatch, nowTs]);

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

  const ensureGoldBalanceViaSwapIfNeeded = async (
    goldMint: PublicKey,
  ): Promise<void> => {
    if (!wallet.publicKey || !programs) throw new Error("Wallet not connected");

    if (payAsset === "GOLD") return;
    if (getCluster() === "localnet") {
      throw new Error(
        "SOL/USDC conversion is mainnet-only in the UI. Use GOLD directly on localnet.",
      );
    }

    const amount = Number(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("Enter a valid amount");
    }

    const inputMint = payAsset === "SOL" ? SOL_MINT : USDC_MINT;
    const inputDecimals = payAsset === "SOL" ? 9 : 6;
    const inputAmount = BigInt(Math.floor(amount * 10 ** inputDecimals));

    setStatus(`Fetching Jupiter quote (${payAsset} -> GOLD)...`);
    const quote = await getJupiterQuote({
      inputMint: inputMint.toBase58(),
      outputMint: goldMint.toBase58(),
      amount: inputAmount,
      slippageBps: 100,
    });

    setStatus("Sending Jupiter swap transaction...");
    const swapSig = await swapToGoldViaJupiter({
      connection,
      wallet,
      quote,
    });

    setStatus(`Swap confirmed: ${swapSig}`);
  };

  const handleRefresh = () => {
    setRefreshNonce((value) => value + 1);
  };

  const handleStartNewRound = async () => {
    if (!programs || !wallet.publicKey) {
      setStatus("Wallet connection is required");
      return;
    }

    try {
      const fightProgram: any = programs.fightOracle;
      const marketProgram: any = programs.goldBinaryMarket;
      const oracleConfig = findOracleConfigPda(FIGHT_ORACLE_PROGRAM_ID);
      const matchId = Date.now();
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
      const yesVault = findYesVaultPda(
        GOLD_BINARY_MARKET_PROGRAM_ID,
        marketPda,
      );
      const noVault = findNoVaultPda(GOLD_BINARY_MARKET_PROGRAM_ID, marketPda);

      setStatus("Initializing oracle + creating new market...");
      await fightProgram.methods
        .initializeOracle()
        .accounts({
          authority: wallet.publicKey,
          oracleConfig,
        })
        .rpc();

      await fightProgram.methods
        .createMatch(
          matchIdBn,
          new BN(DEFAULT_NEW_ROUND_BET_WINDOW_SECONDS.toString()),
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
          market: marketPda,
          vaultAuthority,
          yesVault,
          noVault,
          goldMint: configuredGoldMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      autoSeededMarketsRef.current.delete(marketPda.toBase58());
      setStatus(`Created market for match ${matchId}`);
      setRefreshNonce((value) => value + 1);
    } catch (error) {
      setStatus(`Create round failed: ${(error as Error).message}`);
    }
  };

  const handleSeedIfEmpty = async (
    source: "manual" | "auto" = "manual",
  ): Promise<void> => {
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
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      setStatus("Market-maker liquidity seeded");
      setRefreshNonce((value) => value + 1);
    } catch (error) {
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
    if (!wallet.publicKey || !programs || !addresses || !currentMarketState) {
      setStatus("Wallet and active market are required");
      return;
    }

    try {
      const marketProgram: any = programs.goldBinaryMarket;
      const baseAmount = toBaseUnits(Number(amountInput), GOLD_DECIMALS);
      if (baseAmount <= 0n) {
        throw new Error("Bet amount must be > 0");
      }

      await ensureGoldBalanceViaSwapIfNeeded(marketGoldMint);

      const mintAccountInfo = await connection.getAccountInfo(
        marketGoldMint,
        "confirmed",
      );
      if (!mintAccountInfo) {
        throw new Error(
          `GOLD mint ${marketGoldMint.toBase58()} not found on ${getCluster()}`,
        );
      }

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

      setStatus("Placing bet on-chain...");
      await marketProgram.methods
        .placeBet(side === "YES" ? yesEnum() : noEnum(), toBnAmount(baseAmount))
        .accounts({
          bettor: wallet.publicKey,
          market: addresses.market,
          bettorGoldAta: goldAccount,
          vaultAuthority: addresses.vaultAuthority,
          yesVault: addresses.yesVault,
          noVault: addresses.noVault,
          position: positionPda,
          goldMint: marketGoldMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      setStatus("Bet placed");
      setRefreshNonce((value) => value + 1);
    } catch (error) {
      if (isMintLookupError(error)) {
        setStatus(
          `Place bet failed: configured GOLD mint is unavailable on ${getCluster()}`,
        );
        return;
      }
      setStatus(`Place bet failed: ${(error as Error).message}`);
    }
  };

  const handlePostResultAndResolve = async () => {
    if (!wallet.publicKey || !programs || !addresses || !currentMatch) {
      setStatus("Wallet and active market are required");
      return;
    }

    try {
      const fightProgram: any = programs.fightOracle;
      const marketProgram: any = programs.goldBinaryMarket;
      const oracleConfig = findOracleConfigPda(FIGHT_ORACLE_PROGRAM_ID);
      const seed = BigInt(Date.now());
      const result = simulateFight(seed);

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
      setStatus(`Resolve failed: ${(error as Error).message}`);
    }
  };

  const handleClaim = async () => {
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
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      setRefreshNonce((value) => value + 1);
      setStatus("Claim complete");
    } catch (error) {
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

  return (
    <div className="game-page">
      <header className="game-header">
        <div className="title-block">
          <p className="kicker">GOLD ARENA</p>
          <h1>Ultra Simple Fight Bet</h1>
          <p className="subtle">
            Pick YES or NO, wait for the fight, claim in GOLD.
          </p>
        </div>
        <div className="header-side">
          <span className="cluster-chip">{getCluster()}</span>
          <span className="refresh-chip">
            Auto refresh {Math.floor(DEFAULT_REFRESH_INTERVAL_MS / 1000)}s
          </span>
        </div>
        <WalletMultiButton />
      </header>

      <main className="game-main">
        <section className="arena-stage">
          <article
            className={[
              "fighter-card",
              "fighter-yes",
              side === "YES" ? "selected" : "",
              resolvedWinner === "YES" ? "winner" : "",
            ].join(" ")}
          >
            <p className="fighter-label">YES Fighter</p>
            <h2>Iron Bull</h2>
            <p className="fighter-score">{yesSharePercent}% support</p>
            <div className="share-bar">
              <span style={{ width: `${yesSharePercent}%` }} />
            </div>
            <p className="fighter-pot">
              {(yesPot / 10 ** GOLD_DECIMALS).toFixed(2)} GOLD
            </p>
            <button
              type="button"
              className="pick-button"
              onClick={() => setSide("YES")}
            >
              Pick YES
            </button>
          </article>

          <article className="arena-core">
            <p className="kicker">Live Round</p>
            <h2>Match #{currentMatch?.matchId ?? "-"}</h2>
            <p data-testid="countdown" className="countdown-pill">
              Countdown: {formatCountdown(remainingSeconds)}
            </p>
            <p className="subtle">
              Status:{" "}
              {currentMarketState
                ? marketStatusLabel(currentMarketState.status)
                : "NOT INITIALIZED"}
            </p>
            <p className="subtle">
              Last winner: {lastResolvedMatch?.winner ?? "-"}
            </p>
            <div className="row">
              <button data-testid="refresh-market" onClick={handleRefresh}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button
                data-testid="start-market"
                disabled={!isWalletReady(wallet)}
                onClick={handleStartNewRound}
              >
                Start New 5m Round
              </button>
              <button
                data-testid="seed-liquidity"
                disabled={!isWalletReady(wallet) || !addresses}
                onClick={() => void handleSeedIfEmpty("manual")}
              >
                Seed If Empty
              </button>
            </div>
          </article>

          <article
            className={[
              "fighter-card",
              "fighter-no",
              side === "NO" ? "selected" : "",
              resolvedWinner === "NO" ? "winner" : "",
            ].join(" ")}
          >
            <p className="fighter-label">NO Fighter</p>
            <h2>Night Lynx</h2>
            <p className="fighter-score">{noSharePercent}% support</p>
            <div className="share-bar">
              <span style={{ width: `${noSharePercent}%` }} />
            </div>
            <p className="fighter-pot">
              {(noPot / 10 ** GOLD_DECIMALS).toFixed(2)} GOLD
            </p>
            <button
              type="button"
              className="pick-button"
              onClick={() => setSide("NO")}
            >
              Pick NO
            </button>
          </article>
        </section>

        <section className="control-deck">
          <label>
            Side
            <select
              data-testid="side-select"
              value={side}
              onChange={(e) => setSide(e.target.value as BetSide)}
            >
              <option value="YES">YES</option>
              <option value="NO">NO</option>
            </select>
          </label>

          <label>
            Pay Asset
            <select
              data-testid="pay-asset-select"
              value={payAsset}
              onChange={(e) => setPayAsset(e.target.value as PayAsset)}
            >
              <option value="GOLD">GOLD</option>
              <option value="SOL">SOL (swap to GOLD)</option>
              <option value="USDC">USDC (swap to GOLD)</option>
            </select>
          </label>

          <label>
            Amount
            <input
              data-testid="amount-input"
              type="number"
              min="0"
              step="0.000001"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
          </label>

          <button
            data-testid="place-bet"
            disabled={!isWalletReady(wallet) || !addresses}
            onClick={handlePlaceBet}
          >
            Place Bet
          </button>

          <button
            data-testid="resolve-market"
            disabled={!isWalletReady(wallet) || !addresses}
            onClick={handlePostResultAndResolve}
          >
            Run Fight + Resolve
          </button>

          <button
            data-testid="claim-payout"
            disabled={!isWalletReady(wallet) || !addresses}
            onClick={handleClaim}
          >
            Claim
          </button>

          <p className="subtle">
            GOLD/USD: {goldPriceUsd ? `$${goldPriceUsd.toFixed(6)}` : "N/A"}
          </p>
        </section>

        <section className="log-card">
          <h3>Fight Feed</h3>
          {!fightResult && (
            <p className="subtle">
              No fight replay yet. Place bets, wait for countdown, then resolve.
            </p>
          )}
          {fightResult && (
            <ul className="events">
              {fightResult.events.slice(0, 12).map((event, idx) => (
                <li key={`${event.round}-${idx}`}>
                  R{event.round}: {event.attacker}{" "}
                  {event.hit ? `hit ${event.defender}` : "missed"}
                  {event.damage > 0 ? ` (${event.damage})` : ""}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="chain-card mono">
          <h3>On-chain Details</h3>
          <div data-testid="gold-mint">
            GOLD Mint: {configuredGoldMint.toBase58()}
          </div>
          <div data-testid="current-match-id">
            Current Match Id: {currentMatch?.matchId ?? "-"}
          </div>
          <div data-testid="current-match-pda">
            Current Match PDA: {addresses?.match.toBase58() ?? "-"}
          </div>
          <div data-testid="current-market-pda">
            Current Market PDA: {addresses?.market.toBase58() ?? "-"}
          </div>
          <div data-testid="market-status">
            Market Status:{" "}
            {currentMarketState
              ? marketStatusLabel(currentMarketState.status)
              : "NOT INITIALIZED"}
          </div>
          <div data-testid="bet-closes-at">
            Bet Closes At (UTC):{" "}
            {currentMatch ? formatUtc(currentMatch.closeTs) : "-"}
          </div>
          <div data-testid="last-result">
            Last Result:{" "}
            {lastResolvedMatch
              ? `match ${lastResolvedMatch.matchId} -> ${lastResolvedMatch.winner ?? "?"}`
              : "-"}
          </div>
          <div data-testid="last-resolved-at">
            Last Resolved At (UTC):{" "}
            {lastResolvedMatch ? formatUtc(lastResolvedMatch.resolvedTs) : "-"}
          </div>
          <p className="subtle">
            YES pool: {goldDisplay(yesPot)} GOLD | NO pool: {goldDisplay(noPot)}{" "}
            GOLD
          </p>
        </section>
      </main>

      <footer className="status" data-testid="status">
        {status}
      </footer>
    </div>
  );
}
