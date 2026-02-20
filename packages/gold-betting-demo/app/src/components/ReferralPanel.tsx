import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChainId } from "../lib/chainConfig";
import { ARENA_EXTERNAL_BET_WRITE_KEY, GAME_API_URL } from "../lib/config";

type EvmPlatform = "BSC" | "BASE";

type PointsSnapshot = {
  wallet: string;
  pointsScope?: "WALLET" | "LINKED";
  identityWalletCount?: number;
  totalPoints: number;
  selfPoints: number;
  referralPoints: number;
  stakingPoints: number;
  invitedWalletCount: number;
};

type InviteSummary = {
  wallet: string;
  platformView: string;
  inviteCode: string;
  invitedWalletCount: number;
  invitedWallets: string[];
  invitedWalletsTruncated: boolean;
  pointsFromReferrals: number;
  feeShareFromReferralsGold: string;
  treasuryFeesFromReferredBetsGold: string;
  referredByWallet: string | null;
  referredByCode: string | null;
};

type WalletLinkResponse = {
  result?: {
    alreadyLinked: boolean;
    awardedPoints: number;
  };
  error?: string;
};

const LOCAL_INVITE_ORIGIN = "http://localhost:4179";
const WEBSITE_INVITE_ORIGIN = "https://hyperscape.bet";

function shortWallet(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function extractInviteCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (!trimmed.includes("://")) return trimmed;

  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get("invite")?.trim() ?? "";
  } catch {
    return "";
  }
}

function buildInviteShareLink(inviteCode: string): string {
  if (typeof window === "undefined") {
    return `${WEBSITE_INVITE_ORIGIN}/?invite=${encodeURIComponent(inviteCode)}`;
  }
  const isLocalHost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";
  const shareOrigin = isLocalHost ? LOCAL_INVITE_ORIGIN : WEBSITE_INVITE_ORIGIN;
  const url = new URL(window.location.pathname, `${shareOrigin}/`);
  url.searchParams.set("invite", inviteCode);
  return url.toString();
}

