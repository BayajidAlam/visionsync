import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Home,
  Loader2,
  Moon,
  PlaySquare,
  Search,
  Sparkles,
  SunMedium,
  UploadCloud,
  X,
} from "lucide-react";
import { VideoUploadComponent } from "./components/VideoUpload";
import { VideoList } from "./components/VideoList";
import { apiService } from "./service/api";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  VideoStatus,
  type Video,
  type VideoStatus as VideoStatusValue,
  type NotificationKind,
} from "./types";
import { cn } from "@/lib/utils";
import { useSocket } from "./hooks/useSocket";
import "./App.css";

type ThemeMode = "light" | "dark";
type AppMode = "feed" | "studio";
type StatusFilter = "all" | VideoStatusValue;
type NavKey = "home" | "studio";

interface AppNotification {
  id: string;
  videoId?: string;
  title: string;
  detail: string;
  kind: NotificationKind;
  status?: string;
  progress?: number;
  createdAt: number;
  read: boolean;
  resolved?: boolean;
}

const normalizeSocketStatus = (
  status?: string,
): VideoStatusValue | "unknown" => {
  const normalized = status?.toLowerCase();

  if (
    normalized === VideoStatus.UPLOADING ||
    normalized === VideoStatus.UPLOADED ||
    normalized === VideoStatus.PROCESSING ||
    normalized === VideoStatus.READY ||
    normalized === VideoStatus.ERROR
  ) {
    return normalized;
  }

  return "unknown";
};

const formatRelativeTime = (timestamp: number) => {
  const elapsedMs = Date.now() - timestamp;
  const elapsedSeconds = Math.floor(elapsedMs / 1000);

  if (elapsedSeconds < 8) {
    return "just now";
  }

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
};

