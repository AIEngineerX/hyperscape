/**
 * RTMP Bridge Server
 *
 * Receives video chunks from browser via WebSocket and pipes them
 * to FFmpeg for encoding and multi-destination RTMP streaming.
 *
 * Architecture:
 *   Browser (MediaRecorder) → WebSocket → This Server → FFmpeg → Multiple RTMP endpoints
 *
 * Uses FFmpeg's tee muxer to send one encoded stream to multiple destinations
 * efficiently (single encode, multiple outputs).
 */

import { spawn, type ChildProcess } from "child_process";
import { WebSocketServer, WebSocket } from "ws";
import type {
  RTMPDestination,
  StreamingConfig,
  StreamingStatus,
  DestinationStatus,
} from "./types.js";
import { DEFAULT_STREAMING_CONFIG } from "./types.js";

export class RTMPBridge {
  private wss: WebSocketServer | null = null;
  private ffmpeg: ChildProcess | null = null;
  private client: WebSocket | null = null;
  private destinations: RTMPDestination[] = [];
  private config: StreamingConfig;
  private status: StreamingStatus;
  private bytesReceived: number = 0;
  private startTime: number = 0;

  /** FFmpeg crash recovery state */
  private ffmpegRestartAttempts: number = 0;
  private lastFFmpegCrash: number = 0;
  private ffmpegRestartTimeout: ReturnType<typeof setTimeout> | null = null;

  /** Health monitoring interval */
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;

  /** Last data received timestamp for health monitoring */
  private lastDataReceived: number = 0;

  /** Maximum restart attempts before giving up */
  private static readonly MAX_RESTART_ATTEMPTS = 5;

  /** Base delay for exponential backoff (ms) */
  private static readonly BASE_RESTART_DELAY = 1000;

  /** Maximum delay between restart attempts (ms) */
  private static readonly MAX_RESTART_DELAY = 60000;

  /** Health check interval (ms) */
  private static readonly HEALTH_CHECK_INTERVAL = 10000;

  /** Timeout for no data before considering unhealthy (ms) */
  private static readonly DATA_TIMEOUT = 30000;

  constructor(config: Partial<StreamingConfig> = {}) {
    this.config = { ...DEFAULT_STREAMING_CONFIG, ...config };
    this.status = {
      active: false,
      destinations: [],
      ffmpegRunning: false,
      clientConnected: false,
    };
  }

  /**
   * Load RTMP destinations from environment variables
   * Adds to any manually configured destinations
   */
  loadDestinationsFromEnv(): void {
    // Keep any manually added destinations, just add from env
    const existingNames = new Set(this.destinations.map((d) => d.name));

    // Twitch
    if (process.env.TWITCH_STREAM_KEY && !existingNames.has("Twitch")) {
      const server = process.env.TWITCH_RTMP_SERVER || "live.twitch.tv/app";
      this.destinations.push({
        name: "Twitch",
        url: `rtmp://${server}`,
        key: process.env.TWITCH_STREAM_KEY,
        enabled: true,
      });
    }

    // YouTube
    if (process.env.YOUTUBE_STREAM_KEY && !existingNames.has("YouTube")) {
      this.destinations.push({
        name: "YouTube",
        url: "rtmp://a.rtmp.youtube.com/live2",
        key: process.env.YOUTUBE_STREAM_KEY,
        enabled: true,
      });
    }

    // Pump.fun (full URL provided)
    if (process.env.PUMPFUN_RTMP_URL && !existingNames.has("Pump.fun")) {
      this.destinations.push({
        name: "Pump.fun",
        url: process.env.PUMPFUN_RTMP_URL,
        key: process.env.PUMPFUN_STREAM_KEY || "",
        enabled: true,
      });
    }

    // X/Twitter (full URL provided via Media Studio)
    if (process.env.X_RTMP_URL && !existingNames.has("X/Twitter")) {
      this.destinations.push({
        name: "X/Twitter",
        url: process.env.X_RTMP_URL,
        key: process.env.X_STREAM_KEY || "",
        enabled: true,
      });
    }

    // Generic custom destination
    if (
      process.env.CUSTOM_RTMP_URL &&
      !existingNames.has(process.env.CUSTOM_RTMP_NAME || "Custom")
    ) {
      this.destinations.push({
        name: process.env.CUSTOM_RTMP_NAME || "Custom",
        url: process.env.CUSTOM_RTMP_URL,
        key: process.env.CUSTOM_STREAM_KEY || "",
        enabled: true,
      });
    }

    console.log(
      `[RTMPBridge] Loaded ${this.destinations.length} destinations:`,
      this.destinations.map((d) => d.name).join(", "),
    );
  }

