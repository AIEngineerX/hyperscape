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
import type { Entity } from "@hyperscape/shared";
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
  const [worldReady, setWorldReady] = useState(false);
  const [terrainReady, setTerrainReady] = useState(false);
  const [cameraLocked, setCameraLocked] = useState(false);
  const worldRef = useRef<World | null>(null);
  const lastCameraTargetRef = useRef<string | null>(null);
  const terrainPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const terrainTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraRetryTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // WebSocket URL for streaming mode
  const wsUrl = `${GAME_WS_URL}?mode=streaming`;

  const clearTerrainPolling = useCallback(() => {
    if (terrainPollRef.current) {
      clearInterval(terrainPollRef.current);
      terrainPollRef.current = null;
    }
    if (terrainTimeoutRef.current) {
      clearTimeout(terrainTimeoutRef.current);
      terrainTimeoutRef.current = null;
    }
  }, []);

  const clearCameraRetryTimeouts = useCallback(() => {
    for (const timeoutId of cameraRetryTimeoutsRef.current) {
      clearTimeout(timeoutId);
    }
    cameraRetryTimeoutsRef.current = [];
  }, []);

  // Handle world setup
  const handleSetup = useCallback(
    (world: World) => {
      worldRef.current = world;
      setConnected(true);

      world.on(EventType.READY, () => {
        setWorldReady(true);
      });

      // Start terrain readiness polling so we avoid presenting chunk-pop-in.
      clearTerrainPolling();
      terrainPollRef.current = setInterval(() => {
        const terrain = world.getSystem("terrain") as {
          isReady?: () => boolean;
        } | null;
        if (terrain?.isReady?.()) {
          setTerrainReady(true);
          clearTerrainPolling();
        }
      }, 100);

      terrainTimeoutRef.current = setTimeout(() => {
        // Failsafe: don't block forever if terrain readiness signal is missing.
        setTerrainReady(true);
        clearTerrainPolling();
      }, 30000);

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
          clearCameraRetryTimeouts();
          setCameraLocked(false);
          updateCameraTarget(world, state.cameraTarget);
        }

        // Log phase changes based on state
        if (
          state.cycle.phase === "COUNTDOWN" &&
          state.cycle.countdown !== null
        ) {
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
    },
    [clearTerrainPolling, clearCameraRetryTimeouts],
  );

  // Update camera to follow a specific entity
  const updateCameraTarget = useCallback((world: World, targetId: string) => {
    const maxRetries = 40; // More retries since entities may take time to sync
    const retryDelayMs = 500;

    const attemptLock = (attempt: number) => {
      // Strategy 1: Direct entity lookup by ID
      let entity = world.entities?.get(targetId);

      // Strategy 2: Search the players map (entity might be keyed differently)
      if (!entity && world.entities?.players) {
        for (const [, player] of world.entities.players) {
          const playerAny = player as {
            id?: string;
            data?: { id?: string; characterId?: string };
          };
          if (
            playerAny.id === targetId ||
            playerAny.data?.id === targetId ||
            playerAny.data?.characterId === targetId
          ) {
            entity = player as unknown as Entity | null;
            break;
          }
        }
      }

      // Strategy 3: Search all entities (items map includes everything)
      if (!entity && world.entities?.items) {
        for (const [, item] of world.entities.items) {
          if (item.id === targetId) {
            entity = item;
            break;
          }
        }
      }

      if (!entity) {
        if (attempt < maxRetries) {
          if (attempt === 0 || attempt % 10 === 0) {
            const playerCount = world.entities?.players?.size ?? 0;
            const itemCount = world.entities?.items?.size ?? 0;
            console.log(
              `[StreamingMode] Camera target "${targetId}" not found (attempt ${attempt}/${maxRetries}). Players: ${playerCount}, Entities: ${itemCount}`,
            );
          }
          const timeoutId = setTimeout(
            () => attemptLock(attempt + 1),
            retryDelayMs,
          );
          cameraRetryTimeoutsRef.current.push(timeoutId);
        } else {
          console.warn(
            `[StreamingMode] Camera target entity not found after ${maxRetries} retries: ${targetId}`,
          );
          // Even if we can't find the entity, clear the loading overlay
          // so the user at least sees the game world
          setCameraLocked(true);
        }
        return;
      }

      // Get the entity's position - handle various position formats
      let position = (entity as { position?: unknown }).position;

      // If entity has a base object with position (avatar), use that
      const entityWithBase = entity as { base?: { position?: unknown } };
      if (entityWithBase.base?.position) {
        position = entityWithBase.base.position as typeof position;
      }

      // Create a camera target object with position
      // The camera system expects target.position to be Vector3-like
      const cameraTarget: { position: unknown; entity: unknown } = {
        position: position,
        // Include entity reference for systems that need it
        entity: entity,
      };

      // Set camera target via event
      world.emit(EventType.CAMERA_SET_TARGET, {
        target: cameraTarget,
      } as any);

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

      setCameraLocked(true);
      console.log(`[StreamingMode] Camera now following: ${targetId}`);
    };

    attemptLock(0);
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

  useEffect(() => {
    return () => {
      clearTerrainPolling();
      clearCameraRetryTimeouts();
    };
  }, [clearTerrainPolling, clearCameraRetryTimeouts]);

  const needsCameraLock = Boolean(streamingState?.cameraTarget);
  const showLoading =
    !connected ||
    !worldReady ||
    !terrainReady ||
    (needsCameraLock && !cameraLocked);

  const loadingHeadline = !connected
    ? "Connecting to Hyperscape..."
    : !worldReady
      ? "Initializing world systems..."
      : !terrainReady
        ? "Generating terrain..."
        : "Locking camera to active duel...";

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
      {showLoading && (
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
              {loadingHeadline}
            </h2>
            <p style={{ opacity: 0.7 }}>AI Agent Duel Streaming Mode</p>
          </div>
        </div>
      )}
    </div>
  );
}
