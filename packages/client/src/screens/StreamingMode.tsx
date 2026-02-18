/**
 * StreamingMode - Full-screen streaming mode for AI agent duels
 *
 * Features:
 * - Auto-connects without login
 * - Shows duel info overlay (contestants, HP, timer)
 * - Leaderboard panel on the left
 * - Camera auto-follows agents
 * - No standard UI (inventory, chat, etc.)
 */

import React, { useEffect, useState, useRef, useCallback } from "react";
import { GameClient } from "./GameClient";
import { StreamingOverlay } from "../components/streaming/StreamingOverlay";
import type { World } from "@hyperscape/shared";
import { EventType } from "@hyperscape/shared";
import { GAME_WS_URL, GAME_API_URL } from "../lib/api-config";

/** Streaming state from server */
export interface StreamingState {
  type: "STREAMING_STATE_UPDATE";
  cycle: {
    cycleId: string;
    phase: "IDLE" | "ANNOUNCEMENT" | "COUNTDOWN" | "FIGHTING" | "RESOLUTION";
    cycleStartTime: number;
    phaseStartTime: number;
    phaseEndTime: number;
    timeRemaining: number;
    agent1: AgentInfo | null;
    agent2: AgentInfo | null;
    countdown: number | null;
    winnerId: string | null;
    winnerName: string | null;
    winReason: string | null;
  };
  leaderboard: LeaderboardEntry[];
  cameraTarget: string | null;
}

export interface AgentInfo {
  id: string;
  name: string;
  provider: string;
  model: string;
  hp: number;
  maxHp: number;
  combatLevel: number;
  wins: number;
  losses: number;
  damageDealtThisFight: number;
}

export interface LeaderboardEntry {
  rank: number;
  characterId: string;
  name: string;
  provider: string;
  model: string;
  wins: number;
  losses: number;
  winRate: number;
  combatLevel: number;
  currentStreak: number;
}

export function StreamingMode() {
  const [streamingState, setStreamingState] = useState<StreamingState | null>(
    null,
  );
  const [connected, setConnected] = useState(false);
  const worldRef = useRef<World | null>(null);
  const lastCameraTargetRef = useRef<string | null>(null);

  // WebSocket URL for streaming mode
  const wsUrl = `${GAME_WS_URL}?mode=streaming`;

  // Handle world setup
  const handleSetup = useCallback((world: World) => {
    worldRef.current = world;
    setConnected(true);

    // Subscribe to streaming state updates (forwarded from server via WebSocket)
    world.on("streaming:state:update", (data: unknown) => {
      const state = data as StreamingState;
      setStreamingState(state);

      // Update camera target if changed
      if (
        state.cameraTarget &&
        state.cameraTarget !== lastCameraTargetRef.current
      ) {
        lastCameraTargetRef.current = state.cameraTarget;
        updateCameraTarget(world, state.cameraTarget);
      }

      // Log phase changes based on state
      if (state.cycle.phase === "COUNTDOWN" && state.cycle.countdown !== null) {
        console.log(`[StreamingMode] Countdown: ${state.cycle.countdown}`);
      }
    });

    // Disable player controls (spectator mode)
    const inputSystem = world.getSystem("client-input") as {
      disable?: () => void;
      setEnabled?: (enabled: boolean) => void;
    } | null;

    if (inputSystem?.disable) {
      inputSystem.disable();
    } else if (inputSystem?.setEnabled) {
      inputSystem.setEnabled(false);
    }

    console.log("[StreamingMode] World setup complete");
  }, []);

  // Update camera to follow a specific entity
  const updateCameraTarget = useCallback((world: World, targetId: string) => {
    // Find the entity
    const entity = world.entities?.get(targetId);
    if (!entity) {
      console.warn(
        `[StreamingMode] Camera target entity not found: ${targetId}`,
      );
      return;
    }

    // Get the entity's position - handle various position formats
    let position = entity.position;

    // If entity has a base object with position (avatar), use that
    const entityWithBase = entity as { base?: { position?: unknown } };
    if (entityWithBase.base?.position) {
      position = entityWithBase.base.position as typeof position;
    }

    // Create a camera target object with position
    // The camera system expects target.position to be Vector3-like
    const cameraTarget = {
      position: position,
      // Include entity reference for systems that need it
      entity: entity,
    };

    // Set camera target via event
    world.emit(EventType.CAMERA_SET_TARGET, {
      target: cameraTarget,
    });

    // Also try direct camera system access as fallback
    const cameraSystem = world.getSystem("client-camera") as {
      setTarget?: (target: unknown) => void;
      followEntity?: (entity: unknown) => void;
    } | null;

    if (cameraSystem?.followEntity) {
      cameraSystem.followEntity(entity);
    } else if (cameraSystem?.setTarget) {
      cameraSystem.setTarget(cameraTarget);
    }

    console.log(`[StreamingMode] Camera now following: ${targetId}`);
  }, []);

  // Poll for initial state if not received via WebSocket
  useEffect(() => {
    if (connected && !streamingState) {
      // Try to fetch initial state via HTTP
      const stateUrl = `${GAME_API_URL}/api/streaming/state`;
      fetch(stateUrl)
        .then((res) => res.json())
        .then((data) => {
          if (data && data.type === "STREAMING_STATE_UPDATE") {
            setStreamingState(data);
          }
        })
        .catch((err) => {
          console.warn("[StreamingMode] Failed to fetch initial state:", err);
        });
    }
  }, [connected, streamingState]);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#000",
        position: "relative",
      }}
    >
      {/* Game client (fullscreen, no UI) */}
      <GameClient wsUrl={wsUrl} onSetup={handleSetup} hideUI={true} />

      {/* Streaming overlay (on top of game) */}
      <StreamingOverlay state={streamingState} />

      {/* Loading indicator */}
      {!connected && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.8)",
            zIndex: 100,
          }}
        >
          <div style={{ textAlign: "center", color: "#f2d08a" }}>
            <h2 style={{ fontSize: "2rem", marginBottom: "1rem" }}>
              Connecting to Hyperscape...
            </h2>
            <p style={{ opacity: 0.7 }}>AI Agent Duel Streaming Mode</p>
          </div>
        </div>
      )}
    </div>
  );
}
