/**
 * VideoPlayerWithOverlay.js
 *
 * Renders a masked video with a canvas overlay that paints decrypted face patches
 * frame-by-frame in sync with video playback.
 *
 * Features:
 * - Pixel-perfect overlay alignment (eliminates coordinate shift)
 * - Strict sequential playback: Seeking forward/backward is disabled
 * - Custom player controls without a scrubber / seek bar
 * - Fullscreen support with overlay preserved (container-level fullscreen)
 * - Automatic letterbox/pillarbox compensation in any screen aspect ratio
 * - Double-click or 'f' key to toggle fullscreen
 */

import { useRef, useEffect, useCallback, useState } from "react";

function formatTime(sec) {
  if (isNaN(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export default function VideoPlayerWithOverlay({
  videoUrl,
  revealedPatches,  // Map<frameIndex, ImageBitmap[]>
  frameRoiMap,      // Map<frameIndex, roiRecord[]>
  fps = 25,
  decryptingPerson = null,
  decryptProgress = null,
}) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lastFrameRef = useRef(-1);
  const lastValidTimeRef = useRef(0);
  const isResettingRef = useRef(false);
  const hideControlsTimerRef = useRef(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isEnded, setIsEnded] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  // Calculate and align canvas to the exact rendered video dimensions (handles letterbox/pillarbox)
  const updateCanvasBounds = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    if (canvas.width !== vw || canvas.height !== vh) {
      canvas.width = vw;
      canvas.height = vh;
    }

    const cw = video.clientWidth;
    const ch = video.clientHeight;
    if (!cw || !ch) return;

    const videoRatio = vw / vh;
    const elementRatio = cw / ch;

    let renderW = cw;
    let renderH = ch;
    let top = 0;
    let left = 0;

    if (Math.abs(videoRatio - elementRatio) > 0.01) {
      if (elementRatio > videoRatio) {
        // Pillarbox (bars on left & right)
        renderH = ch;
        renderW = ch * videoRatio;
        left = (cw - renderW) / 2;
      } else {
        // Letterbox (bars on top & bottom)
        renderW = cw;
        renderH = cw / videoRatio;
        top = (ch - renderH) / 2;
      }
    }

    canvas.style.top = `${top}px`;
    canvas.style.left = `${left}px`;
    canvas.style.width = `${renderW}px`;
    canvas.style.height = `${renderH}px`;
  }, []);

  // Per-frame overlay draw loop
  const drawLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    const frameIndex = Math.floor(video.currentTime * fps);

    if (frameIndex !== lastFrameRef.current) {
      lastFrameRef.current = frameIndex;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const bitmaps = revealedPatches && revealedPatches.get(frameIndex);
      const rois = frameRoiMap && frameRoiMap.get(frameIndex);
      if (bitmaps && rois) {
        bitmaps.forEach((bitmap, i) => {
          const roi = rois[i];
          if (!roi || !bitmap) return;
          const [hx1, hy1, w, h] = roi.bbox;
          ctx.drawImage(bitmap, hx1, hy1, w, h);
        });
      }
    }

    rafRef.current = requestAnimationFrame(drawLoop);
  }, [revealedPatches, frameRoiMap, fps]);

  // Keep drawLoop running
  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawLoop]);

  // Redraw immediately when newly decrypted patches arrive (even if video is paused)
  useEffect(() => {
    lastFrameRef.current = -1;
  }, [revealedPatches, frameRoiMap]);

  // Observe video element resize to dynamically adapt canvas bounds
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    updateCanvasBounds();

    const resizeObserver = new ResizeObserver(() => {
      updateCanvasBounds();
    });
    resizeObserver.observe(video);
    window.addEventListener("resize", updateCanvasBounds);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateCanvasBounds);
    };
  }, [updateCanvasBounds]);

  // Dedicated Replay handler: restarts video from beginning and resets overlay canvas safely
  const handleReplay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    isResettingRef.current = true;
    lastValidTimeRef.current = 0;
    lastFrameRef.current = -1;

    // Reset overlay canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    video.currentTime = 0;
    setCurrentTime(0);
    setIsEnded(false);

    video.play().then(() => {
      setIsPlaying(true);
      setTimeout(() => {
        isResettingRef.current = false;
      }, 150);
    }).catch(err => {
      console.warn("Replay error:", err);
      isResettingRef.current = false;
    });
  }, []);

  // Play / Pause toggle
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.ended || isEnded) {
      handleReplay();
      return;
    }

    if (video.paused) {
      video.play().catch(err => console.warn("Play error:", err));
    } else {
      video.pause();
    }
  }, [handleReplay, isEnded]);

  // Fullscreen management: Fullscreens the container so the overlay canvas is included!
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(err => console.warn("Fullscreen request error:", err));
      } else if (container.webkitRequestFullscreen) {
        container.webkitRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(err => console.warn("Exit fullscreen error:", err));
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
    }
  }, []);

  // Listen to fullscreen changes and prevent seeking keyboard shortcuts
  useEffect(() => {
    const handleFsChange = () => {
      const isFs = !!document.fullscreenElement;
      setIsFullscreen(isFs);

      if (document.fullscreenElement === videoRef.current && containerRef.current) {
        document.exitFullscreen().then(() => {
          containerRef.current?.requestFullscreen();
        }).catch(() => {});
      }

      setTimeout(updateCanvasBounds, 60);
      setTimeout(updateCanvasBounds, 200);
    };

    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);

    // Block keyboard navigation that moves backward / forward
    const handleKeyDown = (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;

      // Disallow moving backward and forward via keyboard shortcuts
      const seekKeys = ["ArrowLeft", "ArrowRight", "j", "l", "J", "L", "Home", "End", "PageUp", "PageDown"];
      if (seekKeys.includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Spacebar or 'K' toggles play/pause (or replay if ended)
      if (e.key === " " || e.code === "Space" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        togglePlay();
      }

      // 'R' triggers replay
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        handleReplay();
      }

      // 'F' toggles fullscreen
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [toggleFullscreen, togglePlay, handleReplay, updateCanvasBounds]);

  // Strict enforcement: block any programmatic or browser-level seeking backward / forward
  const handleSeeking = useCallback(() => {
    const video = videoRef.current;
    if (!video || isResettingRef.current) return;
    const diff = Math.abs(video.currentTime - lastValidTimeRef.current);
    if (diff > 0.4) {
      // Revert attempt to move forward or backward
      video.currentTime = lastValidTimeRef.current;
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isResettingRef.current) {
      setCurrentTime(video.currentTime);
      return;
    }
    // Only accept natural time progression
    const diff = video.currentTime - lastValidTimeRef.current;
    if (diff >= 0 && diff < 0.6) {
      lastValidTimeRef.current = video.currentTime;
      setCurrentTime(video.currentTime);
      if (isEnded) setIsEnded(false);
    } else if (diff < 0 || diff >= 0.6) {
      // Disallowed jump: revert back
      video.currentTime = lastValidTimeRef.current;
    }
  }, [isEnded]);

  // Controls auto-hide on mouse inactivity
  const handleMouseMove = () => {
    setControlsVisible(true);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    hideControlsTimerRef.current = setTimeout(() => {
      if (isPlaying) setControlsVisible(false);
    }, 2800);
  };

  const handleMouseLeave = () => {
    if (isPlaying) setControlsVisible(false);
  };

  // Volume & Mute handlers
  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    videoRef.current.muted = newMuted;
  };

  const progressPct = decryptProgress
    ? Math.round((decryptProgress.done / Math.max(1, decryptProgress.total)) * 100)
    : 0;

  const playedPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onDoubleClick={toggleFullscreen}
      style={{
        position: "relative",
        width: "100%",
        height: isFullscreen ? "100vh" : "auto",
        background: "#000",
        borderRadius: isFullscreen ? 0 : 10,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
      }}
    >
      {/* Masked video — no native controls to eliminate seekbar */}
      <video
        ref={videoRef}
        src={videoUrl}
        onLoadedMetadata={(e) => {
          setDuration(e.target.duration);
          updateCanvasBounds();
        }}
        onPlay={() => {
          setIsPlaying(true);
          updateCanvasBounds();
        }}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setIsEnded(true);
          setControlsVisible(true);
        }}
        onTimeUpdate={handleTimeUpdate}
        onSeeking={handleSeeking}
        onClick={togglePlay}
        playsInline
        preload="auto"
        style={{
          width: "100%",
          maxHeight: isFullscreen ? "100vh" : "none",
          display: "block",
          background: "#000",
          cursor: "pointer",
        }}
      />

      {/* Canvas overlay — perfectly aligned to video rendered rectangle */}
      <canvas
        ref={canvasRef}
        onClick={togglePlay}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 4,
        }}
      />

      {/* Center Replay overlay button when video has finished */}
      {isEnded && (
        <div
          onClick={handleReplay}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.65)",
            cursor: "pointer",
            zIndex: 6,
            gap: 12,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "linear-gradient(135deg, #6366f1, #4f46e5)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 32,
              boxShadow: "0 6px 24px rgba(99, 102, 241, 0.5)",
              transition: "transform 0.2s ease",
            }}
          >
            ↺
          </div>
          <div style={{ color: "#fff", fontSize: 16, fontWeight: 600 }}>
            Replay Video
          </div>
          <div style={{ color: "#94a3b8", fontSize: 12 }}>
            Press Space or R to replay from beginning
          </div>
        </div>
      )}

      {/* Center play icon when paused (and not ended) */}
      {!isPlaying && !isEnded && (
        <div
          onClick={togglePlay}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0, 0, 0, 0.3)",
            cursor: "pointer",
            zIndex: 6,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "rgba(99, 102, 241, 0.9)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 26,
              boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              paddingLeft: 4,
              transition: "transform 0.15s ease",
            }}
          >
            ▶
          </div>
        </div>
      )}

      {/* Top Bar: Seeking Disabled Badge & Fullscreen Button */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          right: 12,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          zIndex: 10,
          pointerEvents: "none",
          opacity: controlsVisible ? 1 : 0,
          transition: "opacity 0.25s ease",
        }}
      >
        {/* Sequential Mode Indicator */}
        <div
          style={{
            background: "rgba(15, 23, 42, 0.75)",
            color: "#94a3b8",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
            backdropFilter: "blur(6px)",
          }}
        >
          <span>🔒</span>
          <span>Sequential Playback (Seeking Disabled)</span>
        </div>

        {/* Fullscreen Button */}
        <button
          onClick={toggleFullscreen}
          style={{
            pointerEvents: "auto",
            background: "rgba(15, 23, 42, 0.8)",
            color: "#fff",
            border: "1px solid rgba(255, 255, 255, 0.25)",
            borderRadius: 8,
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
            backdropFilter: "blur(6px)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          }}
          title={isFullscreen ? "Exit Fullscreen (Esc or F)" : "Fullscreen (F or Double-Click)"}
        >
          <span style={{ fontSize: 13 }}>{isFullscreen ? "↙" : "⛶"}</span>
          <span>{isFullscreen ? "Exit" : "Fullscreen"}</span>
        </button>
      </div>

      {/* Decryption progress overlay */}
      {decryptingPerson !== null && decryptProgress && decryptProgress.done < decryptProgress.total && (
        <div
          style={{
            position: "absolute",
            top: 50,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(15, 23, 42, 0.9)",
            color: "#fff",
            borderRadius: 8,
            padding: "6px 14px",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
            backdropFilter: "blur(6px)",
            whiteSpace: "nowrap",
            zIndex: 10,
            border: "1px solid rgba(99, 102, 241, 0.35)",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              border: "2px solid rgba(255,255,255,0.3)",
              borderTop: "2px solid #6366f1",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }}
          />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          Decrypting Person {decryptingPerson} — {progressPct}%
          <div
            style={{
              width: 80,
              height: 4,
              background: "rgba(255,255,255,0.2)",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                width: `${progressPct}%`,
                height: "100%",
                background: "#6366f1",
                borderRadius: 4,
                transition: "width 0.2s",
              }}
            />
          </div>
        </div>
      )}

      {/* Bottom Custom Control Bar — NO SEEKING / NO FORWARD & BACKWARD BUTTONS */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: "10px 16px 12px",
          background: "linear-gradient(transparent, rgba(0, 0, 0, 0.88))",
          zIndex: 8,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          opacity: controlsVisible ? 1 : 0,
          transition: "opacity 0.25s ease",
        }}
      >
        {/* Read-only progress bar: displays current playback position without allowing click or drag */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 4,
            background: "rgba(255, 255, 255, 0.2)",
            borderRadius: 2,
            overflow: "hidden",
            pointerEvents: "none", // STRICTLY NON-INTERACTIVE
          }}
          title="Seeking disabled: sequential playback only"
        >
          <div
            style={{
              width: `${playedPct}%`,
              height: "100%",
              background: "#6366f1",
              transition: "width 0.15s linear",
            }}
          />
        </div>

        {/* Control buttons row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 2,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {/* Play / Pause button */}
            <button
              onClick={togglePlay}
              style={{
                background: isPlaying ? "rgba(255, 255, 255, 0.1)" : "rgba(99, 102, 241, 0.8)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                borderRadius: 6,
                color: "#fff",
                fontSize: 13,
                cursor: "pointer",
                padding: "6px 12px",
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 600,
                transition: "all 0.15s ease",
              }}
              title={isEnded ? "Replay from start (Space or R)" : isPlaying ? "Pause (Space)" : "Play (Space)"}
            >
              <span>{isEnded ? "↺" : isPlaying ? "⏸" : "▶"}</span>
              <span>{isEnded ? "Replay" : isPlaying ? "Pause" : "Play"}</span>
            </button>

            {/* Dedicated Replay button */}
            <button
              onClick={handleReplay}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                borderRadius: 6,
                color: "#cbd5e1",
                fontSize: 13,
                cursor: "pointer",
                padding: "6px 10px",
                display: "flex",
                alignItems: "center",
                gap: 5,
                fontWeight: 500,
                transition: "all 0.15s ease",
              }}
              title="Replay from beginning (R)"
            >
              <span style={{ fontSize: 14 }}>↺</span>
              <span>Replay</span>
            </button>

            {/* Time display: Elapsed / Total Duration */}
            <span
              style={{
                fontSize: 12,
                color: "#cbd5e1",
                fontFamily: "monospace",
                marginLeft: 4,
              }}
            >
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>

          {/* Volume controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={toggleMute}
              style={{
                background: "transparent",
                border: "none",
                color: "#cbd5e1",
                fontSize: 14,
                cursor: "pointer",
                padding: "2px 4px",
              }}
              title={isMuted ? "Unmute" : "Mute"}
            >
              {isMuted || volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              style={{
                width: 70,
                accentColor: "#6366f1",
                cursor: "pointer",
              }}
              title="Volume"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
