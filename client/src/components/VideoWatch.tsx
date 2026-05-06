// client/src/components/VideoWatch.tsx
// Full-page YouTube-style video watch experience with event timeline

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  UploadCloud,
  Volume2,
  VolumeX,
  Settings,
  Clock,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Video,
  VideoStatus,
  type DBNotification,
  type NotificationKind,
} from "../types";
import { apiService } from "@/service/api";
import { cn } from "@/lib/utils";

// dashjs is loaded as a UMD global — do NOT use bundler imports
const _dashjs = () => (window as any).dashjs;

interface VideoWatchProps {
  video: Video;
  onClose: () => void;
}

interface DashQualityLevel {
  index: number;
  id?: string;
  height?: number;
  bitrate: number;
}

// ─── helpers ───────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatBitrate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildFallbackTimeline(video: Video): DBNotification[] {
  const events: DBNotification[] = [
    {
      id: `${video.id}-upload-started`,
      videoId: video.id,
      kind: "upload",
      title: "Upload started",
      detail: `File "${video.filename}" upload was initiated.`,
      status: "uploading",
      createdAt: video.createdAt,
    },
  ];

  const statusMeta: Record<
    VideoStatus,
    { kind: NotificationKind; title: string; detail: string; status: string }
  > = {
    [VideoStatus.UPLOADING]: {
      kind: "upload",
      title: "Upload in progress",
      detail: "Video is still uploading.",
      status: "uploading",
    },
    [VideoStatus.UPLOADED]: {
      kind: "upload",
      title: "Upload complete",
      detail: "File upload is complete. Processing will start shortly.",
      status: "uploaded",
    },
    [VideoStatus.PROCESSING]: {
      kind: "processing",
      title: "Processing started",
      detail: "Video is being transcoded into multiple streaming qualities.",
      status: "processing",
    },
    [VideoStatus.READY]: {
      kind: "ready",
      title: "Video ready",
      detail: "Video is available for streaming.",
      status: "ready",
    },
    [VideoStatus.ERROR]: {
      kind: "error",
      title: "Processing failed",
      detail: "Video processing failed. Please try uploading again.",
      status: "error",
    },
  };

  const latest = statusMeta[video.status];
  const shouldAddLatest =
    video.status !== VideoStatus.UPLOADING ||
    new Date(video.updatedAt).getTime() !== new Date(video.createdAt).getTime();

  if (shouldAddLatest) {
    events.push({
      id: `${video.id}-status-${video.status}`,
      videoId: video.id,
      kind: latest.kind,
      title: latest.title,
      detail: latest.detail,
      status: latest.status,
      createdAt: video.updatedAt,
    });
  }

  return events.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

function statusColor(status?: string): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500";
    case "processing":
      return "bg-amber-500";
    case "uploaded":
      return "bg-sky-500";
    case "uploading":
      return "bg-blue-400";
    case "error":
      return "bg-rose-500";
    default:
      return "bg-slate-400";
  }
}

function TimelineIcon({ kind }: { kind: NotificationKind }) {
  switch (kind) {
    case "ready":
      return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
    case "error":
      return <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />;
    case "processing":
      return (
        <Loader2 className="h-4 w-4 text-amber-400 shrink-0 animate-spin" />
      );
    case "upload":
      return <UploadCloud className="h-4 w-4 text-sky-400 shrink-0" />;
    default:
      return <Clock className="h-4 w-4 text-slate-400 shrink-0" />;
  }
}

// ─── component ─────────────────────────────────────────────────────────────