function App() {
  const navigate = useNavigate();
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [appMode, setAppMode] = useState<AppMode>("feed");
  const [activeNav, setActiveNav] = useState<NavKey>("home");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [trackedVideoIds, setTrackedVideoIds] = useState<string[]>([]);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const notificationBoxRef = useRef<HTMLDivElement | null>(null);
  const joinedVideoIdsRef = useRef<Set<string>>(new Set());
  const progressCheckpointRef = useRef<Record<string, number>>({});
  const refreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    isConnected: isSocketConnected,
    isConnecting: isSocketConnecting,
    videoStatus,
    progress,
    joinVideo,
    leaveVideo,
    reconnect,
  } = useSocket();

  const navItems: Array<{
    id: NavKey;
    icon: typeof Home;
    label: string;
    mobileLabel: string;
    mode: AppMode;
  }> = [
    {
      id: "home",
      icon: Home,
      label: "Home",
      mobileLabel: "Home",
      mode: "feed",
    },
    {
      id: "studio",
      icon: UploadCloud,
      label: "Studio",
      mobileLabel: "Studio",
      mode: "studio",
    },
  ];

  const handleNavSelect = (id: NavKey, mode: AppMode) => {
    setActiveNav(id);
    setAppMode(mode);
  };

  const filterChips: Array<{ id: StatusFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: VideoStatus.READY, label: "Ready" },
    { id: VideoStatus.PROCESSING, label: "Processing" },
    { id: VideoStatus.UPLOADED, label: "Uploaded" },
    { id: VideoStatus.ERROR, label: "Needs Fix" },
  ];

  const handleUploadStart = (videoId: string) => {
    // Join socket room immediately so we don't miss processing events
    setTrackedVideoIds((prev) =>
      [videoId, ...prev.filter((id) => id !== videoId)].slice(0, 5),
    );
  };

  const handleUploadComplete = (videoId: string) => {
    console.log("Upload completed for video:", videoId);
    setTrackedVideoIds((prev) =>
      [videoId, ...prev.filter((id) => id !== videoId)].slice(0, 5),
    );
    setNotifications((prev) =>
      [
        {
          id: `upload-${videoId}-${Date.now()}`,
          videoId,
          title: "Upload completed",
          detail:
            "Your file reached storage. Processing updates will appear here.",
          kind: "upload" as NotificationKind,
          status: VideoStatus.UPLOADED,
          createdAt: Date.now(),
          read: false,
        },
        ...prev,
      ].slice(0, 30),
    );
    setRefreshTrigger((prev) => prev + 1);
    setAppMode("feed");
    setActiveNav("home");
  };

  const handleVideoSelect = (video: Video) => {
    navigate(`/watch/${video.id}`);
  };

  const handleVideosLoaded = useCallback((videos: Video[]) => {
    setAllVideos(videos);
  }, []);

  // Load DB-persisted notifications on mount to restore history after refresh
  useEffect(() => {
    apiService
      .fetchNotifications(undefined, 30)
      .then((items) => {
        if (items.length === 0) return;
        const terminalVideoIds = new Set(
          items
            .filter((n) => n.kind === "ready" || n.kind === "error")
            .map((n) => n.videoId),
        );
        setNotifications(
          items.map((n) => ({
            id: n.id,
            videoId: n.videoId,
            title: n.title,
            detail: n.detail,
            kind: n.kind as NotificationKind,
            status: n.status,
            progress: n.progress,
            createdAt: new Date(n.createdAt).getTime(),
            read: true, // historical items start as read
            resolved: n.kind === "processing" && terminalVideoIds.has(n.videoId),
          })),
        );
      })
      .catch(() => {
        /* best-effort */
      });
  }, []);

  useEffect(() => {
    const storedTheme = localStorage.getItem("vs-theme");
    if (storedTheme === "dark" || storedTheme === "light") {
      setThemeMode(storedTheme);
      return;
    }

    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setThemeMode("dark");
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    localStorage.setItem("vs-theme", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 320);

    return () => {
      window.clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        searchBoxRef.current &&
        !searchBoxRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }

      if (
        notificationBoxRef.current &&
        !notificationBoxRef.current.contains(event.target as Node)
      ) {
        setShowNotifications(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const videoTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const video of allVideos) {
      map.set(video.id, video.title?.trim() || video.filename);
    }
    return map;
  }, [allVideos]);

  const getVideoName = useCallback(
    (videoId: string) =>
      videoTitleById.get(videoId) || `Video ${videoId.slice(0, 8)}`,
    [videoTitleById],
  );

  const addNotification = useCallback(
    (notification: Omit<AppNotification, "id" | "createdAt" | "read">) => {
      setNotifications((prev) =>
        [
          {
            ...notification,
            id: `${notification.kind}-${notification.videoId || "general"}-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
            createdAt: Date.now(),
            read: false,
          },
          ...prev,
        ].slice(0, 30),
      );
    },
    [],
  );

  useEffect(() => {
    if (!isSocketConnected) {
      return;
    }

    const tracked = new Set<string>();

    for (const id of trackedVideoIds) {
      if (tracked.size >= 9) {
        break;
      }
      tracked.add(id);
    }

    const activeVideos = [...allVideos]
      .filter(
        (video) =>
          video.status === VideoStatus.UPLOADING ||
          video.status === VideoStatus.UPLOADED ||
          video.status === VideoStatus.PROCESSING,
      )
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

    for (const video of activeVideos) {
      if (tracked.size >= 9) {
        break;
      }
      tracked.add(video.id);
    }

    for (const videoId of tracked) {
      if (!joinedVideoIdsRef.current.has(videoId)) {
        joinVideo(videoId);
        joinedVideoIdsRef.current.add(videoId);
      }
    }

    for (const videoId of Array.from(joinedVideoIdsRef.current)) {
      if (!tracked.has(videoId)) {
        leaveVideo(videoId);
        joinedVideoIdsRef.current.delete(videoId);
      }
    }
  }, [allVideos, isSocketConnected, joinVideo, leaveVideo, trackedVideoIds]);

  useEffect(() => {
    return () => {
      for (const videoId of joinedVideoIdsRef.current) {
        leaveVideo(videoId);
      }
      joinedVideoIdsRef.current.clear();
    };
  }, [leaveVideo]);

  useEffect(() => {
    if (!videoStatus) {
      return;
    }

    const normalizedStatus = normalizeSocketStatus(videoStatus.status);
    const videoName = getVideoName(videoStatus.videoId);

    let title = `Status updated for ${videoName}`;
    let detail = videoStatus.message || "Your video status changed.";
    let kind: NotificationKind = "system";

    if (normalizedStatus === VideoStatus.UPLOADING) {
      title = `Uploading ${videoName}`;
      detail = videoStatus.message || "Upload has started.";
      kind = "upload";
    }

    if (normalizedStatus === VideoStatus.UPLOADED) {
      title = `Uploaded ${videoName}`;
      detail =
        videoStatus.message || "Upload finished. Processing starts shortly.";
      kind = "upload";
    }

    if (normalizedStatus === VideoStatus.PROCESSING) {
      title = `Processing ${videoName}`;
      detail = videoStatus.message || "Transcoding is in progress.";
      kind = "processing";
    }

    if (normalizedStatus === VideoStatus.READY) {
      title = `${videoName} is ready`;
      detail = videoStatus.message || "Video is ready to watch.";
      kind = "ready";
      progressCheckpointRef.current[videoStatus.videoId] = 100;
    }

    if (normalizedStatus === VideoStatus.ERROR) {
      title = `${videoName} needs attention`;
      detail = videoStatus.error || videoStatus.message || "Processing failed.";
      kind = "error";
    }

    if (
      normalizedStatus === VideoStatus.READY ||
      normalizedStatus === VideoStatus.ERROR
    ) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.videoId === videoStatus.videoId && n.kind === "processing"
            ? { ...n, resolved: true }
            : n,
        ),
      );
    }

    addNotification({
      videoId: videoStatus.videoId,
      title,
      detail,
      kind,
      status:
        normalizedStatus === "unknown" ? videoStatus.status : normalizedStatus,
    });

    // Only re-fetch from API on terminal states — intermediate states (UPLOADED, PROCESSING)
    // are already applied in real-time via videoStatusUpdate prop on VideoList.
    // Re-fetching on every socket event causes rate limit exhaustion.
    if (normalizedStatus === VideoStatus.READY || normalizedStatus === VideoStatus.ERROR) {
      if (refreshDebounceRef.current) clearTimeout(refreshDebounceRef.current);
      refreshDebounceRef.current = setTimeout(() => {
        setRefreshTrigger((prev) => prev + 1);
      }, 1500);
    }
  }, [addNotification, getVideoName, videoStatus]);

  useEffect(() => {
    if (!progress) {
      return;
    }

    const checkpoints = [10, 25, 50, 75, 90, 100];
    const matchedCheckpoint =
      checkpoints
        .filter((checkpoint) => progress.progress >= checkpoint)
        .pop() || 0;

    if (matchedCheckpoint === 0) {
      return;
    }

    const previousCheckpoint =
      progressCheckpointRef.current[progress.videoId] || 0;
    if (matchedCheckpoint <= previousCheckpoint) {
      return;
    }

    progressCheckpointRef.current[progress.videoId] = matchedCheckpoint;

    const videoName = getVideoName(progress.videoId);
    addNotification({
      videoId: progress.videoId,
      title: `${videoName} is processing`,
      detail: `Transcoding is ${matchedCheckpoint}% complete.`,
      kind: "processing",
      status: VideoStatus.PROCESSING,
      progress: matchedCheckpoint,
    });
  }, [addNotification, getVideoName, progress]);

  useEffect(() => {
    if (!showNotifications) {
      return;
    }

    setNotifications((prev) =>
      prev.map((notification) =>
        notification.read ? notification : { ...notification, read: true },
      ),
    );
  }, [showNotifications]);

  const suggestions = useMemo(() => {
    const query = searchInput.trim().toLowerCase();
    if (query.length < 2) {
      return [];
    }

    const suggestionSet = new Set<string>();

    for (const video of allVideos) {
      const title = video.title?.trim() || video.filename;
      if (title.toLowerCase().includes(query)) {
        suggestionSet.add(title);
      }

      if (suggestionSet.size >= 7) {
        break;
      }
    }

    return Array.from(suggestionSet).slice(0, 7);
  }, [allVideos, searchInput]);

  const activeFilterLabel =
    filterChips.find((chip) => chip.id === statusFilter)?.label || "All";
  const hasSearch = debouncedSearch.length > 0;
  const unreadNotifications = notifications.filter(
    (notification) => !notification.read,
  ).length;
  const socketStatusTone = isSocketConnected
    ? "text-emerald-600 dark:text-emerald-400"
    : isSocketConnecting
      ? "text-amber-600 dark:text-amber-300"
      : "text-rose-600 dark:text-rose-400";

  return (
    <div className="yt-shell min-h-screen">
      <header className="yt-topbar sticky top-0 z-50">
        <div className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              className="flex shrink-0 items-center gap-2.5"
              onClick={() => handleNavSelect("home", "feed")}
            >
              <div className="rounded-lg bg-primary p-1.5 text-primary-foreground shadow-md shadow-primary/25">
                <PlaySquare className="h-5 w-5" aria-hidden="true" />
              </div>
              <span className="hidden text-base font-bold text-foreground sm:block">
                VisionSync
              </span>
            </button>

            <div
              ref={searchBoxRef}
              className="relative min-w-0 flex-1 sm:max-w-[300px] md:max-w-[360px] lg:max-w-[430px]"
            >
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setDebouncedSearch(searchInput.trim());
                    setShowSuggestions(false);
                  }

                  if (e.key === "Escape") {
                    setShowSuggestions(false);
                  }
                }}
                placeholder="Search titles, descriptions, and streaming states..."
                className="h-10 rounded-full pl-10 pr-10 sm:h-11"
              />

              {searchInput.length > 0 && (
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                  onClick={() => {
                    setSearchInput("");
                    setDebouncedSearch("");
                    setShowSuggestions(false);
                  }}
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-[calc(100%+0.4rem)] z-20 overflow-hidden rounded-2xl border border-border bg-card/95 p-1 shadow-xl backdrop-blur">
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-card-foreground transition hover:bg-muted"
                      onClick={() => {
                        setSearchInput(suggestion);
                        setDebouncedSearch(suggestion);
                        setShowSuggestions(false);
                      }}
                    >
                      <Search
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="line-clamp-1">{suggestion}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="rounded-full"
                onClick={() =>
                  setThemeMode((prev) => (prev === "dark" ? "light" : "dark"))
                }
              >
                {themeMode === "dark" ? (
                  <SunMedium className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Moon className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>

              <Button
                type="button"
                variant={activeNav === "studio" ? "default" : "outline"}
                className="hidden rounded-full sm:inline-flex"
                onClick={() => handleNavSelect("studio", "studio")}
              >
                <UploadCloud className="mr-2 h-4 w-4" aria-hidden="true" />
                Build Studio
              </Button>

              <Button
                type="button"
                variant={activeNav === "studio" ? "default" : "outline"}
                size="icon"
                className="rounded-full sm:hidden"
                onClick={() => handleNavSelect("studio", "studio")}
              >
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
              </Button>

              <div ref={notificationBoxRef} className="relative">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="relative rounded-full"
                  onClick={() => setShowNotifications((prev) => !prev)}
                  aria-label="Open notifications"
                >
                  <Bell className="h-4 w-4" aria-hidden="true" />
                  {unreadNotifications > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
                      {unreadNotifications > 9 ? "9+" : unreadNotifications}
                    </span>
                  )}
                </Button>

                {showNotifications && (
                  <div className="yt-notification-panel absolute right-0 top-[calc(100%+0.55rem)] z-30 w-[min(92vw,24rem)] overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur">
                    <div className="border-b border-border/70 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            Notifications
                          </p>
                          <p className={cn("text-xs", socketStatusTone)}>
                            {isSocketConnected
                              ? "Live updates connected"
                              : isSocketConnecting
                                ? "Connecting to live updates..."
                                : "Live updates disconnected"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {!isSocketConnected && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 rounded-full px-2 text-[11px]"
                              onClick={reconnect}
                            >
                              Retry
                            </Button>
                          )}
                          {notifications.length > 0 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 rounded-full px-2 text-[11px]"
                              onClick={() => setNotifications([])}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="max-h-[22rem] overflow-y-auto p-2">
                      {notifications.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center">
                          <p className="text-sm font-medium text-foreground">
                            No notifications yet
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Upload a video and live updates will appear here.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {notifications.map((notification) => {
                            const icon =
                              notification.kind === "ready" ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                              ) : notification.kind === "error" ? (
                                <AlertTriangle className="h-4 w-4 text-rose-500" />
                              ) : notification.kind === "processing" ? (
                                notification.resolved ? (
                                  <CheckCircle2 className="h-4 w-4 text-amber-500" />
                                ) : (
                                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                                )
                              ) : notification.kind === "upload" ? (
                                <UploadCloud className="h-4 w-4 text-sky-500" />
                              ) : (
                                <Bell className="h-4 w-4 text-muted-foreground" />
                              );

                            const isWatchable =
                              notification.kind === "ready" &&
                              notification.videoId;

                            return (
                              <div
                                key={notification.id}
                                role={isWatchable ? "button" : undefined}
                                tabIndex={isWatchable ? 0 : undefined}
                                onClick={() => {
                                  if (isWatchable) {
                                    setShowNotifications(false);
                                    navigate(`/watch/${notification.videoId}`);
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (isWatchable && (e.key === "Enter" || e.key === " ")) {
                                    setShowNotifications(false);
                                    navigate(`/watch/${notification.videoId}`);
                                  }
                                }}
                                className={cn(
                                  "yt-notification-item rounded-xl border border-border/70 px-3 py-2",
                                  !notification.read && "is-unread",
                                  isWatchable && "cursor-pointer hover:border-emerald-500/50 hover:bg-emerald-50/5 transition-colors",
                                )}
                              >
                                <div className="flex items-start gap-2">
                                  <span className="mt-0.5 shrink-0">
                                    {icon}
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="line-clamp-1 text-sm font-medium text-foreground">
                                        {notification.title}
                                      </p>
                                      <span className="shrink-0 text-[11px] text-muted-foreground">
                                        {formatRelativeTime(
                                          notification.createdAt,
                                        )}
                                      </span>
                                    </div>
                                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                      {notification.detail}
                                    </p>
                                    {isWatchable && (
                                      <p className="mt-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                        Click to watch →
                                      </p>
                                    )}
                                    {typeof notification.progress ===
                                      "number" && (
                                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                        <div
                                          className="h-full rounded-full bg-primary transition-[width] duration-300"
                                          style={{
                                            width: `${Math.min(100, Math.max(0, notification.progress))}%`,
                                          }}
                                        />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1600px] gap-4 px-3 pb-28 pt-4 sm:px-6 md:pb-12">
        <aside className="yt-sidebar hidden shrink-0 md:block md:w-20 lg:w-64">
          <div className="yt-surface p-3">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "yt-sidebar-item",
                  "md:justify-center lg:justify-start",
                  item.id === activeNav && "is-active",
                )}
                onClick={() => handleNavSelect(item.id, item.mode)}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span className="hidden lg:inline">{item.label}</span>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 flex-1 space-y-6">
          <div className="feed-enter page-header">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary/80">
              {appMode === "studio" ? "Creator Studio" : "Library"}
            </p>
            <h1 className="mt-1.5 text-3xl font-bold text-foreground sm:text-4xl">
              {appMode === "studio" ? "Upload & manage" : "Your videos"}
            </h1>
            <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
              {appMode === "studio"
                ? "Upload new videos and track processing status in real time."
                : "Browse, filter, and stream your content in one place."}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {filterChips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={cn(
                  "yt-chip",
                  statusFilter === chip.id && "is-active",
                )}
                onClick={() => setStatusFilter(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {(hasSearch || statusFilter !== "all" || searchInput.trim().length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {statusFilter !== "all" && (
                <span className="inline-flex items-center gap-1">
                  <Sparkles className="h-3 w-3" aria-hidden="true" />
                  {activeFilterLabel}
                </span>
              )}
              {hasSearch && (
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                  "{debouncedSearch}"
                </span>
              )}
              {!hasSearch && searchInput.trim().length > 0 && (
                <Badge variant="outline" className="rounded-full text-[11px]">
                  Typing…
                </Badge>
              )}
            </div>
          )}

          {appMode === "studio" ? (
            <div className="space-y-6">
              <VideoUploadComponent
                onUploadComplete={handleUploadComplete}
                onUploadStart={handleUploadStart}
              />
              <VideoList
                refreshTrigger={refreshTrigger}
                onVideoSelect={handleVideoSelect}
                filterQuery={debouncedSearch}
                statusFilter={statusFilter}
                onVideosLoaded={handleVideosLoaded}
                videoStatusUpdate={videoStatus}
              />
            </div>
          ) : (
            <div className="space-y-6">
              <VideoList
                refreshTrigger={refreshTrigger}
                onVideoSelect={handleVideoSelect}
                filterQuery={debouncedSearch}
                statusFilter={statusFilter}
                onVideosLoaded={handleVideosLoaded}
                videoStatusUpdate={videoStatus}
              />
            </div>
          )}
        </main>
      </div>

      <nav className="fixed bottom-3 left-3 right-3 z-40 pb-[max(0.25rem,env(safe-area-inset-bottom))] md:hidden">
        <div className="yt-mobile-dock-shell">
          <div className="yt-surface yt-mobile-dock flex items-center justify-between px-2 py-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className={cn(
                  "yt-mobile-nav-item",
                  item.id === activeNav && "is-active",
                )}
                onClick={() => handleNavSelect(item.id, item.mode)}
              >
                <item.icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.mobileLabel}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <footer className="yt-footer w-full">
        <div className="mx-auto w-full max-w-[1600px] px-3 py-4 sm:px-6">
          <p className="text-xs text-muted-foreground">
            VisionSync · DASH adaptive streaming
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
