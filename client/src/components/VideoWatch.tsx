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

// Prefer the Representation id (e.g. "360p") set by the container's renaming step.
// Falling back to height or bitrate handles old/non-relabelled streams.
function qualityLabel(track: DashQualityLevel): string {
  if (track.id && /^\d+p$/.test(track.id)) return track.id;
  if (track.height) return `${track.height}p`;
  return formatBitrate(track.bitrate);
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


function TimelineIcon({ kind }: { kind: NotificationKind }) {
  switch (kind) {
    case "ready":
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />;
    case "error":
      return <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />;
    case "processing":
      return <Loader2 className="h-3.5 w-3.5 text-amber-400 animate-spin" />;
    case "upload":
      return <UploadCloud className="h-3.5 w-3.5 text-sky-400" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-white/40" />;
  }
}

function timelineIconBg(kind: NotificationKind): string {
  switch (kind) {
    case "ready":      return "bg-emerald-500/15";
    case "error":      return "bg-rose-500/15";
    case "processing": return "bg-amber-500/15";
    case "upload":     return "bg-sky-500/15";
    default:           return "bg-white/8";
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
  const [videoNaturalSize, setVideoNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [innerStyle, setInnerStyle] = useState<React.CSSProperties>({ width: '100%', height: '100%', alignSelf: 'stretch' });

  const [timeline, setTimeline] = useState<DBNotification[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineUnavailable, setTimelineUnavailable] = useState(false);

  const isReady = video.status === VideoStatus.READY;
  const manifestUrl = apiService.getManifestUrl(video.id);
  const hasAdaptiveStream = Boolean(manifestUrl);

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

  const captureVideoSize = useCallback(() => {
    const el = videoRef.current;
    if (el && el.videoWidth > 0 && el.videoHeight > 0) {
      setVideoNaturalSize(prev =>
        prev?.w === el.videoWidth && prev?.h === el.videoHeight
          ? prev
          : { w: el.videoWidth, h: el.videoHeight },
      );
    }
  }, []);

  // Recompute inner wrapper px size whenever container resizes or video dimensions change
  useEffect(() => {
    const compute = () => {
      const container = containerRef.current;
      if (!container || !videoNaturalSize) {
        setInnerStyle({ width: '100%', height: '100%', alignSelf: 'stretch' });
        return;
      }
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (cw === 0 || ch === 0) return;
      const ratio = videoNaturalSize.w / videoNaturalSize.h;
      if (cw / ch > ratio) {
        setInnerStyle({ width: `${Math.round(ch * ratio)}px`, height: `${ch}px` });
      } else {
        setInnerStyle({ width: `${cw}px`, height: `${Math.round(cw / ratio)}px` });
      }
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [videoNaturalSize]);

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

    setVideoNaturalSize(null);
    setInnerStyle({ width: '100%', height: '100%', alignSelf: 'stretch' });

    try {
      if (dashPlayerRef.current) dashPlayerRef.current.destroy();
      setQualityLevels([]);
      setCurrentQuality(-1);

      if (manifestUrl) {
        const player = _dashjs().MediaPlayer().create();
        player.updateSettings({
          streaming: {
            abr: { autoSwitchBitrate: { video: true, audio: true } },
          },
        });

        player.on("streamInitialized", () => {
          refreshQualityLevels();
          captureVideoSize();
        });

        player.on("manifestLoaded", () => {
          refreshQualityLevels();
        });

        player.on("playbackMetadataLoaded", () => {
          refreshQualityLevels();
          captureVideoSize();
        });

        player.on("qualityChangeRendered", (e: any) => {
          setCurrentQuality((prev) => (prev === -1 ? -1 : e.newQuality));
          refreshQualityLevels();
          captureVideoSize();
        });

        player.on("error", (e: any) => {
          console.error("DASH error:", e);
          setPlayerError("Streaming error — try refreshing.");
        });

        player.initialize(videoRef.current, manifestUrl, false);
        dashPlayerRef.current = player;

        // video `resize` fires when decoder resolves actual frame dimensions —
        // more reliable than loadedMetadata for DASH/MSE streams
        videoRef.current?.addEventListener('resize', captureVideoSize);

        let tries = 0;
        qualityProbe = setInterval(() => {
          tries += 1;
          const found = refreshQualityLevels();
          captureVideoSize();
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
      videoRef.current?.removeEventListener('resize', captureVideoSize);
      if (dashPlayerRef.current) {
        dashPlayerRef.current.destroy();
        dashPlayerRef.current = null;
      }
    };
  }, [isReady, video, refreshQualityLevels, captureVideoSize]);

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
    <div className="fixed inset-0 z-50 bg-[#0a0a0a] text-white overflow-hidden">
      <div className="flex h-full flex-col lg:flex-row">

        {/* ── LEFT: Player ── */}
        <div className="relative flex-1 min-h-0 bg-black flex flex-col">

          {/* Floating top overlay — back button + title + badge */}
          <div className="absolute inset-x-0 top-0 z-30 pointer-events-none">
            <div className="h-28 bg-gradient-to-b from-black/85 to-transparent" />
            <div className="absolute inset-x-0 top-0 flex items-start gap-3 px-5 py-4">
              <button
                type="button"
                onClick={onClose}
                aria-label="Back"
                className="pointer-events-auto mt-0.5 rounded-full bg-black/50 p-2.5 text-white backdrop-blur-sm transition hover:bg-white/15 active:scale-95"
              >
                <ArrowLeft className="h-4.5 w-4.5" />
              </button>
              <div className="pointer-events-none flex-1 min-w-0 pt-1">
                <p className="text-sm font-semibold text-white/95 line-clamp-1 leading-snug">
                  {video.title}
                </p>
                <p className="mt-0.5 text-[11px] text-white/40 line-clamp-1">{video.filename}</p>
              </div>
              <Badge
                variant="outline"
                className={cn("pointer-events-none mt-1 shrink-0 rounded-full border text-[11px] font-medium", badge.className)}
              >
                {badge.label}
              </Badge>
            </div>
          </div>

          {isReady ? (
            <div
              ref={containerRef}
              className="relative h-full w-full flex items-center justify-center cursor-pointer select-none"
              onMouseMove={showControlsTemporarily}
              onClick={togglePlay}
            >
              {/* Inner wrapper: JS-computed px size matching video aspect ratio */}
              <div className="relative shrink-0" style={innerStyle}>
              <video
                ref={videoRef}
                className="h-full w-full"
                poster={video.thumbnailUrl || undefined}
                onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
                onLoadedMetadata={() => {
                  const el = videoRef.current;
                  if (!el) return;
                  setDuration(el.duration ?? 0);
                  captureVideoSize();
                }}
                onPlay={() => { setIsPlaying(true); showControlsTemporarily(); }}
                onPause={() => { setIsPlaying(false); setShowControls(true); }}
                onEnded={() => { setIsPlaying(false); setShowControls(true); }}
                onError={() => setPlayerError("Failed to load video stream.")}
              />

              {/* Error overlay */}
              {playerError && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm">
                  <div className="rounded-2xl border border-rose-500/25 bg-rose-950/70 px-8 py-6 text-center shadow-2xl">
                    <AlertTriangle className="mx-auto mb-3 h-9 w-9 text-rose-400" />
                    <p className="text-sm font-semibold text-rose-300">{playerError}</p>
                  </div>
                </div>
              )}

              {/* Center play overlay */}
              {!isPlaying && !playerError && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="rounded-full bg-black/55 p-6 ring-1 ring-white/10 backdrop-blur-sm">
                    <Play className="h-10 w-10 fill-white text-white translate-x-0.5" />
                  </div>
                </div>
              )}

              </div>

              {/* Controls bar — outside portrait-constrained inner div so it spans full player width */}
              <div
                className={cn(
                  "absolute bottom-0 inset-x-0 transition-opacity duration-300",
                  showControls ? "opacity-100" : "opacity-0 pointer-events-none",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="h-28 bg-gradient-to-t from-black/90 to-transparent pointer-events-none" />
                <div className="bg-black/55 px-5 pb-5 pt-1 space-y-2.5">
                  {/* Seek bar */}
                  <div className="group relative flex items-center">
                    <input
                      type="range"
                      min={0}
                      max={duration || 0}
                      step={0.1}
                      value={currentTime}
                      onChange={handleSeek}
                      className="yt-seek-bar w-full h-1 rounded-full cursor-pointer appearance-none bg-white/25 accent-white group-hover:h-1.5 transition-all"
                      aria-label="Seek"
                    />
                  </div>

                  {/* Button row */}
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={togglePlay} className="rounded-full p-1.5 hover:bg-white/10 transition" aria-label={isPlaying ? "Pause" : "Play"}>
                      {isPlaying ? <Pause className="h-5 w-5 fill-white" /> : <Play className="h-5 w-5 fill-white" />}
                    </button>

                    <button type="button" onClick={toggleMute} className="rounded-full p-1.5 hover:bg-white/10 transition" aria-label={isMuted ? "Unmute" : "Mute"}>
                      {isMuted || volume === 0 ? <VolumeX className="h-4.5 w-4.5" /> : <Volume2 className="h-4.5 w-4.5" />}
                    </button>
                    <input
                      type="range" min={0} max={1} step={0.01}
                      value={isMuted ? 0 : volume}
                      onChange={handleVolumeChange}
                      className="w-18 h-1 rounded-full cursor-pointer appearance-none bg-white/25 accent-white hidden sm:block"
                      aria-label="Volume"
                    />

                    <span className="ml-1 text-xs text-white/60 font-mono tabular-nums">
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>

                    <span className="hidden lg:block ml-2 text-[10px] text-white/20 select-none">
                      Space · ←→ ±5s · M · F
                    </span>

                    <div className="ml-auto flex items-center gap-0.5">
                      {/* Quality */}
                      {hasAdaptiveStream && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); refreshQualityLevels(); setShowQualityMenu((p) => !p); }}
                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 transition"
                            aria-label="Quality"
                          >
                            <Settings className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">
                              {currentQuality === -1 ? "Auto" : selectedQualityTrack ? qualityLabel(selectedQualityTrack) : "Auto"}
                            </span>
                          </button>

                          {showQualityMenu && (
                            <div className="absolute bottom-full right-0 mb-2 min-w-[10rem] rounded-xl border border-white/10 bg-[#1a1a1a] p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                              <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/40">Quality</p>
                              <button type="button" className={cn("w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-white/8 transition", currentQuality === -1 && "text-white font-medium")} onClick={() => changeQuality(-1)}>
                                Auto (Adaptive)
                              </button>
                              {qualityLevels.length === 0 ? (
                                <p className="px-3 py-2 text-[11px] text-white/40">Loading…</p>
                              ) : (
                                sortedQualityLevels.map((track) => (
                                  <button
                                    key={`${track.id ?? "track"}-${track.index}`}
                                    type="button"
                                    className={cn("w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-white/8 transition", currentQuality === track.index && "text-white font-medium")}
                                    onClick={() => changeQuality(track.index)}
                                  >
                                    {qualityLabel(track)}
                                    <span className="ml-1.5 text-white/35">{formatBitrate(track.bitrate)}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      <button type="button" onClick={togglePiP} className="rounded-full p-1.5 hover:bg-white/10 transition" aria-label="Picture-in-picture">
                        <PictureInPicture2 className="h-4 w-4 text-white/80" />
                      </button>
                      <button type="button" onClick={toggleFullscreen} className="rounded-full p-1.5 hover:bg-white/10 transition" aria-label="Toggle fullscreen">
                        {isFullscreen ? <Minimize className="h-4 w-4 text-white/80" /> : <Maximize className="h-4 w-4 text-white/80" />}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Not-ready placeholder */
            <div className="relative flex flex-1 items-center justify-center">
              {video.thumbnailUrl && (
                <>
                  <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${video.thumbnailUrl})` }} />
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />
                </>
              )}
              <div className="relative z-10 max-w-sm px-8 text-center">
                {video.status === VideoStatus.PROCESSING ? (
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/15 ring-1 ring-amber-500/25">
                    <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
                  </div>
                ) : video.status === VideoStatus.ERROR ? (
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-rose-500/15 ring-1 ring-rose-500/25">
                    <AlertTriangle className="h-8 w-8 text-rose-400" />
                  </div>
                ) : (
                  <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-sky-500/15 ring-1 ring-sky-500/25">
                    <UploadCloud className="h-8 w-8 text-sky-400" />
                  </div>
                )}
                <p className="text-base font-semibold text-white/95">
                  {video.status === VideoStatus.PROCESSING ? "Transcoding in progress" : video.status === VideoStatus.ERROR ? "Processing failed" : "Awaiting processing"}
                </p>
                <p className="mt-2 text-sm text-white/50 leading-relaxed">
                  {video.status === VideoStatus.PROCESSING
                    ? "Converting to multiple quality levels. Updates appear in the timeline."
                    : video.status === VideoStatus.ERROR
                      ? "Something went wrong. Please re-upload the video."
                      : "Processing starts automatically after upload confirms."}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Sidebar ── */}
        <div className="w-full lg:w-[340px] xl:w-[360px] shrink-0 flex flex-col border-t border-white/[0.06] lg:border-t-0 lg:border-l bg-[#111] overflow-y-auto">

          {/* Thumbnail */}
          {video.thumbnailUrl && (
            <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-black">
              <img src={video.thumbnailUrl} alt={video.title} className="h-full w-full object-cover opacity-95" />
              {!isReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                  {video.status === VideoStatus.PROCESSING && (
                    <Loader2 className="h-7 w-7 animate-spin text-amber-400 drop-shadow-lg" />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Meta */}
          <div className="px-5 py-4 space-y-2.5 border-b border-white/[0.06]">
            <h2 className="text-sm font-semibold text-white/95 leading-snug">{video.title}</h2>
            {video.description && (
              <p className="text-xs text-white/50 leading-relaxed">{video.description}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/30">
              <span>Uploaded {formatDate(video.createdAt)}</span>
              {video.fileSize > 0 && <span>{(video.fileSize / 1024 / 1024).toFixed(1)} MB</span>}
              {video.updatedAt !== video.createdAt && <span>· Updated {formatDate(video.updatedAt)}</span>}
            </div>
          </div>

          {/* Activity timeline */}
          <div className="flex-1 px-5 py-4">
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-white/25">
              Activity
            </p>

            {timelineLoading ? (
              <div className="flex items-center gap-2 mt-4 text-xs text-white/30">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading…
              </div>
            ) : timeline.length === 0 ? (
              <p className="mt-4 text-xs text-white/30">No events yet.</p>
            ) : (
              <div>
                {timelineUnavailable && (
                  <p className="mb-3 mt-2 text-[11px] text-amber-400/60">Showing fallback events.</p>
                )}
                {timeline.map((event, i) => (
                  <div
                    key={event.id ?? i}
                    className="flex items-start gap-3 py-3.5 border-b border-white/[0.05] last:border-0"
                  >
                    <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", timelineIconBg(event.kind))}>
                      <TimelineIcon kind={event.kind} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-white/90">{event.title}</p>
                        <span className="shrink-0 text-[10px] text-white/25 tabular-nums">{formatDate(event.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-white/45 leading-snug">{event.detail}</p>
                      {typeof event.progress === "number" && (
                        <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full rounded-full bg-amber-400 transition-[width] duration-500" style={{ width: `${Math.min(100, event.progress)}%` }} />
                        </div>
                      )}
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
