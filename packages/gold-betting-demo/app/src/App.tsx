import { useEffect, useMemo, useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

import {
  DEFAULT_AUTO_SEED_DELAY_SECONDS,
  DEFAULT_BET_WINDOW_SECONDS,
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
  noEnum,
  toBnAmount,
  yesEnum,
} from "./lib/programs";
import {
  findMarketPda,
  findMatchPda,
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

type PayAsset = "GOLD" | "SOL" | "USDC";
type BetSide = "YES" | "NO";

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

export function App() {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [matchIdInput, setMatchIdInput] = useState<string>(String(Date.now()));
  const [goldMintInput, setGoldMintInput] = useState<string>(
    GOLD_MAINNET_MINT.toBase58(),
  );
  const [amountInput, setAmountInput] = useState<string>("1");
  const [side, setSide] = useState<BetSide>("YES");
  const [payAsset, setPayAsset] = useState<PayAsset>("GOLD");
  const [status, setStatus] = useState<string>("Connect wallet to start");
  const [fightResult, setFightResult] = useState<FightResult | null>(null);
  const [goldPriceUsd, setGoldPriceUsd] = useState<number | null>(null);

  const [matchPda, setMatchPda] = useState<PublicKey | null>(null);
  const [marketPda, setMarketPda] = useState<PublicKey | null>(null);
  const [marketState, setMarketState] = useState<any>(null);
  const [matchState, setMatchState] = useState<any>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));

  const programs = useMemo(() => {
    if (!isWalletReady(wallet)) return null;
    return createPrograms(connection, wallet);
  }, [connection, wallet]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTs(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    void (async () => {
      const price = await fetchGoldPriceUsd(goldMintInput);
      setGoldPriceUsd(price);
    })();
  }, [goldMintInput]);

  const remainingSeconds = useMemo(() => {
    if (!matchState?.betCloseTs) return 0;
    const close = normalizeTimestamp(Number(matchState.betCloseTs.toString()));
    return Math.max(0, close - nowTs);
  }, [matchState, nowTs]);

  const addresses = useMemo(() => {
    try {
      const matchIdBn = new BN(matchIdInput || "0");
      const match = findMatchPda(FIGHT_ORACLE_PROGRAM_ID, matchIdBn);
      const market = findMarketPda(GOLD_BINARY_MARKET_PROGRAM_ID, match);
      const vaultAuthority = findVaultAuthorityPda(
        GOLD_BINARY_MARKET_PROGRAM_ID,
        market,
      );
      const yesVault = findYesVaultPda(GOLD_BINARY_MARKET_PROGRAM_ID, market);
      const noVault = findNoVaultPda(GOLD_BINARY_MARKET_PROGRAM_ID, market);
      return { matchIdBn, match, market, vaultAuthority, yesVault, noVault };
    } catch {
      return null;
    }
  }, [matchIdInput]);

  useEffect(() => {
    if (!programs || !addresses) return;
    if (!matchPda || !marketPda) return;

    void (async () => {
      try {
        const [onchainMatch, onchainMarket] = await Promise.all([
          (programs.fightOracle.account as any).matchResult.fetch(matchPda),
          (programs.goldBinaryMarket.account as any).market.fetch(marketPda),
        ]);
        setMatchState(onchainMatch);
        setMarketState(onchainMarket);
      } catch {
        setMatchState(null);
        setMarketState(null);
      }
    })();
  }, [programs, matchPda, marketPda, refreshNonce, addresses]);

  const ensureMarketBindings = () => {
    if (!addresses) {
      throw new Error("Invalid match id");
    }

    setMatchPda(addresses.match);
    setMarketPda(addresses.market);
    return addresses;
  };

  const handleLoadAddresses = () => {
    try {
      const next = ensureMarketBindings();
      setStatus(
        `Loaded match ${next.match.toBase58()} and market ${next.market.toBase58()}`,
      );
      setRefreshNonce((x) => x + 1);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const handleCreateMarket = async () => {
    if (!programs || !wallet.publicKey || !addresses) {
      setStatus("Wallet and match id are required");
      return;
    }

    try {
      const fightProgram: any = programs.fightOracle;
      const marketProgram: any = programs.goldBinaryMarket;
      setStatus("Initializing oracle + market...");
      const oracleConfig = findOracleConfigPda(FIGHT_ORACLE_PROGRAM_ID);
      const marketMakerPubkey = wallet.publicKey;
      const goldMint = new PublicKey(goldMintInput);

      await fightProgram.methods
        .initializeOracle()
        .accounts({
          authority: wallet.publicKey,
          oracleConfig,
        })
        .rpc();

      await fightProgram.methods
        .createMatch(addresses.matchIdBn, new BN(DEFAULT_BET_WINDOW_SECONDS))
        .accounts({
          authority: wallet.publicKey,
          oracleConfig,
          matchResult: addresses.match,
        })
        .rpc();

      await marketProgram.methods
        .initializeMarket(new BN(DEFAULT_AUTO_SEED_DELAY_SECONDS))
        .accounts({
          payer: wallet.publicKey,
          marketMaker: marketMakerPubkey,
          oracleMatch: addresses.match,
          market: addresses.market,
          vaultAuthority: addresses.vaultAuthority,
          yesVault: addresses.yesVault,
          noVault: addresses.noVault,
          goldMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      setMatchPda(addresses.match);
      setMarketPda(addresses.market);
      setRefreshNonce((x) => x + 1);
      setStatus("Market created successfully");
    } catch (error) {
      setStatus(`Create market failed: ${(error as Error).message}`);
    }
  };

  const ensureGoldBalanceViaSwapIfNeeded = async (): Promise<void> => {
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
      outputMint: goldMintInput,
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

  const handlePlaceBet = async () => {
    if (!wallet.publicKey || !programs || !addresses || !marketPda) {
      setStatus("Wallet and market are required");
      return;
    }

    try {
      const marketProgram: any = programs.goldBinaryMarket;
      const goldMint = new PublicKey(goldMintInput);
      const baseAmount = toBaseUnits(Number(amountInput), GOLD_DECIMALS);
      if (baseAmount <= 0n) {
        throw new Error("Bet amount must be > 0");
      }

      await ensureGoldBalanceViaSwapIfNeeded();

      const goldAccount = await findAnyGoldAccount(
        connection,
        wallet.publicKey,
        goldMint,
      );
      if (!goldAccount) {
        throw new Error("No GOLD token account found in wallet");
      }

      const positionPda = findPositionPda(
        GOLD_BINARY_MARKET_PROGRAM_ID,
        marketPda,
        wallet.publicKey,
      );

      setStatus("Placing bet on-chain...");
      await marketProgram.methods
        .placeBet(side === "YES" ? yesEnum() : noEnum(), toBnAmount(baseAmount))
        .accounts({
          bettor: wallet.publicKey,
          market: marketPda,
          bettorGoldAta: goldAccount,
          vaultAuthority: addresses.vaultAuthority,
          yesVault: addresses.yesVault,
          noVault: addresses.noVault,
          position: positionPda,
          goldMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      setStatus("Bet placed");
      setRefreshNonce((x) => x + 1);
    } catch (error) {
      setStatus(`Place bet failed: ${(error as Error).message}`);
    }
  };

  const handlePostResultAndResolve = async () => {
    if (!wallet.publicKey || !programs || !matchPda || !marketPda) {
      setStatus("Wallet and market are required");
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
          matchResult: matchPda,
        })
        .rpc();

      setStatus("Resolving market from oracle...");
      await marketProgram.methods
        .resolveFromOracle()
        .accounts({
          resolver: wallet.publicKey,
          market: marketPda,
          oracleMatch: matchPda,
        })
        .rpc();

      setFightResult(result);
      setRefreshNonce((x) => x + 1);
      setStatus(`Resolved. Winner: ${result.winner === "A" ? "YES" : "NO"}`);
    } catch (error) {
      setStatus(`Resolve failed: ${(error as Error).message}`);
    }
  };

  const handleClaim = async () => {
    if (!wallet.publicKey || !programs || !marketPda || !addresses) {
      setStatus("Wallet and market are required");
      return;
    }

    try {
      const marketProgram: any = programs.goldBinaryMarket;
      const goldMint = new PublicKey(goldMintInput);
      const goldAccount = await findAnyGoldAccount(
        connection,
        wallet.publicKey,
        goldMint,
      );
      if (!goldAccount) {
        throw new Error("No GOLD token account found in wallet");
      }

      const positionPda = findPositionPda(
        GOLD_BINARY_MARKET_PROGRAM_ID,
        marketPda,
        wallet.publicKey,
      );

      setStatus("Claiming payout...");
      await marketProgram.methods
        .claim()
        .accounts({
          bettor: wallet.publicKey,
          market: marketPda,
          position: positionPda,
          bettorGoldAta: goldAccount,
          vaultAuthority: addresses.vaultAuthority,
          yesVault: addresses.yesVault,
          noVault: addresses.noVault,
          goldMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();

      setRefreshNonce((x) => x + 1);
      setStatus("Claim complete");
    } catch (error) {
      setStatus(`Claim failed: ${(error as Error).message}`);
    }
  };

  return (
    <div className="page">
      <header className="hero">
        <div>
          <h1>GOLD Binary Fight Market</h1>
          <p>
            5-minute YES/NO market. Oracle result settles payouts in GOLD.
            Cluster: {getCluster()}
          </p>
        </div>
        <WalletMultiButton />
      </header>

      <main className="grid">
        <section className="card">
          <h2>Market Setup</h2>
          <label>
            Match Id
            <input
              value={matchIdInput}
              onChange={(e) => setMatchIdInput(e.target.value)}
              placeholder="Numeric match id"
            />
          </label>

          <label>
            GOLD Mint
            <input
              value={goldMintInput}
              onChange={(e) => setGoldMintInput(e.target.value)}
              placeholder="GOLD mint"
            />
          </label>

          <div className="row">
            <button onClick={handleLoadAddresses}>Load Existing</button>
            <button
              disabled={!isWalletReady(wallet)}
              onClick={handleCreateMarket}
            >
              Create New Market
            </button>
          </div>

          <div className="mono">
            <div>Match PDA: {addresses?.match.toBase58() ?? "-"}</div>
            <div>Market PDA: {addresses?.market.toBase58() ?? "-"}</div>
            <div>Program (Oracle): {FIGHT_ORACLE_PROGRAM_ID.toBase58()}</div>
            <div>
              Program (Market): {GOLD_BINARY_MARKET_PROGRAM_ID.toBase58()}
            </div>
          </div>
        </section>

        <section className="card">
          <h2>Place Bet</h2>

          <label>
            Side
            <select
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
              type="number"
              min="0"
              step="0.000001"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
            />
          </label>

          <button disabled={!isWalletReady(wallet)} onClick={handlePlaceBet}>
            Place Bet
          </button>

          <p className="subtle">
            GOLD/USD: {goldPriceUsd ? `$${goldPriceUsd.toFixed(6)}` : "N/A"}
          </p>
        </section>

        <section className="card">
          <h2>Resolution</h2>
          <p>Countdown: {formatCountdown(remainingSeconds)}</p>

          <div className="row">
            <button
              disabled={!isWalletReady(wallet)}
              onClick={handlePostResultAndResolve}
            >
              Run Fight + Resolve
            </button>
            <button disabled={!isWalletReady(wallet)} onClick={handleClaim}>
              Claim
            </button>
          </div>

          {marketState && (
            <div className="mono">
              <div>
                User YES: {marketState.userYesTotal?.toString?.() ?? "-"}
              </div>
              <div>User NO: {marketState.userNoTotal?.toString?.() ?? "-"}</div>
              <div>
                Maker YES: {marketState.makerYesTotal?.toString?.() ?? "-"}
              </div>
              <div>
                Maker NO: {marketState.makerNoTotal?.toString?.() ?? "-"}
              </div>
            </div>
          )}

          {fightResult && (
            <div>
              <h3>Fight Events ({fightResult.events.length})</h3>
              <ul className="events">
                {fightResult.events.slice(0, 12).map((event, idx) => (
                  <li key={`${event.round}-${idx}`}>
                    R{event.round}: {event.attacker}{" "}
                    {event.hit ? `hit ${event.defender}` : "missed"}
                    {event.damage > 0 ? ` (${event.damage})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>

      <footer className="status">{status}</footer>
    </div>
  );
}
