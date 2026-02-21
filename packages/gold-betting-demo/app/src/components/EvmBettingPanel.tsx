/**
 * EvmBettingPanel — EVM-specific betting panel for GoldClob contract.
 * Handles simple A/B order placement on BSC / Base.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWalletClient } from "wagmi";
import {
  createWalletClient,
  http,
  type Address,
  formatUnits,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { useChain } from "../lib/ChainContext";
import { getEvmChainConfig } from "../lib/chainConfig";
import { GAME_API_URL, buildArenaWriteHeaders } from "../lib/config";
import { getStoredInviteCode } from "../lib/invite";
import {
  claimWinnings,
  createEvmPublicClient,
  createMatch,
  getMatchMeta,
  getPosition,
  getNextMatchId,
  getBestBid,
  getBestAsk,
  getGoldBalance,
  getGoldAllowance,
  getGoldDecimals,
  approveGoldToken,
  placeOrder,
  resolveMatch,
  type MatchMeta,
  type Position,
} from "../lib/evmClient";

// ============================================================================
// Types
// ============================================================================

type BetSide = "YES" | "NO";
const REFERRAL_ACCOUNTING_FEE_BPS = 100;

function normalizePrivateKey(value: string): `0x${string}` | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withPrefix = trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(withPrefix)) return null;
  return withPrefix as `0x${string}`;
}

// ============================================================================
// Component
// ============================================================================

export function EvmBettingPanel() {
  const { activeChain } = useChain();
  const { address } = useAccount();
  const connectedChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const isE2eMode = import.meta.env.MODE === "e2e";

  const chainConfig = useMemo(
    () =>
      activeChain === "bsc" || activeChain === "base"
        ? getEvmChainConfig(activeChain)
        : null,
    [activeChain],
  );

  const e2ePrivateKey = normalizePrivateKey(
    (import.meta.env.VITE_E2E_EVM_PRIVATE_KEY as string | undefined) ?? "",
  );

  const e2eAccount = useMemo(() => {
    if (!e2ePrivateKey) return null;
    try {
      return privateKeyToAccount(e2ePrivateKey);
    } catch {
      return null;
    }
  }, [e2ePrivateKey]);

  const e2eWalletClient = useMemo(() => {
    if (!chainConfig || !e2eAccount) return null;
    return createWalletClient({
      account: e2eAccount,
      chain: chainConfig.wagmiChain,
      transport: http(chainConfig.rpcUrl),
    });
  }, [chainConfig, e2eAccount]);

  const effectiveWalletClient = walletClient ?? e2eWalletClient;
  const effectiveAddress = (address ?? e2eAccount?.address) as
    | Address
    | undefined;
  const walletConnected = Boolean(effectiveWalletClient && effectiveAddress);

  const [status, setStatus] = useState("Connect wallet to place bet");
  const [matchId, setMatchId] = useState<bigint>(1n);
  const [matchMeta, setMatchMeta] = useState<MatchMeta | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [goldBalance, setGoldBalance] = useState<bigint>(0n);
  const [goldDecimals, setGoldDecimals] = useState(18);
  const [bestBid, setBestBid] = useState(0);
  const [bestAsk, setBestAsk] = useState(1000);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [lastApprovalTx, setLastApprovalTx] = useState("-");
  const [lastOrderTx, setLastOrderTx] = useState("-");
  const [lastCreateTx, setLastCreateTx] = useState("-");
  const [lastResolveTx, setLastResolveTx] = useState("-");
  const [lastClaimTx, setLastClaimTx] = useState("-");

  // Form state
  const [side, setSide] = useState<BetSide>("YES");
  const [amountInput, setAmountInput] = useState("1");

  const isWrongChain = e2eWalletClient
    ? false
    : chainConfig
      ? connectedChainId !== chainConfig.evmChainId
      : false;
  const shortAddress = effectiveAddress
    ? `${effectiveAddress.slice(0, 6)}...${effectiveAddress.slice(-4)}`
    : null;

  const publicClient = useMemo(() => {
    if (!chainConfig) return null;
    return createEvmPublicClient(chainConfig);
  }, [chainConfig]);

  useEffect(() => {
    if (walletConnected && status === "Connect wallet to place bet") {
      setStatus("Wallet connected");
    }
  }, [walletConnected, status]);

  // ============================================================================
  // Data loading
  // ============================================================================

  const refreshData = useCallback(async () => {
    if (!publicClient || !chainConfig) return;
    setIsRefreshing(true);

    try {
      const contractAddr = chainConfig.goldClobAddress as Address;
      const tokenAddr = chainConfig.goldTokenAddress as Address;

      // Get latest match ID
      const nextId = await getNextMatchId(publicClient, contractAddr);
      const currentMatchId = nextId > 1n ? nextId - 1n : 1n;
      setMatchId(currentMatchId);

      // Get match meta
      const meta = await getMatchMeta(
        publicClient,
        contractAddr,
        currentMatchId,
      );
      setMatchMeta(meta);

      // Get best bid/ask
      const bid = await getBestBid(publicClient, contractAddr, currentMatchId);
      const ask = await getBestAsk(publicClient, contractAddr, currentMatchId);
      setBestBid(bid);
      setBestAsk(ask);

      // Get token decimals
      const decimals = await getGoldDecimals(publicClient, tokenAddr);
      setGoldDecimals(decimals);

      // User-specific data
      if (effectiveAddress) {
        const pos = await getPosition(
          publicClient,
          contractAddr,
          currentMatchId,
          effectiveAddress,
        );
        setPosition(pos);

        const bal = await getGoldBalance(
          publicClient,
          tokenAddr,
          effectiveAddress,
        );
        setGoldBalance(bal);
      }
    } catch (err) {
      console.error("[EvmBettingPanel] refresh failed:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [publicClient, chainConfig, effectiveAddress]);

  useEffect(() => {
    void refreshData();
    const id = setInterval(() => void refreshData(), 5000);
    return () => clearInterval(id);
  }, [refreshData]);

  // ============================================================================
  // Actions
  // ============================================================================

  const handleSwitchChain = async () => {
    if (!chainConfig) return;
    if (e2eWalletClient) {
      setStatus("Headless EVM wallet is pinned to configured RPC");
      return;
    }
    try {
      await switchChainAsync({ chainId: chainConfig.evmChainId });
    } catch (err) {
      setStatus(`Chain switch failed: ${(err as Error).message}`);
    }
  };

  const handleCreateMatch = async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !publicClient
    ) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      const contractAddr = chainConfig.goldClobAddress as Address;
      setStatus("Creating match...");
      const tx = await createMatch(
        effectiveWalletClient,
        contractAddr,
        effectiveAddress,
      );
      setLastCreateTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("Match created");
      void refreshData();
    } catch (err) {
      setStatus(`Create match failed: ${(err as Error).message}`);
    }
  };

  const handleResolveYes = async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !publicClient
    ) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      const contractAddr = chainConfig.goldClobAddress as Address;
      setStatus("Resolving match (YES)...");
      const tx = await resolveMatch(
        effectiveWalletClient,
        contractAddr,
        matchId,
        1,
        effectiveAddress,
      );
      setLastResolveTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("Match resolved");
      void refreshData();
    } catch (err) {
      setStatus(`Resolve failed: ${(err as Error).message}`);
    }
  };

  const handleClaim = async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !publicClient
    ) {
      setStatus("Wallet not connected");
      return;
    }

    try {
      const contractAddr = chainConfig.goldClobAddress as Address;
      setStatus("Claiming winnings...");
      const tx = await claimWinnings(
        effectiveWalletClient,
        contractAddr,
        matchId,
        effectiveAddress,
      );
      setLastClaimTx(tx);
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setStatus("Claim complete");
      void refreshData();
    } catch (err) {
      setStatus(`Claim failed: ${(err as Error).message}`);
    }
  };

  const handlePlaceOrder = async () => {
    if (
      !effectiveWalletClient ||
      !effectiveAddress ||
      !chainConfig ||
      !publicClient
    ) {
      setStatus("Wallet not connected");
      return;
    }

    const contractAddr = chainConfig.goldClobAddress as Address;
    const tokenAddr = chainConfig.goldTokenAddress as Address;
    const price = executionPrice;

    try {
      const amount = parseUnits(amountInput, goldDecimals);
      if (amount <= 0n) {
        setStatus("Amount must be > 0");
        return;
      }

      // Calculate cost
      const isBuy = side === "YES";
      const costPrice = BigInt(isBuy ? price : 1000 - price);
      const cost = (amount * costPrice) / 1000n;

      // Check and approve allowance
      const currentAllowance = await getGoldAllowance(
        publicClient,
        tokenAddr,
        effectiveAddress,
        contractAddr,
      );

      if (currentAllowance < cost) {
        setStatus("Approving GOLD token...");
        const approveTx = await approveGoldToken(
          effectiveWalletClient,
          tokenAddr,
          contractAddr,
          cost * 2n, // Approve 2x for convenience
          effectiveAddress,
        );
        setLastApprovalTx(approveTx);
        setStatus(`Approval sent: ${approveTx.slice(0, 10)}...`);
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      setStatus("Placing order...");
      const tx = await placeOrder(
        effectiveWalletClient,
        contractAddr,
        matchId,
        isBuy,
        price,
        amount,
        effectiveAddress,
      );
      setLastOrderTx(tx);
      setStatus(`Order sent: ${tx.slice(0, 10)}...`);
      await publicClient.waitForTransactionReceipt({ hash: tx });

      let trackingError: string | null = null;
      try {
        const response = await fetch(
          `${GAME_API_URL}/api/arena/bet/record-external`,
          {
            method: "POST",
            headers: buildArenaWriteHeaders(),
            body: JSON.stringify({
              bettorWallet: effectiveAddress,
              chain: chainConfig.chainId === "bsc" ? "BSC" : "BASE",
              sourceAsset: "GOLD",
              sourceAmount: amountInput,
              goldAmount: amountInput,
              feeBps: REFERRAL_ACCOUNTING_FEE_BPS,
              txSignature: tx,
              inviteCode: getStoredInviteCode(),
              externalBetRef: `evm:${chainConfig.chainId}:match:${matchId.toString()}`,
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
          : "Order placed!",
      );
      void refreshData();
    } catch (err) {
      setStatus(`Order failed: ${(err as Error).message}`);
    }
  };

  // ============================================================================
  // Render
  // ============================================================================

  if (!chainConfig) {
    return (
      <div
        style={{
          background: "rgba(0,0,0,0.65)",
          padding: 24,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
          color: "#fff",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <div
          style={{
            color: "rgba(255,255,255,0.78)",
            fontSize: 13,
            lineHeight: 1.45,
          }}
        >
          {activeChain.toUpperCase()} market unavailable right now.
        </div>
      </div>
    );
  }

  const yesPool = matchMeta
    ? Number(formatUnits(matchMeta.yesPool, goldDecimals))
    : 0;
  const noPool = matchMeta
    ? Number(formatUnits(matchMeta.noPool, goldDecimals))
    : 0;
  const totalPool = yesPool + noPool;
  const yesPercent =
    totalPool > 0 ? Math.round((yesPool / totalPool) * 100) : 50;
  const noPercent = 100 - yesPercent;
  const midPrice =
    bestBid > 0 && bestAsk < 1000
      ? ((bestBid + bestAsk) / 2 / 1000).toFixed(3)
      : "—";
  const executionPrice =
    side === "YES"
      ? bestAsk > 0 && bestAsk < 1000
        ? bestAsk
        : bestBid > 0 && bestBid < 1000
          ? Math.min(999, bestBid + 25)
          : 500
      : bestBid > 0 && bestBid < 1000
        ? bestBid
        : bestAsk > 0 && bestAsk < 1000
          ? Math.max(1, bestAsk - 25)
          : 500;

  return (
    <div
      data-testid="evm-panel"
      style={{
        background: "rgba(0,0,0,0.65)",
        padding: 24,
        borderRadius: 16,
        border: `1px solid ${chainConfig.color}22`,
        backdropFilter: "blur(12px)",
        color: "#fff",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 13,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              color: "rgba(255,255,255,0.5)",
            }}
          >
            {chainConfig.icon} {chainConfig.shortName} Bet
          </div>
          <div
            data-testid="evm-match-id"
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.4)",
              marginTop: 4,
            }}
          >
            Match #{matchId.toString()} · {matchMeta?.status ?? "—"} · Mid odds:{" "}
            {midPrice}
          </div>
        </div>
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>
          {shortAddress
            ? `Wallet ${shortAddress}`
            : "Use wallet controls to connect"}
        </div>
      </div>

      {/* Wrong chain warning */}
      {walletConnected && isWrongChain && (
        <button
          type="button"
          onClick={handleSwitchChain}
          style={{
            padding: 12,
            background: "rgba(234,179,8,0.15)",
            border: "1px solid #eab308",
            borderRadius: 12,
            color: "#eab308",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Switch to {chainConfig.name}
        </button>
      )}

      {/* Balance */}
      {walletConnected && !isWrongChain && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 13,
            color: "rgba(255,255,255,0.6)",
          }}
        >
          <span>GOLD Balance:</span>
          <span style={{ fontWeight: 600, color: "#eab308" }}>
            {formatUnits(goldBalance, goldDecimals)}
          </span>
        </div>
      )}

      {/* Side selection */}
      <div style={{ display: "flex", gap: 12 }}>
        <button
          data-testid="evm-pick-yes"
          type="button"
          aria-pressed={side === "YES"}
          style={{
            flex: 1,
            padding: 16,
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
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>
            Agent A
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            {yesPercent}% of pool
          </div>
        </button>
        <button
          data-testid="evm-pick-no"
          type="button"
          aria-pressed={side === "NO"}
          style={{
            flex: 1,
            padding: 16,
            background:
              side === "NO" ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.03)",
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
          <div style={{ fontSize: 18, fontWeight: 900, marginBottom: 4 }}>
            Agent B
          </div>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
            {noPercent}% of pool
          </div>
        </button>
      </div>

      <div>
        <label
          htmlFor="evm-amount"
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase",
            letterSpacing: 1.1,
            display: "block",
            marginBottom: 6,
          }}
        >
          Bet Amount (GOLD)
        </label>
        <input
          data-testid="evm-amount-input"
          id="evm-amount"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="Enter amount"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          style={{
            width: "100%",
            padding: "12px 16px",
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 12,
            color: "#fff",
            fontSize: 16,
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.62)",
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 10,
          padding: "9px 11px",
        }}
      >
        Reference execution price: {executionPrice}/1000
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <button
          data-testid="evm-place-order"
          type="button"
          style={{
            width: "100%",
            padding: 18,
            background: chainConfig.color,
            color: "#000",
            border: "none",
            borderRadius: 12,
            fontSize: 16,
            fontWeight: 800,
            textTransform: "uppercase",
            cursor:
              walletConnected && !isWrongChain ? "pointer" : "not-allowed",
            opacity: walletConnected && !isWrongChain ? 1 : 0.5,
          }}
          disabled={!walletConnected || isWrongChain}
          onClick={handlePlaceOrder}
        >
          {walletConnected
            ? isWrongChain
              ? `Switch to ${chainConfig.shortName}`
              : `Bet on ${side === "YES" ? "Agent A" : "Agent B"}`
            : "Connect EVM Wallet"}
        </button>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 8,
          }}
        >
          <button
            data-testid="evm-refresh-market"
            type="button"
            onClick={() => void refreshData()}
            disabled={isRefreshing}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Refresh
          </button>
          <button
            data-testid="evm-claim-payout"
            type="button"
            onClick={() => void handleClaim()}
            disabled={!walletConnected || isWrongChain}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.05)",
              color: "#fff",
              cursor:
                walletConnected && !isWrongChain ? "pointer" : "not-allowed",
              opacity: walletConnected && !isWrongChain ? 1 : 0.5,
            }}
          >
            Claim
          </button>
          {isE2eMode ? (
            <>
              <button
                data-testid="evm-create-match"
                type="button"
                onClick={() => void handleCreateMatch()}
                disabled={!walletConnected || isWrongChain}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                  cursor:
                    walletConnected && !isWrongChain
                      ? "pointer"
                      : "not-allowed",
                  opacity: walletConnected && !isWrongChain ? 1 : 0.5,
                }}
              >
                Create Match
              </button>
              <button
                data-testid="evm-resolve-match"
                type="button"
                onClick={() => void handleResolveYes()}
                disabled={!walletConnected || isWrongChain}
                style={{
                  padding: 12,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.05)",
                  color: "#fff",
                  cursor:
                    walletConnected && !isWrongChain
                      ? "pointer"
                      : "not-allowed",
                  opacity: walletConnected && !isWrongChain ? 1 : 0.5,
                }}
              >
                Resolve YES
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* Position display */}
      {position && (position.yesShares > 0n || position.noShares > 0n) && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 13,
            padding: "12px 16px",
            background: "rgba(255,255,255,0.03)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>Agent A: </span>
            <span style={{ color: "#22c55e", fontWeight: 600 }}>
              {formatUnits(position.yesShares, goldDecimals)}
            </span>
          </div>
          <div>
            <span style={{ color: "rgba(255,255,255,0.5)" }}>Agent B: </span>
            <span style={{ color: "#ef4444", fontWeight: 600 }}>
              {formatUnits(position.noShares, goldDecimals)}
            </span>
          </div>
        </div>
      )}

      {isE2eMode ? (
        <div
          style={{
            display: "grid",
            gap: 4,
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          <div data-testid="evm-last-approve-tx">{lastApprovalTx}</div>
          <div data-testid="evm-last-order-tx">{lastOrderTx}</div>
          <div data-testid="evm-last-create-tx">{lastCreateTx}</div>
          <div data-testid="evm-last-resolve-tx">{lastResolveTx}</div>
          <div data-testid="evm-last-claim-tx">{lastClaimTx}</div>
        </div>
      ) : null}

      {/* Status */}
      {status && (
        <div
          data-testid="evm-status"
          style={{
            fontSize: 12,
            color: /failed|error|not connected|must/i.test(status)
              ? "#fda4af"
              : "#86efac",
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}
