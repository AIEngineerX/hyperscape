"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Buffer } from "buffer";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";

type ArenaPhase =
  | "PREVIEW_CAMS"
  | "BET_OPEN"
  | "BET_LOCK"
  | "DUEL_ACTIVE"
  | "RESULT_SHOW"
  | "ORACLE_REPORT"
  | "MARKET_RESOLVE"
  | "RESTORE"
  | "COMPLETE";

type ArenaSide = "A" | "B";
type SourceAsset = "GOLD" | "SOL" | "USDC";

type ArenaRoundSnapshot = {
  id: string;
  roundSeedHex: string;
  phase: ArenaPhase;
  bettingOpensAt: number;
  bettingClosesAt: number;
  duelStartsAt: number | null;
  duelEndsAt: number | null;
  agentAId: string;
  agentBId: string;
  previewAgentAId: string | null;
  previewAgentBId: string | null;
  winnerId: string | null;
  damageA: number;
  damageB: number;
  market: {
    roundId: string;
    roundSeedHex: string;
    programId: string;
    mint: string;
    tokenProgram: string;
    marketPda: string;
    oraclePda: string;
    vaultAta: string;
    feeVaultAta: string;
    status: string;
    closeSlot: number | null;
    resolvedSlot: number | null;
    winnerSide: ArenaSide | null;
    poolA: string;
    poolB: string;
    feeBps: number;
  } | null;
};

type BetQuoteResponse = {
  roundId: string;
  side: ArenaSide;
  sourceAsset: SourceAsset;
  sourceAmount: string;
  expectedGoldAmount: string;
  minGoldAmount: string;
  swapQuote: Record<string, unknown> | null;
  market: NonNullable<ArenaRoundSnapshot["market"]>;
};

type StreamState = {
  state: string;
  cameraMode: "PREVIEW" | "DUEL";
  splitScreen: boolean;
  duelCameraLayout?: string;
  previewAgents: string[];
  activeDuelists?: string[];
};

type DepositAddressResponse = {
  roundId: string;
  side: ArenaSide;
  custodyWallet: string;
  custodyAta: string;
  mint: string;
  tokenProgram: string;
  memoTemplate: string;
};

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string };
  connect: () => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    tx: T,
  ) => Promise<T>;
};

const API_BASE = process.env.NEXT_PUBLIC_ARENA_API_BASE_URL ?? "";
const STREAM_EMBED_URL = process.env.NEXT_PUBLIC_ARENA_STREAM_EMBED_URL ?? "";
const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  "https://api.mainnet-beta.solana.com";
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID ??
    "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

function apiPath(path: string): string {
  return `${API_BASE}${path}`;
}

function parseDecimalToBaseUnits(value: string, decimals: number): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    throw new Error("Invalid decimal amount");
  }
  const [whole, fractionRaw = ""] = normalized.split(".");
  const fraction = fractionRaw.slice(0, decimals).padEnd(decimals, "0");
  const joined = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  return BigInt(joined || "0");
}

