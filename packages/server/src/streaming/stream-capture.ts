/**
 * Stream Capture - RTMPBridge initialization for HLS streaming
 *
 * Starts the RTMPBridge WebSocket server that receives video frames
 * from the browser's MediaRecorder capture script running in the
 * StreamingMode client page (?page=stream).
 *
 * Pipeline:
 *   Browser (StreamingMode) → canvas.captureStream() → MediaRecorder
 *   → WebSocket (port 8765) → RTMPBridge → FFmpeg → HLS segments
 *   → /live/stream.m3u8 → hls.js player (betting app on port 4179)
 */

import { getRTMPBridge } from "./rtmp-bridge.js";

const RTMP_BRIDGE_PORT = parseInt(process.env.RTMP_BRIDGE_PORT || "8765", 10);

/**
 * Initialize the stream capture pipeline.
 *
 * Starts the RTMPBridge WebSocket server so that the browser's capture
 * script (injected in StreamingMode) can connect and send video frames.
 */
export function initStreamCapture(): boolean {
  const enabled = process.env.STREAMING_CAPTURE_ENABLED !== "false";
  if (!enabled) {
    console.log("[StreamCapture] Disabled via STREAMING_CAPTURE_ENABLED=false");
    return false;
  }

  const bridge = getRTMPBridge();
  bridge.start(RTMP_BRIDGE_PORT);
  console.log(
    `[StreamCapture] RTMPBridge WebSocket server started on port ${RTMP_BRIDGE_PORT}`,
  );
  console.log(
    `[StreamCapture] Waiting for browser capture client to connect...`,
  );
  console.log(
    `[StreamCapture] Open ?page=stream in a browser to start capturing`,
  );

  return true;
}

// Re-export getStreamCapture for shutdown and status compatibility
export function getStreamCapture(): {
  isRunning(): boolean;
  stop(): Promise<void>;
  getStats(): {
    running: boolean;
    bridgeActive: boolean;
    ffmpegRunning: boolean;
    clientConnected: boolean;
  };
} {
  const bridge = getRTMPBridge();
  return {
    isRunning: () => bridge.getStatus().active,
    stop: async () => bridge.stop(),
    getStats: () => {
      const status = bridge.getStatus();
      const stats = bridge.getStats();
      return {
        running: status.active,
        bridgeActive: status.active,
        ffmpegRunning: status.ffmpegRunning,
        clientConnected: status.clientConnected,
        ...stats,
      };
    },
  };
}