  /**
   * Add a destination manually
   */
  addDestination(dest: RTMPDestination): void {
    this.destinations.push(dest);
  }

  /**
   * Start the WebSocket server
   */
  start(port: number = 8765): void {
    if (this.wss) {
      console.warn("[RTMPBridge] Server already running");
      return;
    }

    this.loadDestinationsFromEnv();

    if (this.destinations.length === 0) {
      console.warn(
        "[RTMPBridge] No RTMP destinations configured. Set environment variables.",
      );
    }

    this.wss = new WebSocketServer({ port });
    console.log(`[RTMPBridge] WebSocket server started on port ${port}`);

    this.wss.on("connection", this.handleConnection.bind(this));
    this.wss.on("error", (err) => {
      console.error("[RTMPBridge] WebSocket server error:", err);
    });
  }

  /**
   * Stop the server and clean up
   */
  stop(): void {
    // Clear any pending restart timeout
    if (this.ffmpegRestartTimeout) {
      clearTimeout(this.ffmpegRestartTimeout);
      this.ffmpegRestartTimeout = null;
    }

    // Stop health monitoring
    this.stopHealthMonitoring();

    this.stopFFmpeg();

    if (this.client) {
      this.client.close();
      this.client = null;
    }

    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Reset restart state
    this.ffmpegRestartAttempts = 0;
    this.lastFFmpegCrash = 0;

    this.status.active = false;
    console.log("[RTMPBridge] Server stopped");
  }

  /**
   * Handle incoming WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    if (this.client) {
      console.warn("[RTMPBridge] Rejecting connection - already have a client");
      ws.close(1013, "Already streaming");
      return;
    }

    console.log("[RTMPBridge] Client connected");
    this.client = ws;
    this.status.clientConnected = true;
    this.bytesReceived = 0;

    // Start FFmpeg when client connects
    this.startFFmpeg();

    ws.on("message", (data: Buffer) => {
      this.bytesReceived += data.length;
      this.lastDataReceived = Date.now();
      if (this.ffmpeg?.stdin?.writable) {
        this.ffmpeg.stdin.write(data);
      }
    });

    ws.on("close", () => {
      console.log("[RTMPBridge] Client disconnected");
      this.client = null;
      this.status.clientConnected = false;
      this.stopFFmpeg();
    });

    ws.on("error", (err) => {
      console.error("[RTMPBridge] Client WebSocket error:", err);
    });
  }

  /**
   * Build FFmpeg tee muxer output string
   */
  private buildOutputString(): string {
    const enabledDests = this.destinations.filter((d) => d.enabled);

    if (enabledDests.length === 0) {
      // No destinations - just discard (useful for testing)
      return "-f null -";
    }

    const outputs = enabledDests.map((dest) => {
      const fullUrl = dest.key ? `${dest.url}/${dest.key}` : dest.url;
      return `[f=flv:onfail=ignore]${fullUrl}`;
    });

    return outputs.join("|");
  }

