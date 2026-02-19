import { useEffect, useRef, useState, useCallback } from "react";
import type { StreamingStateUpdate } from "./types";

const WS_URL =
  import.meta.env.VITE_WS_URL?.replace(/\/$/, "") || "ws://localhost:5555/ws";

export function useStreamingState() {
  const [state, setState] = useState<StreamingStateUpdate | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setIsConnected(true);

    ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data);
        if (data?.type === "STREAMING_STATE_UPDATE") {
          setState(data as StreamingStateUpdate);
        }
      } catch {
        // ignore non-JSON or unrelated messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { state, isConnected };
}