function shortId(value: string | null | undefined): string {
  if (!value) return "-";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function deriveAta(
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

async function anchorDiscriminator(ixName: string): Promise<Uint8Array> {
  const payload = new TextEncoder().encode(`global:${ixName}`);
  const hash = await crypto.subtle.digest("SHA-256", payload);
  return new Uint8Array(hash).slice(0, 8);
}

async function buildPlaceBetData(
  side: ArenaSide,
  amountGold: bigint,
): Promise<Buffer> {
  const discriminator = await anchorDiscriminator("place_bet");
  const data = Buffer.alloc(8 + 1 + 8);
  data.set(discriminator, 0);
  data.writeUInt8(side === "A" ? 1 : 2, 8);
  data.writeBigUInt64LE(amountGold, 9);
  return data;
}

async function buildClaimData(): Promise<Buffer> {
  const discriminator = await anchorDiscriminator("claim");
  const data = Buffer.alloc(8);
  data.set(discriminator, 0);
  return data;
}

function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const provider = (window as Window & { solana?: PhantomProvider }).solana;
  if (!provider?.isPhantom) return null;
  return provider;
}

export default function ArenaBettingPage() {
  const [round, setRound] = useState<ArenaRoundSnapshot | null>(null);
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [side, setSide] = useState<ArenaSide>("A");
  const [sourceAsset, setSourceAsset] = useState<SourceAsset>("GOLD");
  const [sourceAmount, setSourceAmount] = useState<string>("1");
  const [quote, setQuote] = useState<BetQuoteResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("Ready");
  const [claimTx, setClaimTx] = useState<string | null>(null);
  const [depositAddress, setDepositAddress] =
    useState<DepositAddressResponse | null>(null);
  const [depositSignature, setDepositSignature] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const connection = useMemo(() => new Connection(RPC_URL, "confirmed"), []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const refresh = useCallback(async () => {
    const [roundRes, streamRes] = await Promise.all([
      fetch(apiPath("/api/arena/current"), { cache: "no-store" }),
      fetch(apiPath("/api/arena/stream-state"), { cache: "no-store" }),
    ]);

    const roundJson = (await roundRes.json()) as {
      round: ArenaRoundSnapshot | null;
    };
    const streamJson = (await streamRes.json()) as StreamState;
    setRound(roundJson.round);
    setStreamState(streamJson);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const connectWallet = useCallback(async () => {
    const provider = getPhantomProvider();
    if (!provider) {
      setStatus("Phantom wallet not found");
      return;
    }
    const connected = await provider.connect();
    setWallet(connected.publicKey.toString());
    setStatus("Wallet connected");
  }, []);

  const disconnectWallet = useCallback(async () => {
    const provider = getPhantomProvider();
    if (!provider) return;
    await provider.disconnect();
    setWallet(null);
    setStatus("Wallet disconnected");
  }, []);

  const fetchQuote = useCallback(async () => {
    if (!round) return;
    setBusy(true);
    setStatus("Fetching quote...");
    try {
      const response = await fetch(apiPath("/api/arena/bet/quote"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: round.id,
          side,
          sourceAsset,
          sourceAmount,
          bettorWallet: wallet ?? "",
        }),
      });
      const payload = (await response.json()) as
        | { quote: BetQuoteResponse }
        | { error: string };
      if (!response.ok || !("quote" in payload)) {
        throw new Error("error" in payload ? payload.error : "Quote failed");
      }
      setQuote(payload.quote);
      setStatus("Quote ready");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Quote failed");
    } finally {
      setBusy(false);
    }
  }, [round, side, sourceAsset, sourceAmount, wallet]);

  const sendSignedTransaction = useCallback(
    async (
      transaction: Transaction | VersionedTransaction,
    ): Promise<string> => {
      const provider = getPhantomProvider();
      if (!provider || !wallet) {
        throw new Error("Wallet not connected");
      }

      const signed = await provider.signTransaction(transaction);
      const wire = signed.serialize();
      const signature = await connection.sendRawTransaction(wire, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await connection.confirmTransaction(signature, "confirmed");
      return signature;
    },
    [connection, wallet],
  );

  const buildPlaceBetTx = useCallback(
    async (goldAmount: string): Promise<Transaction> => {
      if (!round?.market || !wallet) {
        throw new Error("Round/market/wallet unavailable");
      }

      const bettor = new PublicKey(wallet);
      const programId = new PublicKey(round.market.programId);
      const mint = new PublicKey(round.market.mint);
      const tokenProgram = new PublicKey(round.market.tokenProgram);
      const marketPda = new PublicKey(round.market.marketPda);
      const vaultAta = new PublicKey(round.market.vaultAta);
      const [positionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position", "utf8"),
          marketPda.toBuffer(),
          bettor.toBuffer(),
        ],
        programId,
      );
      const bettorTokenAta = deriveAta(mint, bettor, tokenProgram);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: bettor, isSigner: true, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: marketPda, isSigner: false, isWritable: true },
          { pubkey: vaultAta, isSigner: false, isWritable: true },
          { pubkey: bettorTokenAta, isSigner: false, isWritable: true },
          { pubkey: positionPda, isSigner: false, isWritable: true },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
          {
            pubkey: SystemProgram.programId,
            isSigner: false,
            isWritable: false,
          },
        ],
        data: await buildPlaceBetData(
          side,
          parseDecimalToBaseUnits(goldAmount, 6),
        ),
      });

      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: bettor,
        recentBlockhash: latest.blockhash,
      }).add(ix);
      return tx;
    },
    [connection, round, side, wallet],
  );

  const runSwapIfNeeded = useCallback(
    async (currentQuote: BetQuoteResponse): Promise<string | null> => {
      if (!wallet) throw new Error("Wallet not connected");
      if (currentQuote.sourceAsset === "GOLD") return null;
      if (!currentQuote.swapQuote) {
        throw new Error("Missing swap quote for non-GOLD source asset");
      }

      const swapRes = await fetch("https://lite-api.jup.ag/swap/v1/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quoteResponse: currentQuote.swapQuote,
          userPublicKey: wallet,
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          prioritizationFeeLamports: "auto",
        }),
      });
      const swapJson = (await swapRes.json()) as {
        swapTransaction?: string;
        error?: string;
      };
      if (!swapRes.ok || !swapJson.swapTransaction) {
        throw new Error(swapJson.error ?? "Jupiter swap build failed");
      }

      const swapTx = VersionedTransaction.deserialize(
        Buffer.from(swapJson.swapTransaction, "base64"),
      );
      return sendSignedTransaction(swapTx);
    },
    [sendSignedTransaction, wallet],
  );

  const placeBet = useCallback(async () => {
    if (!round || !wallet) {
      setStatus("Connect wallet and wait for active round");
      return;
    }
    if (!quote) {
      setStatus("Fetch quote first");
      return;
    }

    setBusy(true);
    setStatus("Submitting bet...");
    try {
      const swapSignature = await runSwapIfNeeded(quote);
      if (swapSignature) {
        setStatus(`Swap confirmed: ${shortId(swapSignature)}`);
      }

      const betTx = await buildPlaceBetTx(quote.expectedGoldAmount);
      const betSignature = await sendSignedTransaction(betTx);

      const recordRes = await fetch(apiPath("/api/arena/bet/record"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: round.id,
          bettorWallet: wallet,
          side,
          sourceAsset,
          sourceAmount,
          goldAmount: quote.expectedGoldAmount,
          txSignature: betSignature,
          quoteJson: quote.swapQuote,
        }),
      });

      if (!recordRes.ok) {
        const payload = (await recordRes.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to record bet");
      }

      setStatus(`Bet confirmed: ${betSignature}`);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bet failed");
    } finally {
      setBusy(false);
    }
  }, [
    buildPlaceBetTx,
    quote,
    refresh,
    round,
    runSwapIfNeeded,
    sendSignedTransaction,
    side,
    sourceAmount,
    sourceAsset,
    wallet,
  ]);

  const claimWinnings = useCallback(async () => {
    if (!round || !wallet) {
      setStatus("Round and wallet required");
      return;
    }

    setBusy(true);
    setStatus("Building claim...");
    try {
      const claimRes = await fetch(apiPath("/api/arena/claim/build"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: round.id,
          bettorWallet: wallet,
        }),
      });
      const claimJson = (await claimRes.json()) as {
        claim?: {
          roundId: string;
          programId: string;
          mint: string;
          tokenProgram: string;
          marketPda: string;
          vaultAta: string;
          positionPda: string;
        };
        error?: string;
      };
      if (!claimRes.ok || !claimJson.claim) {
        throw new Error(claimJson.error ?? "Claim build failed");
      }

      const bettor = new PublicKey(wallet);
      const programId = new PublicKey(claimJson.claim.programId);
      const mint = new PublicKey(claimJson.claim.mint);
      const tokenProgram = new PublicKey(claimJson.claim.tokenProgram);
      const destinationAta = deriveAta(mint, bettor, tokenProgram);

      const ix = new TransactionInstruction({
        programId,
        keys: [
          { pubkey: bettor, isSigner: true, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          {
            pubkey: new PublicKey(claimJson.claim.marketPda),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: new PublicKey(claimJson.claim.vaultAta),
            isSigner: false,
            isWritable: true,
          },
          {
            pubkey: new PublicKey(claimJson.claim.positionPda),
            isSigner: false,
            isWritable: true,
          },
          { pubkey: destinationAta, isSigner: false, isWritable: true },
          { pubkey: tokenProgram, isSigner: false, isWritable: false },
        ],
        data: await buildClaimData(),
      });

      const latest = await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction({
        feePayer: bettor,
        recentBlockhash: latest.blockhash,
      }).add(ix);

      const signature = await sendSignedTransaction(tx);
      setClaimTx(signature);
      setStatus(`Claim confirmed: ${signature}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Claim failed");
    } finally {
      setBusy(false);
    }
  }, [connection, round, sendSignedTransaction, wallet]);

  const loadDepositAddress = useCallback(async () => {
    if (!round) return;
    setBusy(true);
    setStatus("Loading deposit address...");
    try {
      const url = new URL(
        apiPath("/api/arena/deposit/address"),
        window.location.origin,
      );
      url.searchParams.set("roundId", round.id);
      url.searchParams.set("side", side);
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Failed to load deposit address");
      }
      const payload = (await response.json()) as DepositAddressResponse;
      setDepositAddress(payload);
      setStatus("Deposit address loaded");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Failed to load deposit address",
      );
    } finally {
      setBusy(false);
    }
  }, [round, side]);

  const ingestDeposit = useCallback(async () => {
    if (!round) return;
    if (!depositSignature.trim()) {
      setStatus("Enter a deposit tx signature");
      return;
    }

    setBusy(true);
    setStatus("Ingesting deposit...");
    try {
      const response = await fetch(apiPath("/api/arena/deposit/ingest"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: round.id,
          side,
          txSignature: depositSignature.trim(),
        }),
      });
      const payload = (await response.json()) as
        | {
            settled: {
              settleSignature: string;
              bettorWallet: string;
              goldAmount: string;
            };
          }
        | { error: string };

      if (!response.ok || !("settled" in payload)) {
        throw new Error(
          "error" in payload ? payload.error : "Deposit ingest failed",
        );
      }

      setStatus(
        `Deposit settled: ${payload.settled.goldAmount} GOLD for ${shortId(payload.settled.bettorWallet)} (${shortId(payload.settled.settleSignature)})`,
      );
      setDepositSignature("");
      await refresh();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Deposit ingest failed",
      );
    } finally {
      setBusy(false);
    }
  }, [depositSignature, refresh, round, side]);

  const countdownLabel = useMemo(() => {
    if (!round) return "No active arena round";
    const target =
      round.phase === "PREVIEW_CAMS"
        ? round.bettingOpensAt
        : round.phase === "BET_OPEN"
          ? round.bettingClosesAt
          : round.phase === "DUEL_ACTIVE" && round.duelStartsAt
            ? round.duelStartsAt + 300_000
            : null;
    if (!target) return "";
    const diffMs = Math.max(0, target - now);
    const seconds = Math.floor(diffMs / 1000);
    const mm = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const ss = (seconds % 60).toString().padStart(2, "0");
    if (round.phase === "PREVIEW_CAMS") return `Bet opens in ${mm}:${ss}`;
    if (round.phase === "BET_OPEN") return `Bet closes in ${mm}:${ss}`;
    if (round.phase === "DUEL_ACTIVE") return `Duel max timer ${mm}:${ss}`;
    return "";
  }, [now, round]);

  const bettingOpen =
    round?.phase === "BET_OPEN" || round?.phase === "BET_LOCK";

  return (
    <main className="min-h-screen bg-[var(--bg-depth)] text-[var(--text-primary)]">
      <section className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">
        <header className="mb-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--glass-surface)] p-4 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="font-display text-3xl text-gradient-gold">
                Arena Betting
              </h1>
              <p className="text-sm text-[var(--text-secondary)]">
                Stream-only duels run continuously. Betting is handled here on
                Solana and settles in GOLD.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {wallet ? (
                <>
                  <span className="rounded-full border border-[var(--border-bronze)] px-3 py-1 text-xs">
                    {shortId(wallet)}
                  </span>
                  <button
                    className="btn-secondary px-3 py-2 text-sm"
                    onClick={() => void disconnectWallet()}
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  className="btn-primary px-4 py-2 text-sm"
                  onClick={() => void connectWallet()}
                >
                  Connect Phantom
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              {STREAM_EMBED_URL ? (
                <iframe
                  src={STREAM_EMBED_URL}
                  title="Hyperscape Arena Stream"
                  className="h-[360px] w-full rounded-xl border border-[var(--border-subtle)] md:h-[460px]"
                  allow="autoplay; encrypted-media; picture-in-picture"
                />
              ) : (
                <div className="flex h-[360px] w-full items-center justify-center rounded-xl border border-dashed border-[var(--border-subtle)] md:h-[460px]">
                  <span className="text-sm text-[var(--text-muted)]">
                    Set NEXT_PUBLIC_ARENA_STREAM_EMBED_URL to show
                    Twitch/YouTube live feed.
                  </span>
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  Preview Camera A
                </p>
                <p className="mt-2 font-mono text-sm">
                  {shortId(
                    round?.previewAgentAId ?? streamState?.previewAgents?.[0],
                  )}
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
                <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                  Preview Camera B
                </p>
                <p className="mt-2 font-mono text-sm">
                  {shortId(
                    round?.previewAgentBId ?? streamState?.previewAgents?.[1],
                  )}
                </p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Round
              </p>
              <p className="mt-1 font-mono text-sm">
                {round ? round.id : "No active round"}
              </p>
              <p className="mt-2 text-sm">
                Phase: <strong>{round?.phase ?? "IDLE"}</strong>
              </p>
              {countdownLabel ? (
                <p className="mt-1 text-sm text-[var(--gold-essence)]">
                  {countdownLabel}
                </p>
              ) : null}
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Camera: {streamState?.cameraMode ?? "PREVIEW"} /{" "}
                {streamState?.duelCameraLayout ?? "SIDE_BY_SIDE"}
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Duelists
              </p>
              <div className="mt-2 grid gap-2 text-sm">
                <p>A: {shortId(round?.agentAId)}</p>
                <p>B: {shortId(round?.agentBId)}</p>
                <p>Winner: {shortId(round?.winnerId)}</p>
                <p>
                  Damage A/B: {round?.damageA ?? 0} / {round?.damageB ?? 0}
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Pools (GOLD)
              </p>
              <p className="mt-2 text-sm">
                A Pool: {round?.market?.poolA ?? "0"}
              </p>
              <p className="text-sm">B Pool: {round?.market?.poolB ?? "0"}</p>
              <p className="text-xs text-[var(--text-muted)]">
                Fee: {(round?.market?.feeBps ?? 0) / 100}%
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Place Bet
              </p>
              <div className="mt-3 grid gap-3">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className={`rounded-md border px-3 py-2 text-sm ${
                      side === "A"
                        ? "border-[var(--gold-essence)] bg-[var(--glass-highlight)]"
                        : "border-[var(--border-subtle)]"
                    }`}
                    onClick={() => setSide("A")}
                    type="button"
                  >
                    Side A
                  </button>
                  <button
                    className={`rounded-md border px-3 py-2 text-sm ${
                      side === "B"
                        ? "border-[var(--gold-essence)] bg-[var(--glass-highlight)]"
                        : "border-[var(--border-subtle)]"
                    }`}
                    onClick={() => setSide("B")}
                    type="button"
                  >
                    Side B
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-depth)] px-3 py-2 text-sm"
                    value={sourceAsset}
                    onChange={(event) =>
                      setSourceAsset(event.target.value as SourceAsset)
                    }
                  >
                    <option value="GOLD">GOLD</option>
                    <option value="SOL">SOL</option>
                    <option value="USDC">USDC</option>
                  </select>
                  <input
                    className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-depth)] px-3 py-2 text-sm"
                    value={sourceAmount}
                    onChange={(event) => setSourceAmount(event.target.value)}
                    placeholder="Amount"
                    inputMode="decimal"
                  />
                </div>

                <button
                  className="btn-secondary px-3 py-2 text-sm"
                  onClick={() => void fetchQuote()}
                  disabled={!round || !bettingOpen || busy}
                >
                  Get Quote
                </button>

                {quote ? (
                  <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-depth)] p-3 text-xs">
                    <p>
                      Expected GOLD: <strong>{quote.expectedGoldAmount}</strong>
                    </p>
                    <p>Minimum GOLD: {quote.minGoldAmount}</p>
                    <p>Asset: {quote.sourceAsset}</p>
                    {quote.sourceAsset !== "GOLD" ? (
                      <p className="text-[var(--text-muted)]">
                        Auto-convert via Jupiter executes before bet placement.
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <button
                  className="btn-primary px-4 py-2 text-sm"
                  onClick={() => void placeBet()}
                  disabled={!quote || !wallet || !bettingOpen || busy}
                >
                  {busy ? "Processing..." : "Place Bet"}
                </button>

                <button
                  className="btn-secondary px-3 py-2 text-sm"
                  onClick={() => void claimWinnings()}
                  disabled={!wallet || !round?.winnerId || busy}
                >
                  Claim Winnings
                </button>

                <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-depth)] p-3 text-xs">
                  <p className="mb-2 font-semibold text-[var(--text-secondary)]">
                    Direct Wallet Transfer Mode
                  </p>
                  <p>1. Send GOLD to custody ATA for this side.</p>
                  <p>
                    2. Include memo:{" "}
                    <code>{depositAddress?.memoTemplate ?? "-"}</code>
                  </p>
                  <p>3. Paste tx signature and ingest.</p>
                  <button
                    className="btn-secondary mt-2 px-3 py-2 text-xs"
                    onClick={() => void loadDepositAddress()}
                    disabled={!round || !bettingOpen || busy}
                  >
                    Load Deposit Address
                  </button>
                  {depositAddress ? (
                    <div className="mt-2 space-y-1 break-all">
                      <p>Custody ATA: {depositAddress.custodyAta}</p>
                      <p>Custody Wallet: {depositAddress.custodyWallet}</p>
                    </div>
                  ) : null}
                  <input
                    className="mt-2 w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-2 text-xs"
                    placeholder="Deposit tx signature"
                    value={depositSignature}
                    onChange={(event) =>
                      setDepositSignature(event.target.value)
                    }
                  />
                  <button
                    className="btn-primary mt-2 px-3 py-2 text-xs"
                    onClick={() => void ingestDeposit()}
                    disabled={!round || !bettingOpen || busy}
                  >
                    Ingest Deposit Tx
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
                Status
              </p>
              <p className="mt-2 break-all text-sm">{status}</p>
              {claimTx ? (
                <p className="mt-2 break-all text-xs">Claim TX: {claimTx}</p>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
