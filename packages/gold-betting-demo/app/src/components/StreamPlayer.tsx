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
    if (!video) return;

    let hls: Hls | null = null;

    // Check if browser supports HLS natively (Safari)
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = streamUrl;
    } else if (Hls.isSupported()) {
      // Use hls.js for other browsers
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [streamUrl]);

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
        controls={false} // Custom controls can be added later if needed
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
      {/* Overlay gradient for better text readability if needed */}
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
