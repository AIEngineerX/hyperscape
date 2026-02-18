/**
 * RTMP Streaming Types
 *
 * Type definitions for the multi-platform RTMP streaming system.
 */

/** RTMP destination configuration */
export interface RTMPDestination {
  name: string;
  url: string;
  key: string;
  enabled: boolean;
}

/** Streaming configuration */
export interface StreamingConfig {
  /** Video bitrate in kbps */
  videoBitrate: number;
  /** Audio bitrate in kbps */
  audioBitrate: number;
  /** Frames per second */
  fps: number;
  /** Video width */
  width: number;
  /** Video height */
  height: number;
  /** FFmpeg preset (ultrafast, veryfast, fast, medium) */
  preset: "ultrafast" | "veryfast" | "fast" | "medium";
  /** Keyframe interval in frames */
  gopSize: number;
}

/** Stream status for a single destination */
export interface DestinationStatus {
  name: string;
  connected: boolean;
  error?: string;
  bytesWritten: number;
  startedAt?: number;
}

/** Overall streaming status */
export interface StreamingStatus {
  active: boolean;
  startedAt?: number;
  destinations: DestinationStatus[];
  ffmpegRunning: boolean;
  clientConnected: boolean;
}

/** Default streaming configuration */
export const DEFAULT_STREAMING_CONFIG: StreamingConfig = {
  videoBitrate: 4500,
  audioBitrate: 128,
  fps: 30,
  width: 1920,
  height: 1080,
  preset: "veryfast",
  gopSize: 60, // Keyframe every 2 seconds at 30fps
};
