import React, { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import goldPerpsIdl from "../idl/gold_perps_market.json";
import { Toaster, toast } from "sonner";
import { useChain } from "../lib/ChainContext";

/**
 * PerpsMarketPanel — Multi-chain perpetual futures trading UI.
 *
 * Collateral token by chain:
 *   Solana  →  SOL  (native lamports, 9 decimals)
 *   BSC     →  BNB  (native wei, 18 decimals) — handled externally via EVM panel
 *   Base    →  ETH  (native wei, 18 decimals) — handled externally via EVM panel
 *
 * This panel currently handles the Solana side.
 * EVM perps are submitted through the EvmPerpsPanel which calls AgentPerpEngineNative.
 */

interface PerpsMarketPanelProps {
  agent1Name: string;
  agent2Name: string;
  agent1Id: number;
  agent2Id: number;
}

const PROGRAM_ID = new PublicKey(
  "3WKQf3J4B8QqRyWcBLR7xrb9VFPVjkZwzyZS67AahDbK",
);

interface PositionRow {
  agentId: number;
  type: number; // 0 Long, 1 Short
  size: number; // in SOL units
  collateral: number; // in SOL units
  entryPrice: number;
  markPrice: number;
  pnl: number;
  liquidationPrice: number;
}

/** Native decimals per chain */
const NATIVE_LABEL: Record<string, string> = {
  solana: "SOL",
  bsc: "BNB",
  base: "ETH",
};

/** Lamports → SOL display */
function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/** SOL → lamports for on-chain amounts */
function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

export function PerpsMarketPanel({
  agent1Name,
  agent2Name,
  agent1Id,
  agent2Id,
}: PerpsMarketPanelProps) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { activeChain } = useChain();

  const nativeLabel = NATIVE_LABEL[activeChain] ?? "SOL";

  const [agent1Spot, setAgent1Spot] = useState<number | null>(null);
  const [agent2Spot, setAgent2Spot] = useState<number | null>(null);

  // Form states
  const [a1Leverage, setA1Leverage] = useState<number>(2);
  const [a2Leverage, setA2Leverage] = useState<number>(2);
  // Collateral expressed in native token units (e.g. 0.05 SOL)
  const [a1Collateral, setA1Collateral] = useState<number>(0.05);
  const [a2Collateral, setA2Collateral] = useState<number>(0.05);

  const [loadingTx, setLoadingTx] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<number>(agent1Id);
  const [positions, setPositions] = useState<PositionRow[]>([]);
  const [marketData, setMarketData] = useState<Record<number, any>>({});

  // ─────────────────────────────── Data Fetching ──

  const fetchState = async () => {
    try {
      const provider = new anchor.AnchorProvider(connection, wallet as any, {
        commitment: "confirmed",
      });
      const program = new anchor.Program(
        goldPerpsIdl as anchor.Idl,
        provider,
      ) as any;

      const [oracle1Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("oracle"),
          new anchor.BN(agent1Id).toArrayLike(Buffer, "le", 4),
        ],
        PROGRAM_ID,
      );
      const [oracle2Pda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("oracle"),
          new anchor.BN(agent2Id).toArrayLike(Buffer, "le", 4),
        ],
        PROGRAM_ID,
      );

      let s1: number | null = null,
        s2: number | null = null;
      let oiLong1 = 0,
        oiShort1 = 0,
        funding1 = 0;
      let oiLong2 = 0,
        oiShort2 = 0,
        funding2 = 0;

      try {
        const acc1 = await program.account.oracleState.fetch(oracle1Pda);
        // spot_index is stored with 9 decimal lamport scaling
        s1 = acc1.spotIndex.toNumber() / LAMPORTS_PER_SOL;
        oiLong1 = acc1.totalLongOi.toNumber() / LAMPORTS_PER_SOL;
        oiShort1 = acc1.totalShortOi.toNumber() / LAMPORTS_PER_SOL;
        funding1 = acc1.currentFundingRate.toNumber() / LAMPORTS_PER_SOL;
      } catch (_) {}

      try {
        const acc2 = await program.account.oracleState.fetch(oracle2Pda);
        s2 = acc2.spotIndex.toNumber() / LAMPORTS_PER_SOL;
        oiLong2 = acc2.totalLongOi.toNumber() / LAMPORTS_PER_SOL;
        oiShort2 = acc2.totalShortOi.toNumber() / LAMPORTS_PER_SOL;
        funding2 = acc2.currentFundingRate.toNumber() / LAMPORTS_PER_SOL;
      } catch (_) {}

      setAgent1Spot(s1);
      setAgent2Spot(s2);
      setMarketData({
        [agent1Id]: {
          long: oiLong1,
          short: oiShort1,
          funding: funding1,
          spot: s1,
        },
        [agent2Id]: {
          long: oiLong2,
          short: oiShort2,
          funding: funding2,
          spot: s2,
        },
      });

      // Fetch user positions if connected
      if (wallet.publicKey) {
        const [pos1Pda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("position"),
            wallet.publicKey.toBuffer(),
            new anchor.BN(agent1Id).toArrayLike(Buffer, "le", 4),
          ],
          PROGRAM_ID,
        );
        const [pos2Pda] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("position"),
            wallet.publicKey.toBuffer(),
            new anchor.BN(agent2Id).toArrayLike(Buffer, "le", 4),
          ],
          PROGRAM_ID,
        );

        const activePositions: PositionRow[] = [];

        const checkPos = async (
          pda: PublicKey,
          agentId: number,
          markPrice: number | null,
        ) => {
          try {
            const acc = await program.account.positionState.fetch(pda);
            // Convert lamports → SOL for display
            const size = acc.size.toNumber() / LAMPORTS_PER_SOL;
            const collateral = acc.collateral.toNumber() / LAMPORTS_PER_SOL;
            const entryPrice = acc.entryPrice.toNumber() / LAMPORTS_PER_SOL;

            let pnl = 0,
              liqPrice = 0;
            if (markPrice) {
              if (acc.positionType === 0) {
                pnl = (markPrice - entryPrice) * (size / entryPrice);
                liqPrice = entryPrice * (1 - (collateral * 0.9) / size);
              } else {
                pnl = (entryPrice - markPrice) * (size / entryPrice);
                liqPrice = entryPrice * (1 + (collateral * 0.9) / size);
              }
            }
            activePositions.push({
              agentId,
              type: acc.positionType,
              size,
              collateral,
              entryPrice,
              markPrice: markPrice ?? 0,
              pnl,
              liquidationPrice: liqPrice,
            });
          } catch (_) {}
        };

        await checkPos(pos1Pda, agent1Id, s1);
        await checkPos(pos2Pda, agent2Id, s2);
        setPositions(activePositions);
      }
    } catch (err) {
      console.error("Failed to fetch perps state", err);
    }
  };

  useEffect(() => {
    let active = true;
    const doFetch = async () => {
      if (active) await fetchState();
    };
    doFetch();
    const interval = setInterval(doFetch, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [connection, wallet.publicKey, agent1Id, agent2Id]);

  // ─────────────────────────────── Open Position ──

  const handleOpenPosition = async (
    agentId: number,
    positionType: number,
    collateralSol: number,
    lev: number,
  ) => {
    if (!wallet.connected || !wallet.publicKey) {
      toast.error("Please connect your wallet to trade");
      return;
    }

    const txId = `open-${agentId}-${positionType}`;
    setLoadingTx(txId);
    toast.loading(
      `Opening ${lev}x ${positionType === 0 ? "Long" : "Short"} (${nativeLabel} margin)...`,
      { id: txId },
    );

    try {
      const provider = new anchor.AnchorProvider(connection, wallet as any, {
        commitment: "confirmed",
      });
      const program = new anchor.Program(
        goldPerpsIdl as anchor.Idl,
        provider,
      ) as any;

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        PROGRAM_ID,
      );
      const [oraclePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("oracle"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 4),
        ],
        PROGRAM_ID,
      );
      const [positionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          wallet.publicKey.toBuffer(),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 4),
        ],
        PROGRAM_ID,
      );

      // Collateral is in SOL units → convert to lamports
      const collateralLamports = new anchor.BN(solToLamports(collateralSol));
      const leverageBN = new anchor.BN(lev);

      await program.methods
        .openPosition(agentId, positionType, collateralLamports, leverageBN)
        .accountsPartial({
          position: positionPda,
          trader: wallet.publicKey,
          vault: vaultPda,
          oracle: oraclePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      toast.success(
        `Position opened! Collateral: ${collateralSol} ${nativeLabel}`,
        { id: txId },
      );
      await fetchState();
    } catch (e: any) {
      console.error("Open Position Error:", e);
      toast.error(`Error: ${e.message}`, { id: txId });
    } finally {
      setLoadingTx(null);
    }
  };

  // ─────────────────────────────── Close Position ──

  const handleClosePosition = async (agentId: number) => {
    if (!wallet.connected || !wallet.publicKey) return;

    const txId = `close-${agentId}`;
    setLoadingTx(txId);
    toast.loading(`Closing position...`, { id: txId });

    try {
      const provider = new anchor.AnchorProvider(connection, wallet as any, {
        commitment: "confirmed",
      });
      const program = new anchor.Program(
        goldPerpsIdl as anchor.Idl,
        provider,
      ) as any;

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault")],
        PROGRAM_ID,
      );
      const [oraclePda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("oracle"),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 4),
        ],
        PROGRAM_ID,
      );
      const [positionPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("position"),
          wallet.publicKey.toBuffer(),
          new anchor.BN(agentId).toArrayLike(Buffer, "le", 4),
        ],
        PROGRAM_ID,
      );

      await program.methods
        .closePosition()
        .accountsPartial({
          position: positionPda,
          owner: wallet.publicKey,
          oracle: oraclePda,
          vault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      toast.success(`Position closed! ${nativeLabel} returned to wallet.`, {
        id: txId,
      });
      await fetchState();
    } catch (e: any) {
      console.error("Close Error:", e);
      toast.error(`Error closing: ${e.message}`, { id: txId });
    } finally {
      setLoadingTx(null);
    }
  };

  // ─────────────────────────────── Derived values ──

  const agentSpot = selectedAgent === agent1Id ? agent1Spot : agent2Spot;
  const agentCollateral =
    selectedAgent === agent1Id ? a1Collateral : a2Collateral;
  const setAgentCollateral =
    selectedAgent === agent1Id ? setA1Collateral : setA2Collateral;
  const agentLeverage = selectedAgent === agent1Id ? a1Leverage : a2Leverage;
  const setAgentLeverage =
    selectedAgent === agent1Id ? setA1Leverage : setA2Leverage;
  const openPosition = positions.find((p) => p.agentId === selectedAgent);
  const md = marketData[selectedAgent];

  // Estimated execution price based on current OI skew (mirrors on-chain math)
  function estimateExecPrice(isLong: boolean): number | null {
    if (!agentSpot || !md) return null;
    const skewScale = 1_000_000; // 1M SOL default skew scale
    const posSize = agentCollateral * agentLeverage;
    const skew = md.long - md.short;
    const sizeDelta = isLong ? posSize : -posSize;
    const premium = (skew + sizeDelta / 2) / skewScale;
    return agentSpot * (1 + premium);
  }

  const estLongPrice = estimateExecPrice(true);
  const estShortPrice = estimateExecPrice(false);

  // ─────────────────────────────── Render ──

  return (
    <div className="perp-wrap">
      <Toaster theme="dark" position="bottom-right" />

      {/* Chain badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "8px",
        }}
      >
        <span
          style={{
            background: "rgba(153,69,255,0.15)",
            border: "1px solid rgba(153,69,255,0.4)",
            borderRadius: "4px",
            padding: "2px 8px",
            fontSize: "11px",
            color: "#9945FF",
            fontWeight: 600,
          }}
        >
          ☀️ SOLANA · Margin: {nativeLabel}
        </span>
      </div>

      {/* Agent selector */}
      <div className="perp-agent-selector">
        <button
          className={`perp-agent-btn ${selectedAgent === agent1Id ? "perp-agent-btn--active" : ""}`}
          onClick={() => setSelectedAgent(agent1Id)}
          type="button"
        >
          {agent1Name}
        </button>
        <button
          className={`perp-agent-btn ${selectedAgent === agent2Id ? "perp-agent-btn--active" : ""}`}
          onClick={() => setSelectedAgent(agent2Id)}
          type="button"
        >
          {agent2Name}
        </button>
      </div>

      {/* Spot price row */}
      <div className="perp-spot-row">
        <div className="perp-spot-indicator">
          <span
            className="perp-spot-dot"
            style={{
              background: agentSpot ? "#22c55e" : "#555",
              boxShadow: agentSpot ? "0 0 6px #22c55e" : "none",
            }}
          />
          <span className="perp-spot-label">INDEX ({nativeLabel})</span>
        </div>
        <span className="perp-spot-price">
          {agentSpot !== null ? `$${agentSpot.toFixed(4)}` : "—"}
        </span>
      </div>

      {/* Market stats (OI and Funding) */}
      {md && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "10px",
            fontSize: "11px",
            color: "#888",
          }}
        >
          <span>
            Long OI:{" "}
            <strong style={{ color: "#22c55e" }}>
              {md.long.toFixed(2)} {nativeLabel}
            </strong>
          </span>
          <span>·</span>
          <span>
            Short OI:{" "}
            <strong style={{ color: "#ef4444" }}>
              {md.short.toFixed(2)} {nativeLabel}
            </strong>
          </span>
          <span>·</span>
          <span>
            Funding:{" "}
            <strong style={{ color: md.funding >= 0 ? "#ef4444" : "#22c55e" }}>
              {md.funding.toFixed(6)}
            </strong>
          </span>
        </div>
      )}

      {/* Active position badge */}
      {openPosition && (
        <div
          className={`perp-pos-badge ${openPosition.type === 0 ? "perp-pos-badge--long" : "perp-pos-badge--short"}`}
        >
          <div className="perp-pos-badge-row">
            <span>
              {openPosition.type === 0 ? "▲ LONG" : "▼ SHORT"} ·{" "}
              {openPosition.size.toFixed(4)} {nativeLabel}
            </span>
            <span
              className={
                openPosition.pnl >= 0 ? "pnl-positive" : "pnl-negative"
              }
            >
              {openPosition.pnl >= 0 ? "+" : ""}
              {openPosition.pnl.toFixed(6)} {nativeLabel}
            </span>
          </div>
          <div className="perp-pos-badge-row perp-pos-badge-row--sub">
            <span>Entry ${openPosition.entryPrice.toFixed(4)}</span>
            <span>
              Liq{" "}
              <span style={{ color: "#eab308" }}>
                ${openPosition.liquidationPrice.toFixed(4)}
              </span>
            </span>
            <button
              className="perp-pos-close-btn"
              onClick={() => handleClosePosition(selectedAgent)}
              disabled={!!loadingTx}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Collateral input */}
      <div className="perp-field">
        <label className="perp-field-label">
          Collateral <span className="perp-field-unit">{nativeLabel}</span>
        </label>
        <input
          className="perp-field-input"
          type="number"
          value={agentCollateral}
          onChange={(e) => setAgentCollateral(Number(e.target.value))}
          min={0.001}
          step={0.01}
        />
      </div>

      {/* Leverage */}
      <div className="perp-field">
        <div className="perp-field-header">
          <label className="perp-field-label">Leverage</label>
          <span className="perp-lev-display">{agentLeverage}x</span>
        </div>
        <div className="perp-lev-presets">
          {[1, 2, 5, 10].map((lv) => (
            <button
              key={lv}
              className={`perp-lev-btn ${agentLeverage === lv ? "perp-lev-btn--active" : ""}`}
              onClick={() => setAgentLeverage(lv)}
              type="button"
            >
              {lv}x
            </button>
          ))}
        </div>
        <input
          type="range"
          className="perp-slider"
          min={1}
          max={10}
          step={1}
          value={agentLeverage}
          onChange={(e) => setAgentLeverage(Number(e.target.value))}
        />
      </div>

      {/* Order summary */}
      <div className="perp-summary">
        <div className="perp-summary-row">
          <span>Position Size</span>
          <span className="perp-summary-val">
            {(agentCollateral * agentLeverage).toFixed(4)} {nativeLabel}
          </span>
        </div>

        {estLongPrice !== null && (
          <div className="perp-summary-row">
            <span style={{ fontSize: "11px", color: "#aaa" }}>
              Est. Exec Price (Long)
            </span>
            <span style={{ fontSize: "11px", color: "#22c55e" }}>
              ${estLongPrice.toFixed(4)}
            </span>
          </div>
        )}
        {estShortPrice !== null && (
          <div className="perp-summary-row">
            <span style={{ fontSize: "11px", color: "#aaa" }}>
              Est. Exec Price (Short)
            </span>
            <span style={{ fontSize: "11px", color: "#ef4444" }}>
              ${estShortPrice.toFixed(4)}
            </span>
          </div>
        )}

        {agentSpot && agentLeverage > 1 && (
          <>
            <div className="perp-summary-row" style={{ marginTop: "8px" }}>
              <span>Est. Liq (Long)</span>
              <span style={{ color: "#ef4444" }}>
                $
                {(
                  agentSpot *
                  (1 -
                    (agentCollateral * 0.9) / (agentCollateral * agentLeverage))
                ).toFixed(4)}
              </span>
            </div>
            <div className="perp-summary-row">
              <span>Est. Liq (Short)</span>
              <span style={{ color: "#22c55e" }}>
                $
                {(
                  agentSpot *
                  (1 +
                    (agentCollateral * 0.9) / (agentCollateral * agentLeverage))
                ).toFixed(4)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* LONG / SHORT buttons */}
      <div className="perp-action-row">
        <button
          id="perps-long-btn"
          className="perp-btn-long"
          disabled={!!loadingTx || agentCollateral <= 0}
          onClick={() =>
            handleOpenPosition(selectedAgent, 0, agentCollateral, agentLeverage)
          }
          type="button"
        >
          ▲ LONG {agentLeverage}x
        </button>
        <button
          id="perps-short-btn"
          className="perp-btn-short"
          disabled={!!loadingTx || agentCollateral <= 0}
          onClick={() =>
            handleOpenPosition(selectedAgent, 1, agentCollateral, agentLeverage)
          }
          type="button"
        >
          ▼ SHORT {agentLeverage}x
        </button>
      </div>

      <div className="perp-footer-note">
        <span>
          Margin held in <strong>{nativeLabel}</strong> · By trading, you agree
          to our <a href="#">Terms</a> &amp; <a href="#">Privacy</a>
        </span>
      </div>
    </div>
  );
}
