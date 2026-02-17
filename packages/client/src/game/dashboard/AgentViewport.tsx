import { GAME_API_URL } from "@/lib/api-config";
import React, { useState, useEffect, useRef, useCallback } from "react";
import type { Agent } from "./types";
import { usePrivy } from "@privy-io/react-auth";

interface AgentViewportProps {
  agent: Agent;
}

export const AgentViewport: React.FC<AgentViewportProps> = ({ agent }) => {
  const [characterId, setCharacterId] = useState<string>("");
  const [authToken, setAuthToken] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [waitingForAgent, setWaitingForAgent] = useState(false);
  // Store spectator token in ref to persist across re-renders
  const spectatorTokenRef = useRef<string | null>(null);
  // Track polling interval for cleanup
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Use Privy hook to get fresh access token (not stale localStorage token)
  const { getAccessToken, user } = usePrivy();

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    fetchSpectatorData();
  }, [agent.id]);

  const fetchSpectatorData = useCallback(
    async (isPolling = false) => {
      if (!isPolling) {
        setError(null);
      }
      try {
        // Get FRESH Privy token using the SDK (not stale localStorage)
        // This ensures we always have a valid, non-expired token
        const privyToken = await getAccessToken();

        if (!privyToken) {
          console.warn(
            "[AgentViewport] No Privy token available - spectator mode requires authentication",
          );
          setError("Please log in to view the agent viewport");
          setLoading(false);
          setWaitingForAgent(false);
          return;
        }

        // Exchange Privy token for permanent spectator JWT
        // This solves the token expiration issue - spectator JWT never expires
        const tokenResponse = await fetch(
          `${GAME_API_URL}/api/spectator/token`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              agentId: agent.id,
              privyToken: privyToken,
            }),
          },
        );

        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          spectatorTokenRef.current = tokenData.spectatorToken;
          setAuthToken(tokenData.spectatorToken);
          setCharacterId(tokenData.characterId || "");
          setWaitingForAgent(false);
          // Clear polling since we got the data
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          console.log(
            "[AgentViewport] Got permanent spectator token for:",
            tokenData.agentName,
          );
        } else if (tokenResponse.status === 401) {
          // Privy token expired - user needs to re-authenticate
          console.warn("[AgentViewport] Privy token expired, need to re-login");
          setError("Session expired. Please log out and log back in.");
          setWaitingForAgent(false);
          // Clear stale token from localStorage
          localStorage.removeItem("privy_auth_token");
        } else if (tokenResponse.status === 403) {
          setError("You don't have permission to view this agent");
          setWaitingForAgent(false);
        } else if (tokenResponse.status === 404) {
          // Agent not yet registered - start polling to wait for it
          console.log(
            "[AgentViewport] Agent not yet registered, waiting for connection...",
          );
          setWaitingForAgent(true);
          setLoading(false);

          // Start polling if not already polling
          if (!pollingIntervalRef.current) {
            pollingIntervalRef.current = setInterval(() => {
              console.log("[AgentViewport] Polling for agent registration...");
              fetchSpectatorData(true);
            }, 3000); // Poll every 3 seconds
          }
          return;
        } else {
          // Fallback: try to get character ID from mapping endpoint
          console.warn(
            "[AgentViewport] Spectator token endpoint failed, falling back to mapping",
          );
          const mappingResponse = await fetch(
            `${GAME_API_URL}/api/agents/mapping/${agent.id}`,
          );
          if (mappingResponse.ok) {
            const mappingData = await mappingResponse.json();
            if (mappingData.characterId) {
              setCharacterId(mappingData.characterId);
              setWaitingForAgent(false);
              // Use Privy token as fallback (will expire)
              setAuthToken(privyToken);
              console.warn(
                "[AgentViewport] Using Privy token as fallback - may expire in ~1 hour",
              );
            } else {
              // No characterId yet, wait for agent
              setWaitingForAgent(true);
              if (!pollingIntervalRef.current) {
                pollingIntervalRef.current = setInterval(() => {
                  fetchSpectatorData(true);
                }, 3000);
              }
              setLoading(false);
              return;
            }
          } else if (mappingResponse.status === 404) {
            // Agent not registered yet - wait for it
            setWaitingForAgent(true);
            if (!pollingIntervalRef.current) {
              pollingIntervalRef.current = setInterval(() => {
                fetchSpectatorData(true);
              }, 3000);
            }
            setLoading(false);
            return;
          }
        }
      } catch (err) {
        console.error("[AgentViewport] Error fetching spectator data:", err);
        if (!isPolling) {
          setError("Failed to connect to server");
        }
      } finally {
        if (!isPolling) {
          setLoading(false);
        }
      }
    },
    [agent.id, getAccessToken],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full bg-[#0b0a15]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#f2d08a]"></div>
      </div>
    );
  }

  // Show error state if there was a problem
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0b0a15] text-[#f2d08a]/60">
        <div className="text-6xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold text-[#f2d08a] mb-2">
          {error.includes("expired") ? "Session Expired" : "Error"}
        </h2>
        <p className="text-center max-w-md mb-4">{error}</p>
        {error.includes("expired") && (
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-[#f2d08a] text-[#0b0a15] rounded-lg font-bold hover:bg-[#f2d08a]/80 transition-colors"
          >
            Refresh Page
          </button>
        )}
      </div>
    );
  }

  // Only load game world when agent is active
  if (agent.status !== "active") {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0b0a15] text-[#f2d08a]/60">
        <div className="text-6xl mb-4">⏸️</div>
        <h2 className="text-xl font-bold text-[#f2d08a] mb-2">
          Agent is {agent.status}
        </h2>
        <p className="text-center max-w-md">
          Start the agent to view the live game world. The agent must be running
          to connect to the game server.
        </p>
      </div>
    );
  }

  // Show waiting state while agent is connecting
  if (waitingForAgent || !characterId) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0b0a15] text-[#f2d08a]/60">
        <div className="text-6xl mb-4">
          <div className="animate-pulse">🔗</div>
        </div>
        <h2 className="text-xl font-bold text-[#f2d08a] mb-2">
          Waiting for Agent to Connect
        </h2>
        <p className="text-center max-w-md mb-4">
          The agent is starting up and connecting to Hyperscape. This viewport
          will activate automatically once the agent enters the game world.
        </p>
        <div className="flex items-center gap-2 text-[#f2d08a]/40 text-sm">
          <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-[#f2d08a]/40"></div>
          <span>Checking connection...</span>
        </div>
      </div>
    );
  }

  if (!authToken) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#0b0a15] text-[#f2d08a]/60">
        <div className="text-6xl mb-4">🔐</div>
        <h2 className="text-xl font-bold text-[#f2d08a] mb-2">
          Authentication Required
        </h2>
        <p className="text-center max-w-md">
          Please log in to view the agent viewport. Spectator mode requires
          authentication to verify character ownership.
        </p>
      </div>
    );
  }

  // Build iframe URL for spectator mode
  // authToken is now a permanent Hyperscape JWT (obtained by exchanging Privy token)
  // This JWT never expires, solving the session timeout issue
  const privyUserId = user?.id || "";

  const iframeParams = new URLSearchParams({
    embedded: "true",
    mode: "spectator",
    agentId: agent.id,
    authToken: authToken, // Permanent spectator JWT (never expires)
    characterId: characterId,
    followEntity: characterId, // Camera will follow this entity
    privyUserId: privyUserId, // For additional verification
    hiddenUI: "chat,inventory,minimap,hotbar,stats",
    quality: "low", // Use low quality for embedded viewports to improve performance
  });

  return (
    <div className="flex flex-col h-full bg-black relative">
      {/* Overlay Info */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-3 pointer-events-none">
        <div className="bg-black/60 backdrop-blur-md border border-[#f2d08a]/30 rounded-lg p-2 flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[#f2d08a] font-bold text-sm uppercase tracking-wider">
            Live Feed
          </span>
          <span className="text-[#f2d08a]/60 text-xs border-l border-[#f2d08a]/20 pl-3">
            {agent.characterName || agent.name}
          </span>
        </div>
      </div>

      {/* Iframe Viewport */}
      <iframe
        className="w-full h-full border-none bg-[#0b0a15]"
        src={`/?${iframeParams.toString()}`}
        allow="autoplay; fullscreen; microphone; camera"
        title={`Viewport: ${agent.characterName || agent.name}`}
      />
    </div>
  );
};
