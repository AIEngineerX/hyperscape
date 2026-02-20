import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChainId } from "../lib/chainConfig";
import { GAME_API_URL, buildArenaWriteHeaders } from "../lib/config";
import {
  buildInviteShareLink,
  captureInviteCodeFromLocation,
  markInviteAppliedForWallet,
  wasInviteAppliedForWallet,
} from "../lib/invite";

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

function shortWallet(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function isTerminalInviteApplyError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("own invite code") ||
    lower.includes("already linked") ||
    lower.includes("invite code not found") ||
    lower.includes("format is invalid")
  );
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
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(
    () => captureInviteCodeFromLocation(),
  );
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [isApplyingInvite, setIsApplyingInvite] = useState(false);

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
    const captured = captureInviteCodeFromLocation();
    if (captured) setPendingInviteCode(captured);
  }, []);

  useEffect(() => {
    if (!primaryWallet || !pendingInviteCode) return;
    if ((invite?.referredByCode ?? "").toUpperCase() === pendingInviteCode)
      return;
    if (wasInviteAppliedForWallet(primaryWallet, pendingInviteCode)) return;

    let cancelled = false;
    setIsApplyingInvite(true);
    setStatus(`Applying invite from link (${pendingInviteCode})...`);

    void (async () => {
      try {
        const response = await fetch(
          `${GAME_API_URL}/api/arena/invite/redeem`,
          {
            method: "POST",
            headers: buildArenaWriteHeaders(),
            body: JSON.stringify({
              wallet: primaryWallet,
              inviteCode: pendingInviteCode,
            }),
          },
        );

        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        if (cancelled) return;

        if (!response.ok) {
          const message = payload.error ?? "Invite link apply failed";
          setStatus(message);
          if (isTerminalInviteApplyError(message)) {
            markInviteAppliedForWallet(primaryWallet, pendingInviteCode);
          }
          return;
        }

        markInviteAppliedForWallet(primaryWallet, pendingInviteCode);
        setStatus("Referral link applied");
        await refreshStats();
      } catch {
        if (!cancelled) {
          setStatus("Invite link apply failed");
        }
      } finally {
        if (!cancelled) {
          setIsApplyingInvite(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [invite?.referredByCode, pendingInviteCode, primaryWallet, refreshStats]);

  const canLinkWallets = Boolean(
    solanaWallet && evmWallet && evmWalletPlatform,
  );

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
        headers: buildArenaWriteHeaders(),
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
      const link = buildInviteShareLink(invite.inviteCode);
      await navigator.clipboard.writeText(link || invite.inviteCode);
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

          {pendingInviteCode ? (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.68)" }}>
              Link invite detected: <code>{pendingInviteCode}</code>
              {invite?.referredByCode?.toUpperCase() === pendingInviteCode
                ? " (applied)"
                : " (auto-applies when you sign up/connect)"}
            </div>
          ) : null}

          {invite?.referredByCode ? (
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.68)" }}>
              Referred by{" "}
              {invite.referredByWallet
                ? shortWallet(invite.referredByWallet)
                : "-"}{" "}
              via <code>{invite.referredByCode}</code>
            </div>
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

      <button
        type="button"
        onClick={() => void handleLinkWallets()}
        disabled={busy || isApplyingInvite || !canLinkWallets}
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid rgba(96,165,250,0.45)",
          background: "rgba(96,165,250,0.18)",
          color: "#93c5fd",
          cursor:
            busy || isApplyingInvite || !canLinkWallets
              ? "not-allowed"
              : "pointer",
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