  /**
   * Start FFmpeg process
   */
  private startFFmpeg(): void {
    if (this.ffmpeg) {
      console.warn("[RTMPBridge] FFmpeg already running");
      return;
    }

    const outputString = this.buildOutputString();
    const isNullOutput = outputString === "-f null -";

    // Build FFmpeg arguments
    const args = [
      // Input: pipe from stdin (WebM from MediaRecorder)
      "-i",
      "pipe:0",

      // Video codec settings
      "-c:v",
      "libx264",
      "-preset",
      this.config.preset,
      "-tune",
      "zerolatency",
      "-b:v",
      `${this.config.videoBitrate}k`,
      "-maxrate",
      `${Math.floor(this.config.videoBitrate * 1.1)}k`,
      "-bufsize",
      `${this.config.videoBitrate * 2}k`,
      "-pix_fmt",
      "yuv420p",
      "-g",
      String(this.config.gopSize),

      // Audio codec settings
      "-c:a",
      "aac",
      "-b:a",
      `${this.config.audioBitrate}k`,
      "-ar",
      "44100",

      // Global header required for tee muxer
      "-flags",
      "+global_header",
    ];

    if (isNullOutput) {
      // No destinations - discard output (for testing)
      args.push("-f", "null", "-");
    } else {
      // Use tee muxer for multiple outputs
      args.push("-f", "tee", outputString);
    }

    console.log("[RTMPBridge] Starting FFmpeg with args:", args.join(" "));

    this.ffmpeg = spawn("ffmpeg", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.startTime = Date.now();
    this.status.active = true;
    this.status.ffmpegRunning = true;
    this.status.startedAt = this.startTime;

    // Initialize destination statuses
    this.status.destinations = this.destinations
      .filter((d) => d.enabled)
      .map((d) => ({
        name: d.name,
        connected: true, // Assume connected initially
        bytesWritten: 0,
        startedAt: this.startTime,
      }));

    this.ffmpeg.stdout?.on("data", (data) => {
      console.log("[FFmpeg stdout]", data.toString());
    });

    this.ffmpeg.stderr?.on("data", (data) => {
      const msg = data.toString();
      // Filter out frame progress updates for cleaner logs
      if (!msg.includes("frame=") && !msg.includes("fps=")) {
        console.log("[FFmpeg]", msg.trim());
      }
      // Check for connection errors
      this.parseFFmpegOutput(msg);
    });

    this.ffmpeg.on("close", (code) => {
      console.log(`[RTMPBridge] FFmpeg exited with code ${code}`);
      this.ffmpeg = null;
      this.status.ffmpegRunning = false;
      this.status.active = false;

      // Handle unexpected crash - attempt restart if client still connected
      if (this.client && code !== 0) {
        this.handleFFmpegCrash(code);
      }
    });

    this.ffmpeg.on("error", (err) => {
      console.error("[RTMPBridge] FFmpeg spawn error:", err);
      this.ffmpeg = null;
      this.status.ffmpegRunning = false;

      // Handle spawn failure - attempt restart
      if (this.client) {
        this.handleFFmpegCrash(-1);
      }
    });

    // Start health monitoring
    this.startHealthMonitoring();

    // Handle stdin errors gracefully
    this.ffmpeg.stdin?.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code !== "EPIPE") {
        console.error("[RTMPBridge] FFmpeg stdin error:", err);
      }
    });
  }

  /**
   * Parse FFmpeg output for connection status
   */
  private parseFFmpegOutput(msg: string): void {
    // Check for RTMP connection errors
    for (const dest of this.status.destinations) {
      if (
        msg.includes(dest.name) ||
        msg.toLowerCase().includes(dest.name.toLowerCase())
      ) {
        if (msg.includes("error") || msg.includes("failed")) {
          dest.connected = false;
          dest.error = msg.trim();
        }
      }
    }
  }

  /**
   * Stop FFmpeg process
   */
  private stopFFmpeg(): void {
    if (!this.ffmpeg) return;

    console.log("[RTMPBridge] Stopping FFmpeg");

    // Close stdin first to signal end of input
    this.ffmpeg.stdin?.end();

    // Give it a moment to finish, then kill
    setTimeout(() => {
      if (this.ffmpeg) {
        this.ffmpeg.kill("SIGTERM");
        this.ffmpeg = null;
      }
    }, 2000);

    this.status.ffmpegRunning = false;
  }

  /**
   * Get current streaming status
   */
  getStatus(): StreamingStatus {
    return {
      ...this.status,
      destinations: this.status.destinations.map((d) => ({ ...d })),
    };
  }

  /**
   * Get streaming statistics
   */
  getStats(): {
    bytesReceived: number;
    uptime: number;
    destinations: number;
    restartAttempts: number;
    lastCrash: number;
    healthy: boolean;
  } {
    const now = Date.now();
    const healthy =
      this.status.ffmpegRunning &&
      this.status.clientConnected &&
      (this.lastDataReceived === 0 ||
        now - this.lastDataReceived < RTMPBridge.DATA_TIMEOUT);

    return {
      bytesReceived: this.bytesReceived,
      uptime: this.startTime ? now - this.startTime : 0,
      destinations: this.destinations.filter((d) => d.enabled).length,
      restartAttempts: this.ffmpegRestartAttempts,
      lastCrash: this.lastFFmpegCrash,
      healthy,
    };
  }

  /**
   * Handle FFmpeg crash with exponential backoff restart
   */
  private handleFFmpegCrash(exitCode: number | null): void {
    const now = Date.now();
    this.lastFFmpegCrash = now;

    // Clear any existing restart timeout
    if (this.ffmpegRestartTimeout) {
      clearTimeout(this.ffmpegRestartTimeout);
      this.ffmpegRestartTimeout = null;
    }

    // Check if we've exceeded max restart attempts
    if (this.ffmpegRestartAttempts >= RTMPBridge.MAX_RESTART_ATTEMPTS) {
      console.error(
        `[RTMPBridge] FFmpeg crashed ${this.ffmpegRestartAttempts} times. ` +
          `Giving up. Manual intervention required.`,
      );
      this.status.active = false;
      return;
    }

    this.ffmpegRestartAttempts++;

    // Calculate delay with exponential backoff and jitter
    const baseDelay =
      RTMPBridge.BASE_RESTART_DELAY *
      Math.pow(2, this.ffmpegRestartAttempts - 1);
    const jitter = Math.random() * 1000; // Add up to 1s jitter
    const delay = Math.min(baseDelay + jitter, RTMPBridge.MAX_RESTART_DELAY);

    console.warn(
      `[RTMPBridge] FFmpeg crashed with code ${exitCode}. ` +
        `Restart attempt ${this.ffmpegRestartAttempts}/${RTMPBridge.MAX_RESTART_ATTEMPTS} ` +
        `in ${Math.round(delay)}ms`,
    );

    this.ffmpegRestartTimeout = setTimeout(() => {
      this.ffmpegRestartTimeout = null;

      // Only restart if client is still connected
      if (this.client) {
        console.log("[RTMPBridge] Attempting FFmpeg restart...");
        this.startFFmpeg();

        // Reset restart counter after successful restart (if still running after 5s)
        setTimeout(() => {
          if (this.ffmpeg && this.status.ffmpegRunning) {
            console.log("[RTMPBridge] FFmpeg restart appears successful");
            // Gradually reduce restart counter on success
            this.ffmpegRestartAttempts = Math.max(
              0,
              this.ffmpegRestartAttempts - 1,
            );
          }
        }, 5000);
      } else {
        console.log(
          "[RTMPBridge] Client disconnected, skipping FFmpeg restart",
        );
        this.ffmpegRestartAttempts = 0;
      }
    }, delay);
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Stop any existing monitoring
    this.stopHealthMonitoring();

    this.healthCheckInterval = setInterval(() => {
      this.checkHealth();
    }, RTMPBridge.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Stop health monitoring
   */
  private stopHealthMonitoring(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Check streaming health and log warnings
   */
  private checkHealth(): void {
    const now = Date.now();
    const stats = this.getStats();

    // Check for data timeout
    if (
      this.lastDataReceived > 0 &&
      now - this.lastDataReceived > RTMPBridge.DATA_TIMEOUT
    ) {
      console.warn(
        `[RTMPBridge] No data received for ${Math.round((now - this.lastDataReceived) / 1000)}s. ` +
          `Stream may be stalled.`,
      );
    }

    // Check destination health
    for (const dest of this.status.destinations) {
      if (!dest.connected && dest.error) {
        console.warn(
          `[RTMPBridge] Destination ${dest.name} unhealthy: ${dest.error}`,
        );
      }
    }

    // Log periodic health status (every 5 health checks = ~50s)
    if (Math.random() < 0.2) {
      const healthyDests = this.status.destinations.filter(
        (d) => d.connected,
      ).length;
      console.log(
        `[RTMPBridge] Health check: ${stats.healthy ? "HEALTHY" : "UNHEALTHY"} | ` +
          `Uptime: ${Math.round(stats.uptime / 1000)}s | ` +
          `Received: ${Math.round(stats.bytesReceived / 1024)}KB | ` +
          `Destinations: ${healthyDests}/${this.status.destinations.length}`,
      );
    }
  }

  /**
   * Reset bytes received counter (call periodically to prevent overflow)
   */
  resetBytesReceived(): void {
    this.bytesReceived = 0;
  }
}

// Singleton instance
let bridgeInstance: RTMPBridge | null = null;

/**
 * Get or create the RTMP bridge instance
 */
export function getRTMPBridge(): RTMPBridge {
  if (!bridgeInstance) {
    bridgeInstance = new RTMPBridge();
  }
  return bridgeInstance;
}

/**
 * Start the RTMP bridge server
 */
export function startRTMPBridge(port: number = 8765): RTMPBridge {
  const bridge = getRTMPBridge();
  bridge.start(port);
  return bridge;
}
