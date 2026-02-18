/**
 * Browser Capture Script
 *
 * This script is injected into the browser via Playwright to capture
 * the Three.js canvas and stream it via WebSocket to the RTMP bridge.
 *
 * The script uses MediaRecorder API to encode the canvas as WebM/VP9
 * and sends chunks to the server in real-time.
 */

/**
 * Browser-side capture script (as string for Playwright injection)
 */
export const CAPTURE_SCRIPT = `
(function() {
  const BRIDGE_URL = window.__RTMP_BRIDGE_URL__ || 'ws://localhost:8765';
  const TARGET_FPS = window.__TARGET_FPS__ || 30;
  const VIDEO_BITRATE = window.__VIDEO_BITRATE__ || 6000000; // 6 Mbps

  console.log('[Capture] Starting canvas capture...');
  console.log('[Capture] Bridge URL:', BRIDGE_URL);

  // Find the Three.js canvas
  const canvas = document.querySelector('canvas');
  if (!canvas) {
    console.error('[Capture] No canvas element found!');
    return;
  }

  console.log('[Capture] Found canvas:', canvas.width, 'x', canvas.height);

  // Capture stream from canvas
  let stream;
  try {
    stream = canvas.captureStream(TARGET_FPS);
    console.log('[Capture] Created capture stream at', TARGET_FPS, 'fps');
  } catch (err) {
    console.error('[Capture] Failed to capture canvas stream:', err);
    return;
  }

  // Try to add audio context for silent audio track (some RTMP servers require audio)
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 0; // Silent
    oscillator.connect(gainNode);
    const dest = audioCtx.createMediaStreamDestination();
    gainNode.connect(dest);
    oscillator.start();

    // Add silent audio track to stream
    const audioTrack = dest.stream.getAudioTracks()[0];
    if (audioTrack) {
      stream.addTrack(audioTrack);
      console.log('[Capture] Added silent audio track');
    }
  } catch (err) {
    console.warn('[Capture] Could not add audio track:', err);
  }

  // Determine best codec
  let mimeType = 'video/webm;codecs=vp9';
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    mimeType = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = 'video/webm';
    }
  }
  console.log('[Capture] Using MIME type:', mimeType);

  // Connect to RTMP bridge
  let ws;
  let recorder;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;

  function connect() {
    console.log('[Capture] Connecting to bridge...');

    ws = new WebSocket(BRIDGE_URL);

    ws.onopen = () => {
      console.log('[Capture] Connected to RTMP bridge');
      reconnectAttempts = 0;
      startRecording();
    };

    ws.onclose = (event) => {
      console.log('[Capture] WebSocket closed:', event.code, event.reason);
      stopRecording();

      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log('[Capture] Reconnecting in 3s... (attempt ' + reconnectAttempts + ')');
        setTimeout(connect, 3000);
      } else {
        console.error('[Capture] Max reconnection attempts reached');
      }
    };

    ws.onerror = (err) => {
      console.error('[Capture] WebSocket error:', err);
    };
  }

  function startRecording() {
    if (recorder && recorder.state !== 'inactive') {
      console.warn('[Capture] Recorder already active');
      return;
    }

    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        videoBitsPerSecond: VIDEO_BITRATE
      });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0 && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(event.data);
        }
      };

      recorder.onerror = (err) => {
        console.error('[Capture] MediaRecorder error:', err);
      };

      recorder.onstop = () => {
        console.log('[Capture] MediaRecorder stopped');
      };

      // Start recording with 1 second chunks
      recorder.start(1000);
      console.log('[Capture] Recording started');

      // Expose status for debugging
      window.__captureStatus__ = {
        recording: true,
        startTime: Date.now(),
        getStats: () => ({
          recording: recorder.state === 'recording',
          wsConnected: ws && ws.readyState === WebSocket.OPEN,
          uptime: Date.now() - window.__captureStatus__.startTime
        })
      };
    } catch (err) {
      console.error('[Capture] Failed to start recording:', err);
    }
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      recorder = null;
    }
    if (window.__captureStatus__) {
      window.__captureStatus__.recording = false;
    }
  }

  // Expose control functions globally
  window.__captureControl__ = {
    start: connect,
    stop: () => {
      stopRecording();
      if (ws) {
        ws.close();
        ws = null;
      }
    },
    getStatus: () => window.__captureStatus__?.getStats?.() || { recording: false }
  };

  // Auto-start
  connect();

  console.log('[Capture] Capture script loaded. Control via window.__captureControl__');
})();
`;

/**
 * Generate capture script with custom configuration
 */
export function generateCaptureScript(options: {
  bridgeUrl?: string;
  fps?: number;
  bitrate?: number;
}): string {
  const {
    bridgeUrl = "ws://localhost:8765",
    fps = 30,
    bitrate = 6000000,
  } = options;

  return `
    window.__RTMP_BRIDGE_URL__ = '${bridgeUrl}';
    window.__TARGET_FPS__ = ${fps};
    window.__VIDEO_BITRATE__ = ${bitrate};
    ${CAPTURE_SCRIPT}
  `;
}
