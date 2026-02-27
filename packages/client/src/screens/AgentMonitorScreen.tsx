/**
 * AgentMonitorScreen - Real-time monitoring panel for autonomous agents
 *
 * Features:
 * - Compact card grid for all running agents
 * - Detailed view with tabs: Overview, Skills, Inventory, Action Log
 * - Auto-refresh every 3 seconds (toggleable)
 * - Admin code auth gate (same pattern as AdminScreen)
 *
 * Access: ?page=agent-monitor (requires admin code)
 */

import { GAME_API_URL } from "@/lib/api-config";
import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  Swords,
  RefreshCw,
  Heart,
  Shield,
  Target,
  Clock,
  MapPin,
  Activity,
  Package,
  User,
  X,
} from "lucide-react";
import "./AgentMonitorScreen.css";

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentGoal {
  type: string;
  description: string;
  progress: number;
  target: number;
  location?: string;
  targetSkill?: string;
  startedAt: number;
  locked: boolean;
}

interface AgentThought {
  id: string;
  type: string;
  content: string;
  timestamp: number;
}

interface AgentData {
  characterId: string;
  name: string;
  state: "initializing" | "running" | "paused" | "stopped" | "error";
  scriptedRole?: string;
  startedAt: number;
  lastActivity: number;
  error?: string;

  entityId: string | null;
  position: [number, number, number] | null;
  health: number;
  maxHealth: number;
  alive: boolean;
  inCombat: boolean;
  combatTarget: string | null;

  goal: AgentGoal | null;
  goalsPaused: boolean;

  skills: Record<string, { level: number; xp: number }>;
  combatLevel: number;
  totalLevel: number;

  inventory: Array<{ slot: number; itemId: string; quantity: number }>;
  inventoryUsed: number;
  inventoryMax: number;
  coins: number;
  equipment: Record<string, string>;

  recentThoughts: AgentThought[];

  quests: AgentQuest[];
  questPoints: number;

  bankItems: Array<{
    itemId: string;
    quantity: number;
    slot: number;
    tabIndex: number;
  }>;
}

interface AgentQuest {
  questId: string;
  name: string;
  status: string;
  currentStage?: string;
  stageDescription?: string;
  stageProgress?: Record<string, number>;
}

interface MonitorResponse {
  timestamp: number;
  agentCount: number;
  agents: AgentData[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ADMIN_CODE_KEY = "hyperscape_admin_code";
const POLL_INTERVAL_MS = 3000;

type DetailTab =
  | "overview"
  | "skills"
  | "inventory"
  | "quests"
  | "bank"
  | "actions";

// ─── XP Table (approximate RS-style) ──────────────────────────────────────

const XP_TABLE = [
  0, 83, 174, 276, 388, 512, 650, 801, 969, 1154, 1358, 1584, 1833, 2107, 2411,
  2746, 3115, 3523, 3973, 4470, 5018, 5624, 6291, 7028, 7842, 8740, 9730, 10824,
  12031, 13363, 14833, 16456, 18247, 20224, 22406, 24815, 27473, 30408, 33648,
  37224, 41171, 45529, 50339, 55649, 61512, 67983, 75127, 83014, 91721, 101333,
  111945, 123660, 136594, 150872, 166636, 184040, 203254, 224466, 247886,
  273742, 302288, 333804, 368599, 407015, 449428, 496254, 547953, 605032,
  668051, 737627, 814445, 899257, 992895, 1096278, 1210421, 1336443, 1475581,
  1629200, 1798808, 1986068, 2192818, 2421087, 2673114, 2951373, 3258594,
  3597792, 3972294, 4385776, 4842295, 5346332, 5902831, 6517253, 7195629,
  7944614, 8771558, 9684577, 10692629, 11805606, 13034431,
];

function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > 99) return XP_TABLE[98] ?? 13034431;
  return XP_TABLE[level - 1] ?? 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 1000) return "just now";
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function hpColor(ratio: number): string {
  if (ratio > 0.6) return "#38a169";
  if (ratio > 0.3) return "#d69e2e";
  return "#c53030";
}

