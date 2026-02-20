import { useCallback, useMemo, useState } from "react";
import type { ChainId } from "../lib/chainConfig";
import { ARENA_EXTERNAL_BET_WRITE_KEY, GAME_API_URL } from "../lib/config";

type EvmPlatform = "BSC" | "BASE";

type WalletLinkResponse = {
  result?: {
    alreadyLinked: boolean;
    awardedPoints: number;
  };
  error?: string;
};

function shortWallet(value: string | null): string {
  if (!value) return "Not connected";
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function WalletLinkCard(props: {
  activeChain: ChainId;
  solanaWallet: string | null;
  evmWallet: string | null;
  evmWalletPlatform: EvmPlatform | null;
}) {
  const { activeChain, solanaWallet, evmWallet, evmWalletPlatform } = props;
  const [status, setStatus] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const canLink = Boolean(solanaWallet && evmWallet && evmWalletPlatform);
  const statusColor = /failed|error/i.test(status)
    ? "#fda4af"
    : /linked|already/i.test(status)
      ? "#86efac"
      : "rgba(255,255,255,0.72)";

  const helperText = useMemo(() => {
    if (!solanaWallet && !evmWallet) {
      return "Connect Solana and EVM wallets to keep one linked betting identity.";
    }
    if (!solanaWallet) {
      return "Add a Solana wallet to complete linking.";
    }
    if (!evmWallet) {
      return "Add an EVM wallet (BSC or Base) to complete linking.";
    }
    return "Both wallets connected. Link once so your activity stays unified.";
  }, [evmWallet, solanaWallet]);

  const handleLinkWallets = useCallback(async () => {
    if (!solanaWallet || !evmWallet || !evmWalletPlatform) {
      setStatus("Connect both Solana and EVM wallets first");
      return;
    }

    const requestBody =
      activeChain === "solana"
        ? {
            wallet: solanaWallet,
            walletPlatform: "SOLANA",
            linkedWallet: evmWallet,
            linkedWalletPlatform: evmWalletPlatform,
          }
        : {
            wallet: evmWallet,
            walletPlatform: evmWalletPlatform,
            linkedWallet: solanaWallet,
            linkedWalletPlatform: "SOLANA",
          };

    setIsBusy(true);
    setStatus("Linking wallets...");

    try {
      const response = await fetch(`${GAME_API_URL}/api/arena/wallet-link`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ARENA_EXTERNAL_BET_WRITE_KEY
            ? { "x-arena-write-key": ARENA_EXTERNAL_BET_WRITE_KEY }
            : {}),
        },
        body: JSON.stringify(requestBody),
      });

      const payload = (await response.json()) as WalletLinkResponse;
      if (!response.ok) {
        setStatus(payload.error ?? "Wallet link failed");
        return;
      }

      if (payload.result?.alreadyLinked) {
        setStatus("Wallets are already linked");
      } else {
        const bonus = payload.result?.awardedPoints ?? 0;
        setStatus(`Wallets linked${bonus > 0 ? ` (+${bonus} points)` : ""}`);
      }
    } catch {
      setStatus("Wallet link failed");
    } finally {
      setIsBusy(false);
    }
  }, [activeChain, evmWallet, evmWalletPlatform, solanaWallet]);

  return (
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
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 1.1,
          color: "rgba(255,255,255,0.62)",
        }}
      >
        Wallets
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "6px 10px",
          fontSize: 12,
        }}
      >
        <span style={{ color: "rgba(255,255,255,0.5)" }}>Solana</span>
        <span
          style={{ color: solanaWallet ? "#c4b5fd" : "rgba(255,255,255,0.62)" }}
        >
          {shortWallet(solanaWallet)}
        </span>
        <span style={{ color: "rgba(255,255,255,0.5)" }}>EVM</span>
        <span
          style={{ color: evmWallet ? "#93c5fd" : "rgba(255,255,255,0.62)" }}
        >
          {evmWallet
            ? `${shortWallet(evmWallet)}${evmWalletPlatform ? ` (${evmWalletPlatform})` : ""}`
            : "Not connected"}
        </span>
      </div>

      <div
        style={{
          fontSize: 12,
          color: "rgba(255,255,255,0.68)",
          lineHeight: 1.4,
        }}
      >
        {helperText}
      </div>

      <button
        type="button"
        onClick={() => void handleLinkWallets()}
        disabled={isBusy || !canLink}
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid rgba(96,165,250,0.45)",
          background: "rgba(96,165,250,0.18)",
          color: "#93c5fd",
          cursor: isBusy || !canLink ? "not-allowed" : "pointer",
          fontSize: 12,
          fontWeight: 700,
          textAlign: "left",
          opacity: isBusy || !canLink ? 0.6 : 1,
        }}
      >
        {canLink ? "Link Solana + EVM wallets" : "Connect both wallets to link"}
      </button>

      {status ? (
        <div style={{ fontSize: 11, color: statusColor }}>{status}</div>
      ) : null}
    </div>
  );
}
