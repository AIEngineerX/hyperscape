import { useCallback, useEffect, useState } from "react";
import { GAME_API_URL } from "../lib/config";

interface HistoryEntry {
  id: number;
  eventType: string;
  status: string;
  totalPoints: number;
  referenceType: string | null;
  referenceId: string | null;
  relatedWallet: string | null;
  createdAt: number;
}

interface HistoryResponse {
  entries: HistoryEntry[];
  total: number;
}

const EVENT_LABELS: Record<string, { label: string; icon: string }> = {
  BET_PLACED: { label: "Bet Placed", icon: "🎲" },
  BET_WON: { label: "Bet Won", icon: "🏆" },
  REFERRAL_WIN: { label: "Referral Win", icon: "👥" },
  SIGNUP_REFERRER: { label: "Signup Bonus (Referrer)", icon: "🎁" },
  SIGNUP_REFEREE: { label: "Signup Bonus", icon: "🎉" },
  STAKING_DAILY: { label: "Staking Reward", icon: "💎" },
  WALLET_LINK: { label: "Wallet Link Bonus", icon: "🔗" },
};

const EVENT_FILTERS = [
  { value: "", label: "All Events" },
  { value: "BET_PLACED", label: "Bets" },
  { value: "BET_WON", label: "Wins" },
  { value: "REFERRAL_WIN", label: "Referral Wins" },
  { value: "STAKING_DAILY", label: "Staking" },
  { value: "WALLET_LINK", label: "Wallet Link" },
];

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const now = Date.now();
  const diff = now - ms;

  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;

  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

export function PointsHistory({
  walletAddress,
}: {
  walletAddress: string | null;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [eventFilter, setEventFilter] = useState("");
  const pageSize = 15;

  const fetchHistory = useCallback(async () => {
    if (!walletAddress) {
      setEntries([]);
      setTotal(0);
      setError(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const offset = page * pageSize;
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
      });
      if (eventFilter) params.set("eventType", eventFilter);

      const response = await fetch(
        `${GAME_API_URL}/api/arena/points/history/${walletAddress}?${params}`,
        { cache: "no-store" },
      );

      if (response.ok) {
        const data = (await response.json()) as HistoryResponse;
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
      } else {
        setEntries([]);
        setTotal(0);
        setError(`History unavailable (${response.status})`);
      }
    } catch {
      setEntries([]);
      setTotal(0);
      setError("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [walletAddress, page, eventFilter]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    setPage(0);
  }, [eventFilter]);

  if (!walletAddress) {
    return (
      <div
        style={{
          padding: "16px",
          borderRadius: 12,
          border: "1px solid rgba(255,255,255,0.08)",
          background: "rgba(255,255,255,0.02)",
          fontSize: 12,
          color: "rgba(255,255,255,0.5)",
        }}
      >
        Connect a wallet to view points history.
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        color: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
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
          📜 Points History
        </div>

        <select
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          style={{
            padding: "5px 8px",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(0,0,0,0.4)",
            color: "rgba(255,255,255,0.7)",
            fontSize: 11,
            cursor: "pointer",
            outline: "none",
          }}
        >
          {EVENT_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {loading && entries.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: "rgba(255,255,255,0.3)",
            padding: 16,
            textAlign: "center",
          }}
        >
          Loading...
        </div>
      )}

      {!loading && entries.length === 0 && (
        <div
          style={{
            fontSize: 12,
            color: error ? "#fca5a5" : "rgba(255,255,255,0.3)",
            padding: 24,
            textAlign: "center",
            background: "rgba(0,0,0,0.2)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          {error ?? "No points activity yet."}
        </div>
      )}

      {entries.length > 0 && (
        <div
          style={{
            background: "rgba(0,0,0,0.3)",
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          {entries.map((entry) => {
            const meta = EVENT_LABELS[entry.eventType] ?? {
              label: entry.eventType,
              icon: "•",
            };
            const isPositive = entry.totalPoints > 0;

            return (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "10px 14px",
                  gap: 10,
                  borderBottom: "1px solid rgba(255,255,255,0.03)",
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <span style={{ fontSize: 16, width: 24, textAlign: "center" }}>
                  {meta.icon}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "rgba(255,255,255,0.85)",
                    }}
                  >
                    {meta.label}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "rgba(255,255,255,0.35)",
                      display: "flex",
                      gap: 6,
                    }}
                  >
                    <span>{formatTimestamp(entry.createdAt)}</span>
                    {entry.relatedWallet ? (
                      <span>
                        &middot; {truncateWallet(entry.relatedWallet)}
                      </span>
                    ) : null}
                    {entry.status !== "CONFIRMED" ? (
                      <span
                        style={{
                          color:
                            entry.status === "PENDING" ? "#facc15" : "#fca5a5",
                        }}
                      >
                        &middot; {entry.status}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: isPositive ? "#4ade80" : "#fca5a5",
                    whiteSpace: "nowrap",
                  }}
                >
                  {isPositive ? "+" : ""}
                  {entry.totalPoints.toLocaleString()} pts
                </div>
              </div>
            );
          })}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "8px 14px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background:
                  page === 0 ? "transparent" : "rgba(255,255,255,0.05)",
                color:
                  page === 0
                    ? "rgba(255,255,255,0.2)"
                    : "rgba(255,255,255,0.6)",
                cursor: page === 0 ? "not-allowed" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Prev
            </button>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>
              Page {page + 1} of {totalPages} ({total} total)
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={page + 1 >= totalPages}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.1)",
                background:
                  page + 1 >= totalPages
                    ? "transparent"
                    : "rgba(255,255,255,0.05)",
                color:
                  page + 1 >= totalPages
                    ? "rgba(255,255,255,0.2)"
                    : "rgba(255,255,255,0.6)",
                cursor: page + 1 >= totalPages ? "not-allowed" : "pointer",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
