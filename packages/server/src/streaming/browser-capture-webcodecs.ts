/**
 * WebCodecs Browser Capture Script
 *
 * This script is injected into the browser via Playwright to capture
 * the Three.js canvas using the modern WebCodecs VideoEncoder API.
 *
 * It outputs raw H.264 NAL units (Annex B format) over WebSocket directly
 * to Node, which then pipes them to FFmpeg with stream copy (-c:v copy).
 * This completely bypasses all Node-side and FFmpeg CPU video encoding,
 * allowing 60FPS at minimal overhead.
 */

export const WEBCODECS_CAPTURE_SCRIPT = `
(function() {
  if (window.__captureControl__) {
    try {
      const s = window.__captureControl__.getStatus();
      if (s && s.recording && s.wsConnected) {
        console.log('[WebCodecs Capture] Already active, skipping re-injection');
        return;
      }
    } catch(e) {}
  }

  const BRIDGE_URL = window.__RTMP_BRIDGE_URL__ || 'ws://localhost:8765';
  const TARGET_FPS = window.__TARGET_FPS__ || 60;
  const VIDEO_BITRATE = window.__VIDEO_BITRATE__ || 6000000; // 6 Mbps

  console.log('[WebCodecs Capture] Starting direct hardware capture...');
  console.log('[WebCodecs Capture] Bridge URL:', BRIDGE_URL);
  console.log('[WebCodecs Capture] Target:', TARGET_FPS, 'fps @', VIDEO_BITRATE, 'bps');

  const canvas = document.querySelector('canvas');
  if (!canvas) {
    console.error('[WebCodecs Capture] No canvas element found!');
    return;
  }

  console.log('[WebCodecs Capture] Found canvas:', canvas.width, 'x', canvas.height);

  let stream = null;
  let ws = null;
  let encoder = null;
  let processor = null;
  let frameReader = null;

  let chunkCount = 0;
  let bytesSent = 0;
  let startTime = 0;
  let lastFrameTime = 0;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let stopped = false;
  const MAX_RECONNECT_ATTEMPTS = 5;

  let captureFps = 0;
  let frameCountForFps = 0;
  let lastFpsCalcTime = Date.now();

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    console.log('[WebCodecs Capture] Connecting to RTMP bridge...', BRIDGE_URL);
    ws = new WebSocket(BRIDGE_URL);

    // Send binary data directly (NAL units)
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('[WebCodecs Capture] WebSocket connected');
      reconnectAttempts = 0;
      startEncoding();
    };

    ws.onclose = () => {
      console.log('[WebCodecs Capture] WebSocket closed');
      stopEncoding();

      if (!stopped && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
        console.log('[WebCodecs Capture] Reconnecting in', delay, 'ms... (Attempt', reconnectAttempts, 'of', MAX_RECONNECT_ATTEMPTS, ')');
        if (reconnectTimer) {
          clearTimeout(reconnectTimer);
        }
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectWebSocket();
        }, delay);
      } else if (!stopped) {
        console.error('[WebCodecs Capture] Max reconnection attempts reached');
      }
    };

    ws.onerror = (err) => {
      console.error('[WebCodecs Capture] WebSocket error:', err);
    };
  }

  async function startEncoding() {
    if (encoder && encoder.state !== 'closed') {
       console.warn('[WebCodecs Capture] Encoder already active');
       return;
    }

    if (!stream) {
      try {
        stream = canvas.captureStream(TARGET_FPS);
        console.log('[WebCodecs Capture] Created canvas stream at', TARGET_FPS, 'fps');
      } catch (err) {
        console.error('[WebCodecs Capture] Failed to capture canvas string:', err);
        return;
      }
    }

    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) {
       console.error('[WebCodecs Capture] No video track in stream!');
       return;
    }

    // Initialize VideoEncoder
    encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;

        // chunk is an EncodedVideoChunk. We need to copy its data to an ArrayBuffer
        const buffer = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(buffer);

        // Calculate FPS
        chunkCount++;
        frameCountForFps++;
        bytesSent += chunk.byteLength;
        lastFrameTime = Date.now();

        const now = Date.now();
        if (now - lastFpsCalcTime >= 1000) {
            captureFps = frameCountForFps;
            frameCountForFps = 0;
            lastFpsCalcTime = now;
        }

        // Send H.264 NAL unit to bridge
        ws.send(buffer);
      },
      error: (e) => {
        console.error('[WebCodecs Capture] VideoEncoder error:', e);
      }
    });

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    const encoderConfig = {
      codec: 'avc1.42E01F', // H.264 Baseline, Level 3.1
      width: canvas.width,
      height: canvas.height,
      bitrate: VIDEO_BITRATE,
      framerate: TARGET_FPS,
      latencyMode: 'realtime', // Important for live streaming
      avc: { format: 'annexb' } // CRITICAL: forces inline SPS/PPS headers
    };

    // Mac VideoToolbox hardware encoder handles high bitrate well, others might need tuning
    if (!isMac) {
       // Optional fallback tweaks for other platforms
    }

    try {
        const support = await VideoEncoder.isConfigSupported(encoderConfig);
        if (!support.supported) {
            console.error('[WebCodecs Capture] Configuration not supported:', encoderConfig);
            return;
        }
        encoder.configure(encoderConfig);
        console.log('[WebCodecs Capture] Encoder configured:', encoderConfig);
    } catch(e) {
        console.error('[WebCodecs Capture] Failed to configure encoder:', e);
        return;
    }

    startTime = Date.now();

    // The MediaStreamTrackProcessor API pulls raw frames from the canvas stream
    try {
        processor = new MediaStreamTrackProcessor({ track: videoTrack });
        frameReader = processor.readable.getReader();

        const readFrame = async () => {
            if (!encoder || encoder.state === 'closed') return;

            try {
                const { done, value: frame } = await frameReader.read();
                if (done) {
                    console.log('[WebCodecs Capture] Track ended');
                    return;
                }

                // If WebSocket backlog is huge due to network stall, skip encoding to prevent memory leak
                if (ws && ws.bufferedAmount > VIDEO_BITRATE) {
                    frame.close(); // drop frame
                } else if (encoder.encodeQueueSize > 5) {
                    // Encoder is backlogged, drop frame
                    frame.close();
                } else {
                    // Keyframe every 1 second for ultra-fast joining logic bounds
                    const keyFrame = (chunkCount % (TARGET_FPS * 1)) === 0;
                    encoder.encode(frame, { keyFrame });
                    frame.close();
                }

                // Loop
                readFrame();
            } catch (e) {
                console.error('[WebCodecs Capture] Frame read error:', e);
            }
        };

        readFrame();
        console.log('[WebCodecs Capture] Hardware encoding loop started');

    } catch(e) {
        console.error('[WebCodecs Capture] Failed to start frame processor:', e);
    }
  }

  function stopEncoding() {
    if (frameReader) {
        frameReader.cancel();
        frameReader = null;
    }
    if (encoder && encoder.state !== 'closed') {
        encoder.close();
    }
    encoder = null;

    // Do not stop the stream to allow fast restarts
  }

  function stop() {
    console.log('[WebCodecs Capture] Stopping stream...');
    stopped = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    stopEncoding();

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }

    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function getStatus() {
    return {
      recording: encoder && encoder.state === 'configured',
      wsConnected: ws && ws.readyState === WebSocket.OPEN,
      chunkCount,
      bytesSent,
      uptime: startTime > 0 ? Date.now() - startTime : 0,
      lastChunkMs: lastFrameTime > 0 ? Date.now() - lastFrameTime : 0,
      captureFps,
      bufferedAmount: ws ? ws.bufferedAmount : 0,
      encodeQueue: encoder ? encoder.encodeQueueSize : 0
    };
  }

  // Expose global control object
  window.__captureControl__ = {
    stop,
    getStatus
  };

  // Start connection
  connectWebSocket();

})();
`;

export function generateWebCodecsCaptureScript(config: {
  bridgeUrl: string;
  fps: number;
  bitrate: number;
}): string {
  // Inject configuration variables into the script window object
  const preamble = `
    window.__RTMP_BRIDGE_URL__ = ${JSON.stringify(config.bridgeUrl)};
    window.__TARGET_FPS__ = ${config.fps};
    window.__VIDEO_BITRATE__ = ${config.bitrate};
  `;
  return preamble + WEBCODECS_CAPTURE_SCRIPT;
}