export function ReferralPanel(props: {
  activeChain: ChainId;
  solanaWallet: string | null;
  evmWallet: string | null;
  evmWalletPlatform: EvmPlatform | null;
}) {
  const { activeChain, solanaWallet, evmWallet, evmWalletPlatform } = props;

  const primaryWallet = useMemo(() => {
    if (activeChain === "solana" && solanaWallet) return solanaWallet;
    if ((activeChain === "bsc" || activeChain === "base") && evmWallet) {
      return evmWallet;
    }
    return solanaWallet ?? evmWallet ?? null;
  }, [activeChain, solanaWallet, evmWallet]);

  const platformQuery = useMemo(() => {
    if (primaryWallet && primaryWallet === solanaWallet) return "solana";
    if (primaryWallet && primaryWallet === evmWallet) return "evm";
    return activeChain === "solana" ? "solana" : "evm";
  }, [activeChain, evmWallet, primaryWallet, solanaWallet]);
  const walletModeLabel = useMemo(() => {
    if (!primaryWallet) return "";
    if (primaryWallet === solanaWallet) {
      return activeChain === "solana" ? "Solana wallet" : "Solana fallback";
    }
    if (primaryWallet === evmWallet) {
      return activeChain === "solana" ? "EVM fallback" : "EVM wallet";
    }
    return "Wallet";
  }, [activeChain, evmWallet, primaryWallet, solanaWallet]);

  const [points, setPoints] = useState<PointsSnapshot | null>(null);
  const [invite, setInvite] = useState<InviteSummary | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [statsError, setStatsError] = useState("");
  const [redeemCode, setRedeemCode] = useState("");
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const refreshStats = useCallback(async () => {
    if (!primaryWallet) {
      setPoints(null);
      setInvite(null);
      setStatsError("");
      setLoadingStats(false);
      return;
    }

    try {
      setLoadingStats(true);
      setStatsError("");
      const [pointsRes, inviteRes] = await Promise.all([
        fetch(
          `${GAME_API_URL}/api/arena/points/${primaryWallet}?scope=linked`,
          {
            cache: "no-store",
          },
        ),
        fetch(
          `${GAME_API_URL}/api/arena/invite/${primaryWallet}?platform=${platformQuery}`,
          {
            cache: "no-store",
          },
        ),
      ]);

      const errors: string[] = [];
      if (pointsRes.ok) {
        setPoints((await pointsRes.json()) as PointsSnapshot);
      } else {
        setPoints(null);
        errors.push(`points ${pointsRes.status}`);
      }
      if (inviteRes.ok) {
        setInvite((await inviteRes.json()) as InviteSummary);
      } else {
        setInvite(null);
        errors.push(`invite ${inviteRes.status}`);
      }

      if (errors.length > 0) {
        setStatsError(`Stats unavailable (${errors.join(", ")})`);
      }
    } catch {
      setPoints(null);
      setInvite(null);
      setStatsError("Stats request failed");
    } finally {
      setLoadingStats(false);
    }
  }, [platformQuery, primaryWallet]);

  useEffect(() => {
    void refreshStats();
    const id = window.setInterval(() => void refreshStats(), 15_000);
    return () => window.clearInterval(id);
  }, [refreshStats]);

  useEffect(() => {
    const inviteFromQuery = new URLSearchParams(window.location.search)
      .get("invite")
      ?.trim();
    if (!inviteFromQuery) return;
    setRedeemCode((current) =>
      current.trim() ? current : inviteFromQuery.toUpperCase(),
    );
  }, []);

  const canLinkWallets = Boolean(
    solanaWallet && evmWallet && evmWalletPlatform,
  );

  const handleRedeem = useCallback(async () => {
    if (!primaryWallet) {
      setStatus("Connect wallet to redeem invite code");
      return;
    }

    const code = extractInviteCode(redeemCode).toUpperCase();
    if (!code) {
      setStatus("Enter an invite code");
      return;
    }

    setBusy(true);
    setStatus("Redeeming invite code...");
    try {
      const response = await fetch(`${GAME_API_URL}/api/arena/invite/redeem`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(ARENA_EXTERNAL_BET_WRITE_KEY
            ? { "x-arena-write-key": ARENA_EXTERNAL_BET_WRITE_KEY }
            : {}),
        },
        body: JSON.stringify({ wallet: primaryWallet, inviteCode: code }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        setStatus(payload.error ?? "Invite redeem failed");
        return;
      }
      setStatus("Invite code linked");
      setRedeemCode("");
      await refreshStats();
    } catch {
      setStatus("Invite redeem failed");
    } finally {
      setBusy(false);
    }
  }, [primaryWallet, redeemCode, refreshStats]);

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

    setBusy(true);
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
        setStatus(`Wallets linked (+${bonus} points)`);
      }
      await refreshStats();
    } catch {
      setStatus("Wallet link failed");
    } finally {
      setBusy(false);
    }
  }, [activeChain, evmWallet, evmWalletPlatform, refreshStats, solanaWallet]);

  const handleCopyInvite = useCallback(async () => {
    if (!invite?.inviteCode) return;
    try {
      await navigator.clipboard.writeText(
        buildInviteShareLink(invite.inviteCode),
      );
      setStatus("Invite link copied");
    } catch {
      setStatus("Failed to copy invite link");
    }
  }, [invite?.inviteCode]);

  const noPrimaryWallet = !primaryWallet;

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
      <div style={{ fontSize: 12, textTransform: "uppercase", opacity: 0.65 }}>
        Invite + Fee Share
      </div>

      {noPrimaryWallet ? (
        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
          Connect the active-chain wallet to view invite code, points, and fee
          share.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.62)" }}>
            Wallet: {shortWallet(primaryWallet)}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.52)" }}>
            Viewing: {walletModeLabel}
          </div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.52)" }}>
            Points Scope: {points?.pointsScope ?? "WALLET"} (
            {points?.identityWalletCount ?? 1} wallet
            {(points?.identityWalletCount ?? 1) === 1 ? "" : "s"})
          </div>
          <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
            <span>Points: {points?.totalPoints?.toLocaleString() ?? "0"}</span>
            <span>Referrals: {invite?.invitedWalletCount ?? 0}</span>
            <span>
              Fee Share: {invite?.feeShareFromReferralsGold ?? "0"} GOLD
            </span>
          </div>
          {invite?.invitedWalletsTruncated ? (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.56)" }}>
              Showing {invite.invitedWallets.length} of{" "}
              {invite.invitedWalletCount} referred wallets.
            </div>
          ) : null}
          {loadingStats ? (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.56)" }}>
              Refreshing points...
            </div>
          ) : null}
          {statsError ? (
            <div style={{ fontSize: 11, color: "#fca5a5" }}>{statsError}</div>
          ) : null}

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code
              style={{
                flex: 1,
                fontSize: 11,
                padding: "8px 10px",
                borderRadius: 8,
                background: "rgba(0,0,0,0.45)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              {invite?.inviteCode ?? "-"}
            </code>
            <button
              type="button"
              onClick={handleCopyInvite}
              disabled={!invite?.inviteCode}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.35)",
                color: "#fff",
                cursor: invite?.inviteCode ? "pointer" : "not-allowed",
              }}
            >
              Copy Link
            </button>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          placeholder="Redeem invite code or link"
          value={redeemCode}
          onChange={(event) => setRedeemCode(event.target.value)}
          style={{
            flex: 1,
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(0,0,0,0.35)",
            color: "#fff",
            fontSize: 12,
          }}
        />
        <button
          type="button"
          onClick={() => void handleRedeem()}
          disabled={busy || !primaryWallet}
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            border: "1px solid rgba(234,179,8,0.45)",
            background: "rgba(234,179,8,0.2)",
            color: "#fbbf24",
            cursor: busy || !primaryWallet ? "not-allowed" : "pointer",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          Redeem
        </button>
      </div>

      <button
        type="button"
        onClick={() => void handleLinkWallets()}
        disabled={busy || !canLinkWallets}
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid rgba(96,165,250,0.45)",
          background: "rgba(96,165,250,0.18)",
          color: "#93c5fd",
          cursor: busy || !canLinkWallets ? "not-allowed" : "pointer",
          fontSize: 12,
          fontWeight: 700,
          textAlign: "left",
        }}
      >
        Link Solana + EVM wallets (+100 points)
      </button>

      {status ? (
        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.68)" }}>
          {status}
        </div>
      ) : null}
    </div>
  );
}
