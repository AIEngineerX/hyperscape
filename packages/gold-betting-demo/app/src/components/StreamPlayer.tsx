import React, { useEffect, useRef } from "react";
import Hls from "hls.js";

interface StreamPlayerProps {
  streamUrl: string;
  poster?: string;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const StreamPlayer: React.FC<StreamPlayerProps> = ({
  streamUrl,
  poster,
  autoPlay = true,
  muted = true,
  className,
  style,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !streamUrl) return;

    let hls: Hls | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let healthWatchdog: ReturnType<typeof setInterval> | null = null;
    let lastPlaybackTime = 0;
    let lastPlaylistUpdateAt = Date.now();
    let stallCount = 0;

    const clearTimers = () => {
      if (retryTimeout) {
        clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      if (healthWatchdog) {
        clearInterval(healthWatchdog);
        healthWatchdog = null;
      }
    };

    const sourceUrl = () =>
      `${streamUrl}${streamUrl.includes("?") ? "&" : "?"}t=${Date.now()}`;

    const nudgeToLiveEdge = () => {
      if (!video) return;

      const syncPosition = hls?.liveSyncPosition;
      if (typeof syncPosition === "number" && Number.isFinite(syncPosition)) {
        if (syncPosition - video.currentTime > 1) {
          video.currentTime = Math.max(0, syncPosition - 0.5);
        }
      } else if (video.buffered.length > 0) {
        const liveEdge = video.buffered.end(video.buffered.length - 1);
        if (liveEdge - video.currentTime > 1) {
          video.currentTime = Math.max(0, liveEdge - 0.5);
        }
      }

      void video.play().catch(() => {});
    };

    const scheduleRebuild = (reason: string, delayMs = 1500) => {
      console.warn(`[StreamPlayer] Rebuilding stream: ${reason}`);
      if (retryTimeout) clearTimeout(retryTimeout);
      retryTimeout = setTimeout(() => {
        initPlayer();
      }, delayMs);
    };

    const startHealthWatchdog = () => {
      if (healthWatchdog) clearInterval(healthWatchdog);

      lastPlaybackTime = 0;
      stallCount = 0;

      // Recovery loop for tiny stalls and stale playlist updates.
      healthWatchdog = setInterval(() => {
        if (!video) return;

        const now = Date.now();
        const playbackDelta = Math.abs(video.currentTime - lastPlaybackTime);
        const stalled =
          video.currentTime > 0 &&
          playbackDelta < 0.01 &&
          !video.paused &&
          !video.ended;

        if (stalled) {
          stallCount += 1;
          console.warn(
            `[StreamPlayer] Playback stalled (count: ${stallCount})`,
          );

          if (stallCount >= 3) {
            scheduleRebuild("playback stalled repeatedly");
            return;
          }

          if (stallCount === 1) {
            nudgeToLiveEdge();
          } else {
            hls?.recoverMediaError();
            nudgeToLiveEdge();
          }
        } else {
          stallCount = 0;
        }

        if (hls && now - lastPlaylistUpdateAt > 8000) {
          console.warn(
            "[StreamPlayer] Playlist stalled; forcing manifest/fragment reload",
          );
          hls.startLoad();
          nudgeToLiveEdge();
          lastPlaylistUpdateAt = now;
        }

        lastPlaybackTime = video.currentTime;
      }, 2000);
    };

    const initPlayer = () => {
      clearTimers();
      if (hls) {
        hls.destroy();
        hls = null;
      }
      lastPlaylistUpdateAt = Date.now();

      // Check if browser supports HLS natively (Safari)
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = sourceUrl();
        void video.play().catch(() => {});
        startHealthWatchdog();
      } else if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          // FFmpeg emits standard live HLS, not LL-HLS parts.
          lowLatencyMode: false,
          // Keep a wider live window to absorb network jitter.
          liveSyncDurationCount: 4,
          liveMaxLatencyDurationCount: 12,
          liveBackBufferLength: 30,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          // Aggressive retries when manifests/fragments fail.
          manifestLoadingMaxRetry: 10,
          manifestLoadingRetryDelay: 800,
          levelLoadingMaxRetry: 10,
          levelLoadingRetryDelay: 800,
          fragLoadingMaxRetry: 10,
          fragLoadingRetryDelay: 800,
        });

        hls.loadSource(sourceUrl());
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_LOADED, () => {
          lastPlaylistUpdateAt = Date.now();
        });

        hls.on(Hls.Events.LEVEL_LOADED, () => {
          lastPlaylistUpdateAt = Date.now();
        });

        hls.on(Hls.Events.FRAG_LOADED, () => {
          lastPlaylistUpdateAt = Date.now();
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log("[StreamPlayer] Manifest parsed, starting playback");
          void video.play().catch(() => {});
        });

        hls.on(Hls.Events.ERROR, (_event, data) => {
          console.warn(
            "[StreamPlayer] HLS error:",
            data.type,
            data.details,
            data.fatal,
          );

          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                console.log("[StreamPlayer] Network error, retrying load...");
                hls?.startLoad(-1);
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                console.log("[StreamPlayer] Media error, recovering...");
                hls?.recoverMediaError();
                nudgeToLiveEdge();
                break;
              default:
                scheduleRebuild("fatal HLS error", 2000);
                break;
            }
          } else if (
            data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR ||
            data.details === Hls.ErrorDetails.FRAG_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT ||
            data.details === Hls.ErrorDetails.BUFFER_APPEND_ERROR
          ) {
            console.warn(
              "[StreamPlayer] Non-fatal buffering/loading issue; forcing recovery",
            );
            hls?.startLoad();
            nudgeToLiveEdge();
          }
        });

        startHealthWatchdog();
      } else {
        console.error("[StreamPlayer] HLS is not supported in this browser");
      }
    };

    const onWaiting = () => nudgeToLiveEdge();
    const onStalled = () => nudgeToLiveEdge();
    const onVideoError = () => scheduleRebuild("video element error", 1000);

    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("error", onVideoError);

    if (autoPlay) {
      video.autoplay = true;
    }

    initPlayer();

    return () => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("error", onVideoError);
      clearTimers();
      if (hls) {
        hls.destroy();
        hls = null;
      }
    };
  }, [streamUrl, autoPlay]);

  return (
    <div
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", ...style }}
    >
      <video
        ref={videoRef}
        poster={poster}
        autoPlay={autoPlay}
        muted={muted}
        playsInline
        controls={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
          backgroundColor: "#000",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: "30%",
          background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
};