function formatItemId(itemId: unknown): string {
  if (typeof itemId === "string") {
    return itemId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (itemId && typeof itemId === "object" && "itemId" in itemId) {
    return formatItemId((itemId as { itemId: unknown }).itemId);
  }
  return String(itemId ?? "Unknown");
}

// ─── Agent Card ─────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  selected,
  onClick,
}: {
  agent: AgentData;
  selected: boolean;
  onClick: () => void;
}) {
  const hpRatio = agent.maxHealth > 0 ? agent.health / agent.maxHealth : 0;
  const goalProgress =
    agent.goal && agent.goal.target > 0
      ? Math.min(1, agent.goal.progress / agent.goal.target)
      : 0;

  return (
    <div
      className={`agent-card ${selected ? "selected" : ""}`}
      onClick={onClick}
    >
      <div className="agent-card-header">
        <span className="agent-card-name" title={agent.name}>
          {agent.name}
        </span>
        <span className="agent-card-state">
          <span className={`state-dot ${agent.state}`} />
          {agent.state}
        </span>
      </div>

      <div className="agent-card-stats">
        <span title="Combat Level">
          <Swords size={12} /> Cb {agent.combatLevel}
        </span>
        <span title="Total Level">Lv {agent.totalLevel}</span>
        {agent.inCombat && (
          <span style={{ color: "#c53030" }} title="In Combat">
            <Target size={12} /> Combat
          </span>
        )}
      </div>

      <div className="agent-card-hp">
        <div className="hp-bar-track">
          <div
            className="hp-bar-fill"
            style={{
              width: `${hpRatio * 100}%`,
              background: hpColor(hpRatio),
            }}
          />
        </div>
        <div className="hp-bar-label">
          <span>HP</span>
          <span>
            {agent.health}/{agent.maxHealth}
          </span>
        </div>
      </div>

      {agent.goal ? (
        <>
          <div className="agent-card-goal">
            <span className="agent-card-goal-type">{agent.goal.type}</span>
            {" — "}
            {agent.goal.description}
          </div>
          {agent.goal.target > 0 && (
            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${goalProgress * 100}%` }}
              />
            </div>
          )}
        </>
      ) : (
        <div className="agent-card-goal">
          <span className="agent-card-goal-type">idle</span>
          {" — No active goal"}
        </div>
      )}
    </div>
  );
}

// ─── Overview Tab ───────────────────────────────────────────────────────────

function OverviewTab({ agent }: { agent: AgentData }) {
  const hpRatio = agent.maxHealth > 0 ? agent.health / agent.maxHealth : 0;
  const uptime = Date.now() - agent.startedAt;

  return (
    <div>
      <div className="detail-hp-bar">
        <div className="hp-bar-track">
          <div
            className="hp-bar-fill"
            style={{
              width: `${hpRatio * 100}%`,
              background: hpColor(hpRatio),
            }}
          />
        </div>
        <div className="hp-bar-label">
          <span>
            <Heart size={12} style={{ marginRight: 4 }} />
            Health
          </span>
          <span>
            {agent.health} / {agent.maxHealth}
          </span>
        </div>
      </div>

      <div className="overview-grid">
        <div className="overview-item">
          <span className="overview-label">Status</span>
          <span className={`overview-value ${agent.alive ? "green" : "red"}`}>
            {agent.alive ? "Alive" : "Dead"}
          </span>
        </div>
        <div className="overview-item">
          <span className="overview-label">In Combat</span>
          <span className={`overview-value ${agent.inCombat ? "red" : ""}`}>
            {agent.inCombat ? "Yes" : "No"}
          </span>
        </div>
        <div className="overview-item">
          <span className="overview-label">
            <Target size={11} style={{ marginRight: 4 }} />
            Goal
          </span>
          <span className="overview-value gold">
            {agent.goal
              ? `${agent.goal.type}: ${agent.goal.description}`
              : "None"}
          </span>
        </div>
        <div className="overview-item">
          <span className="overview-label">Goal Progress</span>
          <span className="overview-value">
            {agent.goal && agent.goal.target > 0
              ? `${agent.goal.progress} / ${agent.goal.target}`
              : "N/A"}
          </span>
        </div>
        <div className="overview-item">
          <span className="overview-label">
            <MapPin size={11} style={{ marginRight: 4 }} />
            Position
          </span>
          <span className="overview-value">
            {agent.position
              ? `[${agent.position[0].toFixed(0)}, ${agent.position[1].toFixed(0)}, ${agent.position[2].toFixed(0)}]`
              : "Not Spawned"}
          </span>
        </div>
        <div className="overview-item">
          <span className="overview-label">Location</span>
          <span className="overview-value">
            {agent.goal?.location ?? "Unknown"}
          </span>
        </div>
        <div className="overview-item">
          <span className="overview-label">
            <Clock size={11} style={{ marginRight: 4 }} />
            Uptime
          </span>
          <span className="overview-value">{formatDuration(uptime)}</span>
        </div>
        <div className="overview-item">
          <span className="overview-label">Last Active</span>
          <span className="overview-value">
            {formatTimeAgo(agent.lastActivity)}
          </span>
        </div>
        <div className="overview-item">
          <span className="overview-label">
            <Shield size={11} style={{ marginRight: 4 }} />
            Combat Level
          </span>
          <span className="overview-value gold">{agent.combatLevel}</span>
        </div>
        <div className="overview-item">
          <span className="overview-label">Total Level</span>
          <span className="overview-value">{agent.totalLevel}</span>
        </div>
        {agent.scriptedRole && (
          <div className="overview-item">
            <span className="overview-label">Scripted Role</span>
            <span
              className="overview-value"
              style={{ textTransform: "capitalize" }}
            >
              {agent.scriptedRole}
            </span>
          </div>
        )}
        {agent.error && (
          <div className="overview-item" style={{ gridColumn: "1 / -1" }}>
            <span className="overview-label">Error</span>
            <span className="overview-value red">{agent.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Skills Tab ─────────────────────────────────────────────────────────────

function SkillsTab({ agent }: { agent: AgentData }) {
  const skillEntries = Object.entries(agent.skills);

  if (skillEntries.length === 0) {
    return <div className="action-log-empty">No skill data available</div>;
  }

  return (
    <div className="skills-grid">
      {skillEntries.map(([name, skill]) => {
        const currentLevelXp = xpForLevel(skill.level);
        const nextLevelXp = xpForLevel(skill.level + 1);
        const xpRange = nextLevelXp - currentLevelXp;
        const xpProgress =
          xpRange > 0 ? (skill.xp - currentLevelXp) / xpRange : 1;

        return (
          <div className="skill-row" key={name}>
            <span className="skill-name">{name}</span>
            <span className="skill-level">{skill.level}</span>
            <div className="skill-xp-bar">
              <div className="skill-xp-track">
                <div
                  className="skill-xp-fill"
                  style={{
                    width: `${Math.max(0, Math.min(1, xpProgress)) * 100}%`,
                  }}
                />
              </div>
              <div className="skill-xp-text">
                {skill.xp.toLocaleString()} / {nextLevelXp.toLocaleString()} XP
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Inventory Tab ──────────────────────────────────────────────────────────

function InventoryTab({ agent }: { agent: AgentData }) {
  const items = agent.inventory.filter((i) => i.itemId && i.itemId !== "");
  const equipmentEntries = Object.entries(agent.equipment);

  return (
    <div>
      <div className="inventory-section">
        <h3>
          <Package size={12} style={{ marginRight: 6 }} />
          Inventory
        </h3>
        {items.length > 0 ? (
          <div className="inventory-items">
            {items.map((item, i) => (
              <span className="inventory-item" key={i}>
                {formatItemId(item.itemId)}
                {item.quantity > 1 && (
                  <span className="item-qty"> x{item.quantity}</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "rgba(232,235,244,0.4)" }}>
            Empty inventory
          </div>
        )}
        <div className="inventory-summary">
          <span>
            {agent.inventoryUsed}/{agent.inventoryMax} slots used
          </span>
          <span className="coins">{agent.coins.toLocaleString()} coins</span>
        </div>
      </div>

      <div className="inventory-section">
        <h3>
          <Shield size={12} style={{ marginRight: 6 }} />
          Equipment
        </h3>
        {equipmentEntries.length > 0 ? (
          <div className="equipment-grid">
            {equipmentEntries.map(([slot, itemId]) => (
              <div className="equipment-slot" key={slot}>
                <span className="equipment-slot-name">{slot}:</span>
                <span className="equipment-slot-item">
                  {formatItemId(itemId)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "rgba(232,235,244,0.4)" }}>
            No equipment
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Quests Tab ─────────────────────────────────────────────────────────────

function QuestsTab({ agent }: { agent: AgentData }) {
  const inProgress = agent.quests.filter(
    (q) => q.status === "in_progress" || q.status === "ready_to_complete",
  );
  const completed = agent.quests.filter((q) => q.status === "completed");

  return (
    <div>
      <div className="inventory-summary" style={{ marginBottom: 16 }}>
        <span>
          {inProgress.length} active, {completed.length} completed
        </span>
        <span className="coins">{agent.questPoints} quest points</span>
      </div>

      {inProgress.length > 0 && (
        <div className="inventory-section">
          <h3>Active Quests</h3>
          <div className="quest-list">
            {inProgress.map((quest) => (
              <div className="quest-entry quest-active" key={quest.questId}>
                <div className="quest-header">
                  <span className="quest-name">{quest.name}</span>
                  <span
                    className={`quest-status quest-status-${quest.status.replace(/_/g, "-")}`}
                  >
                    {quest.status === "ready_to_complete"
                      ? "Ready"
                      : "In Progress"}
                  </span>
                </div>
                {quest.stageDescription && (
                  <div className="quest-stage">{quest.stageDescription}</div>
                )}
                {quest.stageProgress &&
                  Object.keys(quest.stageProgress).length > 0 && (
                    <div className="quest-progress-items">
                      {Object.entries(quest.stageProgress).map(
                        ([key, value]) => (
                          <span className="quest-progress-item" key={key}>
                            {formatItemId(key)}: {value}
                          </span>
                        ),
                      )}
                    </div>
                  )}
              </div>
            ))}
          </div>
        </div>
      )}

      {completed.length > 0 && (
        <div className="inventory-section">
          <h3>Completed Quests</h3>
          <div className="quest-list">
            {completed.map((quest) => (
              <div className="quest-entry quest-completed" key={quest.questId}>
                <span className="quest-name">{quest.name}</span>
                <span className="quest-status quest-status-completed">
                  Completed
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {agent.quests.length === 0 && (
        <div className="action-log-empty">No quest data available</div>
      )}
    </div>
  );
}

// ─── Bank Tab ───────────────────────────────────────────────────────────────

function BankTab({ agent }: { agent: AgentData }) {
  const items = agent.bankItems ?? [];

  if (items.length === 0) {
    return (
      <div className="action-log-empty">
        <Package size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
        <div>No items in bank</div>
      </div>
    );
  }

  // Group items by tab index
  const tabs = new Map<number, typeof items>();
  for (const item of items) {
    const tab = item.tabIndex ?? 0;
    if (!tabs.has(tab)) tabs.set(tab, []);
    tabs.get(tab)!.push(item);
  }
  const sortedTabs = Array.from(tabs.entries()).sort((a, b) => a[0] - b[0]);

  return (
    <div>
      <div className="inventory-summary" style={{ marginBottom: 16 }}>
        <span>
          {items.length} item{items.length !== 1 ? "s" : ""} stored
        </span>
        <span className="coins">
          {sortedTabs.length} tab{sortedTabs.length !== 1 ? "s" : ""}
        </span>
      </div>

      {sortedTabs.map(([tabIndex, tabItems]) => (
        <div className="inventory-section" key={tabIndex}>
          <h3>
            <Package size={12} style={{ marginRight: 6 }} />
            {tabIndex === 0 ? "Main Tab" : `Tab ${tabIndex}`}
            <span className="bank-slot-count">{tabItems.length} items</span>
          </h3>
          <div className="inventory-items">
            {tabItems.map((item, i) => (
              <span className="inventory-item" key={i}>
                {formatItemId(item.itemId)}
                {item.quantity > 1 && (
                  <span className="item-qty"> x{item.quantity}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Action Log Tab ─────────────────────────────────────────────────────────

function ActionLogTab({ agent }: { agent: AgentData }) {
  const [filter, setFilter] = useState<"all" | "actions" | "thoughts">("all");
  const filtered = agent.recentThoughts.filter((t) => {
    if (filter === "actions") return t.type === "action";
    if (filter === "thoughts") return t.type !== "action";
    return true;
  });

  if (agent.recentThoughts.length === 0) {
    return (
      <div className="action-log-empty">
        <Activity size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
        <div>No recent thoughts or actions</div>
      </div>
    );
  }

  return (
    <div>
      <div className="action-log-filters">
        {(["all", "actions", "thoughts"] as const).map((f) => (
          <button
            key={f}
            className={`action-log-filter ${filter === f ? "active" : ""}`}
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : f === "actions" ? "Actions" : "Thoughts"}
          </button>
        ))}
      </div>
      <div className="action-log">
        {filtered.map((thought) => (
          <div
            className={`action-log-entry ${thought.type === "action" ? "action-entry" : ""}`}
            key={thought.id}
          >
            <span className="action-log-time">
              {formatTime(thought.timestamp)}
            </span>
            <span className={`action-log-type type-${thought.type}`}>
              {thought.type}
            </span>
            <span className="action-log-content" title={thought.content}>
              {thought.content}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Detail Panel ───────────────────────────────────────────────────────────

function AgentDetailPanel({
  agent,
  onClose,
}: {
  agent: AgentData;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<DetailTab>("overview");

  return (
    <div className="agent-detail-panel">
      <div className="agent-detail-header">
        <h2>
          <User size={18} style={{ marginRight: 8 }} />
          {agent.name}
        </h2>
        <button className="agent-detail-close" onClick={onClose} title="Close">
          <X size={18} />
        </button>
      </div>

      <div className="agent-detail-tabs">
        {(
          [
            ["overview", "Overview"],
            ["skills", "Skills"],
            ["inventory", "Inventory"],
            ["quests", "Quests"],
            ["bank", "Bank"],
            ["actions", "Action Log"],
          ] as [DetailTab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            className={`agent-detail-tab ${tab === key ? "active" : ""}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="agent-detail-content">
        {tab === "overview" && <OverviewTab agent={agent} />}
        {tab === "skills" && <SkillsTab agent={agent} />}
        {tab === "inventory" && <InventoryTab agent={agent} />}
        {tab === "quests" && <QuestsTab agent={agent} />}
        {tab === "bank" && <BankTab agent={agent} />}
        {tab === "actions" && <ActionLogTab agent={agent} />}
      </div>
    </div>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────────────

export const AgentMonitorScreen: React.FC = () => {
  // Auth state
  const [adminCode, setAdminCode] = useState<string>(
    () => localStorage.getItem(ADMIN_CODE_KEY) || "",
  );
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Data state
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // UI state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Admin fetch helper
  const adminFetch = useCallback(
    async (path: string) => {
      const response = await fetch(`${GAME_API_URL}${path}`, {
        headers: {
          "x-admin-code": adminCode,
          "Content-Type": "application/json",
        },
      });

      if (response.status === 403) {
        setIsAuthed(false);
        setAuthError("Invalid admin code");
        localStorage.removeItem(ADMIN_CODE_KEY);
        throw new Error("Unauthorized");
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    },
    [adminCode],
  );

  // Verify admin code
  const verifyAdminCode = useCallback(async () => {
    if (!adminCode) return;
    setAuthLoading(true);
    setAuthError(null);
    try {
      await adminFetch("/admin/stats");
      setIsAuthed(true);
      localStorage.setItem(ADMIN_CODE_KEY, adminCode);
    } catch {
      setIsAuthed(false);
      setAuthError("Invalid admin code");
      localStorage.removeItem(ADMIN_CODE_KEY);
    } finally {
      setAuthLoading(false);
    }
  }, [adminCode, adminFetch]);

  // Auto-verify on load
  useEffect(() => {
    const storedCode = localStorage.getItem(ADMIN_CODE_KEY);
    if (storedCode && adminCode === storedCode) {
      verifyAdminCode();
    }
  }, [verifyAdminCode, adminCode]);

  // Fetch monitor data
  const fetchData = useCallback(async () => {
    if (!isAuthed) return;
    setLoading(true);
    try {
      const result = (await adminFetch(
        "/admin/agents/monitor",
      )) as MonitorResponse;
      setData(result);
      setFetchError(null);
    } catch (err) {
      if (err instanceof Error && err.message !== "Unauthorized") {
        setFetchError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [isAuthed, adminFetch]);

  // Initial fetch
  useEffect(() => {
    if (isAuthed) {
      fetchData();
    }
  }, [isAuthed, fetchData]);

  // Auto-refresh polling
  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (isAuthed && autoRefresh) {
      intervalRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isAuthed, autoRefresh, fetchData]);

  // Get selected agent
  const selectedAgent =
    selectedId && data
      ? (data.agents.find((a) => a.characterId === selectedId) ?? null)
      : null;

  // ─── Auth Gate ──────────────────────────────────────────────────────

  if (!isAuthed) {
    return (
      <div className="agent-monitor">
        <div className="agent-monitor-auth">
          <div className="agent-monitor-auth-card">
            <Swords size={48} style={{ color: "#f2d08a", marginBottom: 24 }} />
            <h1>Agent Monitor</h1>
            <p>Enter admin code to access agent monitoring</p>
            {authError && (
              <div className="agent-monitor-auth-error">{authError}</div>
            )}
            <input
              className="agent-monitor-auth-input"
              type="password"
              placeholder="Admin code"
              value={adminCode}
              onChange={(e) => setAdminCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && verifyAdminCode()}
              autoFocus
            />
            <button
              className="agent-monitor-auth-button"
              onClick={verifyAdminCode}
              disabled={authLoading || !adminCode}
            >
              {authLoading ? "Verifying..." : "Authenticate"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main UI ────────────────────────────────────────────────────────

  return (
    <div className="agent-monitor">
      {/* Header */}
      <div className="agent-monitor-header">
        <div className="agent-monitor-header-left">
          <Swords size={24} style={{ color: "#f2d08a" }} />
          <h1>Agent Monitor</h1>
          <span className="agent-count">
            {data
              ? `${data.agentCount} agent${data.agentCount !== 1 ? "s" : ""} running`
              : "Loading..."}
          </span>
        </div>
        <div className="agent-monitor-header-right">
          <label className="agent-monitor-auto-label">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            Auto: {POLL_INTERVAL_MS / 1000}s
          </label>
          <button
            className={`agent-monitor-refresh-btn ${loading ? "spinning" : ""}`}
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {fetchError && <div className="agent-monitor-error">{fetchError}</div>}

      {/* Empty state */}
      {data && data.agents.length === 0 && (
        <div className="agent-monitor-empty">
          <User size={48} style={{ opacity: 0.3 }} />
          <h2>No agents running</h2>
          <p>Agents will appear here when they are started</p>
        </div>
      )}

      {/* Card grid */}
      {data && data.agents.length > 0 && (
        <div className="agent-card-grid">
          {data.agents.map((agent) => (
            <AgentCard
              key={agent.characterId}
              agent={agent}
              selected={selectedId === agent.characterId}
              onClick={() =>
                setSelectedId(
                  selectedId === agent.characterId ? null : agent.characterId,
                )
              }
            />
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selectedAgent && (
        <AgentDetailPanel
          agent={selectedAgent}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
};