export function VideoWatch({ video, onClose }: VideoWatchProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dashPlayerRef = useRef<any>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [qualityLevels, setQualityLevels] = useState<DashQualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const [timeline, setTimeline] = useState<DBNotification[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineUnavailable, setTimelineUnavailable] = useState(false);

  const isReady = video.status === VideoStatus.READY;
  const hasAdaptiveStream = Boolean(video.manifestUrl);

  const sortedQualityLevels = useMemo(
    () =>
      [...qualityLevels].sort((a, b) => {
        const heightDelta = (b.height ?? 0) - (a.height ?? 0);
        if (heightDelta !== 0) return heightDelta;
        return b.bitrate - a.bitrate;
      }),
    [qualityLevels],
  );

  const selectedQualityTrack =
    currentQuality >= 0
      ? qualityLevels.find((track) => track.index === currentQuality)
      : null;

  const refreshQualityLevels = useCallback((): boolean => {
    const player = dashPlayerRef.current;
    if (!player) return false;

    try {
      const representationTracks =
        player.getRepresentationsByType?.("video") || [];
      if (representationTracks.length > 0) {
        const tracks: DashQualityLevel[] = representationTracks.map(
          (track: any, index: number) => ({
            index,
            id: track.id != null ? String(track.id) : undefined,
            height:
              typeof track.height === "number" && track.height > 0
                ? track.height
                : undefined,
            bitrate: Number(track.bandwidth ?? track.bitrate ?? 0),
          }),
        );

        setQualityLevels(tracks);

        const currentRepresentation =
          player.getCurrentRepresentationForType?.("video");
        if (currentRepresentation) {
          const currentRepresentationId =
            currentRepresentation.id != null
              ? String(currentRepresentation.id)
              : undefined;
          const currentIndexById =
            currentRepresentationId != null
              ? tracks.find((track) => track.id === currentRepresentationId)
                  ?.index
              : undefined;
          const currentIndexByPosition =
            typeof currentRepresentation.absoluteIndex === "number"
              ? currentRepresentation.absoluteIndex
              : typeof currentRepresentation.index === "number"
                ? currentRepresentation.index
                : typeof currentRepresentation.qualityIndex === "number"
                  ? currentRepresentation.qualityIndex
                  : -1;
          const resolvedCurrentIndex =
            currentIndexById ?? currentIndexByPosition;
          if (resolvedCurrentIndex >= 0) {
            setCurrentQuality((prev) =>
              prev === -1 ? -1 : resolvedCurrentIndex,
            );
          }
        }

        return true;
      }

      const bitrateTracks = player.getBitrateInfoListFor?.("video") || [];
      if (bitrateTracks.length > 0) {
        const tracks: DashQualityLevel[] = bitrateTracks.map(
          (track: any, index: number) => ({
            index,
            id: track.id != null ? String(track.id) : undefined,
            height:
              typeof track.height === "number" && track.height > 0
                ? track.height
                : undefined,
            bitrate: Number(track.bitrate ?? 0),
          }),
        );

        setQualityLevels(tracks);
        return true;
      }
    } catch (err) {
      console.warn("Could not read DASH quality levels:", err);
    }

    return false;
  }, []);

  // ── Load timeline ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const loadTimeline = async (showSpinner: boolean): Promise<void> => {
      try {
        if (showSpinner && !cancelled) setTimelineLoading(true);
        const data = await apiService.fetchVideoTimeline(video.id);
        if (cancelled) return;

        if (data.length > 0) {
          setTimeline(data);
          setTimelineUnavailable(false);
        } else {
          setTimeline(buildFallbackTimeline(video));
        }
      } catch {
        if (!cancelled) {
          setTimeline(buildFallbackTimeline(video));
          setTimelineUnavailable(true);
        }
      } finally {
        if (!cancelled) setTimelineLoading(false);
      }
    };

    void loadTimeline(true);

    const isTerminal =
      video.status === VideoStatus.READY || video.status === VideoStatus.ERROR;
    if (isTerminal) {
      return () => {
        cancelled = true;
      };
    }

    const interval = setInterval(() => {
      void loadTimeline(false);
    }, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [video]);

  // ── DASH player init ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady || !videoRef.current) return;

    let qualityProbe: ReturnType<typeof setInterval> | null = null;

    try {
      if (dashPlayerRef.current) dashPlayerRef.current.destroy();
      setQualityLevels([]);
      setCurrentQuality(-1);

      if (video.manifestUrl) {
        const player = _dashjs().MediaPlayer().create();
        player.updateSettings({
          streaming: {
            abr: { autoSwitchBitrate: { video: true, audio: true } },
          },
        });

        player.on("streamInitialized", () => {
          refreshQualityLevels();
        });

        player.on("manifestLoaded", () => {
          refreshQualityLevels();
        });

        player.on("playbackMetadataLoaded", () => {
          refreshQualityLevels();
        });

        player.on("qualityChangeRendered", (e: any) => {
          setCurrentQuality((prev) => (prev === -1 ? -1 : e.newQuality));
          refreshQualityLevels();
        });

        player.on("error", (e: any) => {
          console.error("DASH error:", e);
          setPlayerError("Streaming error — try refreshing.");
        });

        player.initialize(videoRef.current, video.manifestUrl, false);
        dashPlayerRef.current = player;

        let tries = 0;
        qualityProbe = setInterval(() => {
          tries += 1;
          const found = refreshQualityLevels();
          if (found || tries >= 20) {
            if (qualityProbe) {
              clearInterval(qualityProbe);
              qualityProbe = null;
            }
          }
        }, 500);
      } else if (video.videoUrl) {
        videoRef.current.src = video.videoUrl;
      } else {
        setPlayerError("No video source available.");
      }
    } catch (err) {
      console.error("Player init error:", err);
      setPlayerError("Failed to initialize player.");
    }

    return () => {
      if (qualityProbe) clearInterval(qualityProbe);
      if (dashPlayerRef.current) {
        dashPlayerRef.current.destroy();
        dashPlayerRef.current = null;
      }
    };
  }, [isReady, video, refreshQualityLevels]);

  // ── Fullscreen listener ──────────────────────────────────────────────────
  useEffect(() => {
    const onFSChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  // ── Controls auto-hide ───────────────────────────────────────────────────
  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
    }, 3000);
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // ── Playback controls ────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(() => {});
    }
    setIsPlaying((p) => !p);
    showControlsTemporarily();
  }, [isPlaying, showControlsTemporarily]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    const next = !isMuted;
    videoRef.current.muted = next;
    setIsMuted(next);
  }, [isMuted]);

  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const vol = parseFloat(e.target.value);
      if (!videoRef.current) return;
      videoRef.current.volume = vol;
      setVolume(vol);
      setIsMuted(vol === 0);
    },
    [],
  );

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    if (!videoRef.current) return;
    videoRef.current.currentTime = t;
    setCurrentTime(t);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      containerRef.current.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, [isFullscreen]);

  const seek = useCallback((delta: number) => {
    if (!videoRef.current) return;
    const newTime = Math.max(
      0,
      Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + delta),
    );
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const togglePiP = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await videoRef.current.requestPictureInPicture();
      }
    } catch {
      // PiP not supported or permission denied — ignore silently
    }
  }, []);

  const changeQuality = useCallback(
    (idx: number) => {
      const player = dashPlayerRef.current;
      if (!player) return;

      if (idx >= 0 && !qualityLevels.some((track) => track.index === idx)) {
        return;
      }

      setShowQualityMenu(false);

      const setAutoSwitch = (enabled: boolean) => {
        if (typeof player.setAutoSwitchQualityFor === "function") {
          player.setAutoSwitchQualityFor("video", enabled);
          return;
        }

        player.updateSettings?.({
          streaming: {
            abr: { autoSwitchBitrate: { video: enabled, audio: true } },
          },
        });
      };

      try {
        if (idx === -1) {
          setAutoSwitch(true);
          setCurrentQuality(-1);
          return;
        }

        setAutoSwitch(false);

        const selectedTrack = qualityLevels.find(
          (track) => track.index === idx,
        );

        if (
          selectedTrack?.id &&
          typeof player.setRepresentationForTypeById === "function"
        ) {
          player.setRepresentationForTypeById("video", selectedTrack.id, true);
        } else if (
          typeof player.setRepresentationForTypeByIndex === "function"
        ) {
          player.setRepresentationForTypeByIndex("video", idx, true);
        } else if (typeof player.setQualityFor === "function") {
          player.setQualityFor("video", idx, true);
        } else {
          throw new Error("No supported dash.js quality switch API available");
        }

        setCurrentQuality(idx);
      } catch (err) {
        console.error("Failed to change quality:", err);
        setPlayerError("Could not switch resolution. Please try again.");
      }
    },
    [qualityLevels],
  );

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          seek(-5);
          break;
        case "ArrowRight":
          e.preventDefault();
          seek(5);
          break;
        case "m":
        case "M":
          toggleMute();
          break;
        case "f":
        case "F":
          toggleFullscreen();
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isReady, togglePlay, seek, toggleMute, toggleFullscreen]);

  // unused — kept for future buffered progress overlay
  // const _playedFraction = duration > 0 ? (currentTime / duration) * 100 : 0;

  // ── Status badge ─────────────────────────────────────────────────────────
  const statusBadgeMap: Record<string, { label: string; className: string }> = {
    ready: {
      label: "Ready",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    },
    processing: {
      label: "Processing",
      className:
        "bg-amber-500/20 text-amber-400 border-amber-500/30 animate-pulse",
    },
    uploaded: {
      label: "Uploaded",
      className: "bg-sky-500/20 text-sky-400 border-sky-500/30",
    },
    uploading: {
      label: "Uploading",
      className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    },
    error: {
      label: "Error",
      className: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    },
  };
  const badge = statusBadgeMap[video.status] ?? {
    label: video.status,
    className: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#0f0f0f] text-white overflow-hidden">
      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10 shrink-0 bg-[#121212]">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="rounded-full text-white hover:bg-white/10"
          aria-label="Back to feed"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight line-clamp-1 text-white">
            {video.title}
          </p>
          <p className="text-xs text-white/50">{video.filename}</p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "rounded-full border text-[11px] font-medium",
            badge.className,
          )}
        >
          {badge.label}
        </Badge>
      </div>

      {/* ── Body ── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* left: player area */}
        <div className="relative min-h-0 flex-1 bg-black">
          {isReady ? (
            <div
              ref={containerRef}
              className="relative h-full w-full cursor-pointer select-none"
              onMouseMove={showControlsTemporarily}
              onClick={togglePlay}
            >
              <video
                ref={videoRef}
                className="h-full w-full object-contain"
                poster={video.thumbnailUrl || undefined}
                onTimeUpdate={() =>
                  setCurrentTime(videoRef.current?.currentTime ?? 0)
                }
                onLoadedMetadata={() =>
                  setDuration(videoRef.current?.duration ?? 0)
                }
                onPlay={() => {
                  setIsPlaying(true);
                  showControlsTemporarily();
                }}
                onPause={() => {
                  setIsPlaying(false);
                  setShowControls(true);
                }}
                onEnded={() => {
                  setIsPlaying(false);
                  setShowControls(true);
                }}
                onError={() => setPlayerError("Failed to load video stream.")}
              />

              {/* Overlay error */}
              {playerError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-sm">
                  <div className="rounded-2xl border border-rose-500/30 bg-rose-950/60 px-6 py-4 text-center shadow-xl">
                    <AlertTriangle className="mx-auto mb-2 h-8 w-8 text-rose-400" />
                    <p className="text-sm font-semibold text-rose-300">
                      {playerError}
                    </p>
                  </div>
                </div>
              )}

              {/* Big play/pause overlay */}
              {!isPlaying && !playerError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="rounded-full bg-black/50 p-5 backdrop-blur-sm">
                    <Play className="h-10 w-10 text-white fill-white" />
                  </div>
                </div>
              )}

              {/* Controls bar */}
              <div
                className={cn(
                  "absolute bottom-0 left-0 right-0 transition-opacity duration-300",
                  showControls
                    ? "opacity-100"
                    : "opacity-0 pointer-events-none",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Gradient fade */}
                <div className="h-24 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />

                <div className="bg-black/60 px-4 pb-4 pt-2 backdrop-blur-sm space-y-2">
                  {/* Seek bar */}
                  <div className="group relative flex items-center">
                    <input
                      type="range"
                      min={0}
                      max={duration || 0}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      className="yt-seek-bar w-full h-1 rounded-full cursor-pointer appearance-none bg-white/30 accent-[#f00] group-hover:h-2 transition-all"
                      aria-label="Seek"
                    />
                  </div>

                  {/* Buttons row */}
                  <div className="flex items-center gap-2">
                    {/* Play/Pause */}
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="rounded-full p-1.5 text-white hover:bg-white/10 transition"
                      aria-label={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? (
                        <Pause className="h-5 w-5 fill-white" />
                      ) : (
                        <Play className="h-5 w-5 fill-white" />
                      )}
                    </button>

                    {/* Volume */}
                    <button
                      type="button"
                      onClick={toggleMute}
                      className="rounded-full p-1.5 text-white hover:bg-white/10 transition"
                      aria-label={isMuted ? "Unmute" : "Mute"}
                    >
                      {isMuted || volume === 0 ? (
                        <VolumeX className="h-5 w-5" />
                      ) : (
                        <Volume2 className="h-5 w-5" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-20 h-1 rounded-full cursor-pointer appearance-none bg-white/30 accent-white hidden sm:block"
                      aria-label="Volume"
                    />

                    {/* Time */}
                    <span className="text-xs text-white/70 font-mono tabular-nums">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>

                    {/* Keyboard hint */}
                    <span className="hidden lg:block text-[10px] text-white/25 select-none ml-1">
                      Space · ←→ ±5s · M · F
                    </span>

                    <div className="ml-auto flex items-center gap-1">
                      {/* Resolution (DASH only) */}
                      {hasAdaptiveStream && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              refreshQualityLevels();
                              setShowQualityMenu((p) => !p);
                            }}
                            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-white hover:bg-white/10 transition"
                            aria-label="Resolution settings"
                          >
                            <Settings className="h-3.5 w-3.5" />
                            <span>
                              Resolution:{" "}
                              {currentQuality === -1
                                ? "Auto"
                                : selectedQualityTrack?.height
                                  ? `${selectedQualityTrack.height}p`
                                  : selectedQualityTrack
                                    ? formatBitrate(
                                        selectedQualityTrack.bitrate,
                                      )
                                    : "Auto"}
                            </span>
                          </button>

                          {showQualityMenu && (
                            <div
                              className="absolute bottom-full right-0 mb-2 min-w-[9rem] rounded-xl border border-white/10 bg-[#212121] p-1 shadow-2xl"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-white/50">
                                Resolution
                              </p>
                              <button
                                type="button"
                                className={cn(
                                  "w-full rounded-lg px-3 py-1.5 text-left text-xs hover:bg-white/10 transition",
                                  currentQuality === -1 && "text-[#f00]",
                                )}
                                onClick={() => changeQuality(-1)}
                              >
                                Auto (Adaptive)
                              </button>
                              {qualityLevels.length === 0 ? (
                                <div className="px-3 py-2">
                                  <p className="text-[11px] text-white/45">
                                    Loading quality options…
                                  </p>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      refreshQualityLevels();
                                    }}
                                    className="mt-2 rounded bg-white/10 px-2 py-1 text-[10px] text-white hover:bg-white/20"
                                  >
                                    Refresh qualities
                                  </button>
                                </div>
                              ) : (
                                sortedQualityLevels.map((track) => {
                                  const label = track.height
                                    ? `${track.height}p — ${formatBitrate(track.bitrate)}`
                                    : formatBitrate(track.bitrate);
                                  return (
                                    <button
                                      key={`${track.id ?? "track"}-${track.index}`}
                                      type="button"
                                      className={cn(
                                        "w-full rounded-lg px-3 py-1.5 text-left text-xs hover:bg-white/10 transition",
                                        currentQuality === track.index &&
                                          "text-[#f00]",
                                      )}
                                      onClick={() => changeQuality(track.index)}
                                    >
                                      {label}
                                    </button>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* PiP */}
                      <button
                        type="button"
                        onClick={togglePiP}
                        className="rounded-full p-1.5 text-white hover:bg-white/10 transition"
                        aria-label="Picture-in-picture"
                      >
                        <PictureInPicture2 className="h-4 w-4" />
                      </button>

                      {/* Fullscreen */}
                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="rounded-full p-1.5 text-white hover:bg-white/10 transition"
                        aria-label="Toggle fullscreen"
                      >
                        {isFullscreen ? (
                          <Minimize className="h-4 w-4" />
                        ) : (
                          <Maximize className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Non-ready state — show status placeholder */
            <div className="relative flex h-full items-center justify-center px-6">
              {video.thumbnailUrl && (
                <>
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${video.thumbnailUrl})` }}
                  />
                  <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" />
                </>
              )}
              <div className="relative z-10 max-w-sm text-center">
                {video.status === VideoStatus.PROCESSING ? (
                  <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-amber-400" />
                ) : video.status === VideoStatus.ERROR ? (
                  <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-rose-400" />
                ) : (
                  <UploadCloud className="mx-auto mb-4 h-12 w-12 text-sky-400" />
                )}
                <p className="text-lg font-semibold text-white">
                  {video.status === VideoStatus.PROCESSING
                    ? "Transcoding in progress…"
                    : video.status === VideoStatus.ERROR
                      ? "Processing failed"
                      : "Awaiting processing"}
                </p>
                <p className="mt-2 text-sm text-white/60">
                  {video.status === VideoStatus.PROCESSING
                    ? "Your video is being converted into multiple quality levels. Check the timeline below for live updates."
                    : video.status === VideoStatus.ERROR
                      ? "Something went wrong during processing. Please re-upload the video."
                      : "Processing will start automatically once the upload is confirmed."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* right: info + timeline sidebar */}
        <div className="lg:w-[360px] xl:w-[400px] shrink-0 flex flex-col border-l border-white/10 bg-[#121212] overflow-y-auto">
          {/* Thumbnail strip */}
          {video.thumbnailUrl && (
            <div className="relative aspect-video w-full shrink-0 overflow-hidden border-b border-white/10 bg-black">
              <img
                src={video.thumbnailUrl}
                alt={video.title}
                className="h-full w-full object-cover"
              />
              {!isReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  {video.status === VideoStatus.PROCESSING && (
                    <Loader2 className="h-8 w-8 animate-spin text-amber-400 drop-shadow-lg" />
                  )}
                </div>
              )}
            </div>
          )}
          {/* Video meta */}
          <div className="p-5 border-b border-white/10 space-y-3">
            <h2 className="text-base font-semibold leading-snug text-white">
              {video.title}
            </h2>
            {video.description && (
              <p className="text-sm text-white/60">{video.description}</p>
            )}
            <div className="flex flex-wrap gap-2 text-xs text-white/50">
              <span>Uploaded {formatDate(video.createdAt)}</span>
              {video.updatedAt !== video.createdAt && (
                <span>· Updated {formatDate(video.updatedAt)}</span>
              )}
            </div>
            {video.fileSize > 0 && (
              <div className="text-xs text-white/40">
                {(video.fileSize / 1024 / 1024).toFixed(1)} MB
              </div>
            )}
          </div>

          {/* Activity timeline */}
          <div className="flex-1 p-5">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-white/40">
              Activity Timeline
            </p>

            {timelineLoading ? (
              <div className="flex items-center gap-2 text-sm text-white/40">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading timeline…
              </div>
            ) : timeline.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
                <p className="text-sm text-white/40">No events recorded yet.</p>
                <p className="mt-1 text-xs text-white/30">
                  Events appear as your video moves through the pipeline.
                </p>
              </div>
            ) : (
              <div className="relative space-y-0">
                {timelineUnavailable && (
                  <p className="mb-3 text-[11px] text-amber-300/80">
                    Live timeline service is unavailable. Showing fallback
                    events.
                  </p>
                )}
                {/* Vertical connector line */}
                <div
                  className="absolute left-2 top-2 bottom-2 w-px bg-white/10"
                  aria-hidden
                />

                {timeline.map((event, i) => (
                  <div
                    key={event.id ?? i}
                    className="relative pl-8 pb-5 last:pb-0"
                  >
                    {/* Dot */}
                    <span
                      className={cn(
                        "absolute left-0 top-1 flex h-4 w-4 items-center justify-center rounded-full border border-white/20",
                        statusColor(event.status),
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
                    </span>

                    <div className="rounded-xl border border-white/8 bg-white/5 px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <TimelineIcon kind={event.kind} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-semibold text-white">
                              {event.title}
                            </p>
                            <span className="shrink-0 text-[10px] text-white/40 tabular-nums">
                              {formatDate(event.createdAt)}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[11px] text-white/50 leading-snug">
                            {event.detail}
                          </p>
                          {typeof event.progress === "number" && (
                            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                              <div
                                className="h-full rounded-full bg-amber-400 transition-[width] duration-500"
                                style={{
                                  width: `${Math.min(100, event.progress)}%`,
                                }}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
