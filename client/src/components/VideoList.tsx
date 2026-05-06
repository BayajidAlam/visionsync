import { useEffect, useMemo, useState } from "react";
import { Clock, Eye, FileVideo, Loader2, Play, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Video, VideoStatus } from "../types";
import { apiService } from "@/service/api";
import { formatDuration, formatFileSize } from "@/lib/utils";

interface VideoStatusUpdate {
  videoId: string;
  status: string;
  timestamp?: string;
  manifestUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
}

interface VideoListProps {
  refreshTrigger: number;
  onVideoSelect: (video: Video) => void;
  filterQuery?: string;
  statusFilter?: "all" | VideoStatus;
  onVideosLoaded?: (videos: Video[]) => void;
  videoStatusUpdate?: VideoStatusUpdate | null;
}

export function VideoList({
  refreshTrigger,
  onVideoSelect,
  filterQuery = "",
  statusFilter = "all",
  onVideosLoaded,
  videoStatusUpdate,
}: VideoListProps) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real-time status update from socket — no API round-trip needed
  useEffect(() => {
    if (!videoStatusUpdate) return;
    setVideos((prev) =>
      prev.map((v) => {
        if (v.id !== videoStatusUpdate.videoId) return v;
        return {
          ...v,
          status: videoStatusUpdate.status as VideoStatus,
          ...(videoStatusUpdate.manifestUrl && { manifestUrl: videoStatusUpdate.manifestUrl }),
          ...(videoStatusUpdate.thumbnailUrl && { thumbnailUrl: videoStatusUpdate.thumbnailUrl }),
          ...(videoStatusUpdate.videoUrl && { videoUrl: videoStatusUpdate.videoUrl }),
        };
      }),
    );
  }, [videoStatusUpdate]);

  const fetchVideos = async () => {
    try {
      setLoading(true);
      const response = await apiService.getAllVideos();
      setVideos(response.data);
      onVideosLoaded?.(response.data);
      setError(null);
    } catch (err) {
      console.error("Error fetching videos:", err);
      // On rate limit (429), keep existing data rather than showing an error
      if (err instanceof Error && (err.message.includes("429") || err.message.toLowerCase().includes("limit"))) {
        return;
      }
      setError("Failed to fetch videos");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, [refreshTrigger, onVideosLoaded]);

  const filteredVideos = useMemo(() => {
    const query = filterQuery.trim().toLowerCase();
    let nextVideos = videos;

    if (statusFilter !== "all") {
      nextVideos = nextVideos.filter((video) => video.status === statusFilter);
    }

    if (query) {
      nextVideos = nextVideos.filter((video) => {
        const title = video.title?.toLowerCase() || "";
        const description = video.description?.toLowerCase() || "";
        return title.includes(query) || description.includes(query);
      });
    }

    return [...nextVideos].sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [filterQuery, statusFilter, videos]);

  const totalVideos = videos.length;

  const hasActiveFilters =
    statusFilter !== "all" || filterQuery.trim().length > 0;

  const filterSummary = useMemo(() => {
    const summary: string[] = [];
    if (statusFilter !== "all") {
      summary.push(`status: ${statusFilter}`);
    }
    if (filterQuery.trim()) {
      summary.push(`search: "${filterQuery.trim()}"`);
    }

    if (summary.length === 0) {
      return "no active filters";
    }

    return summary.join(" • ");
  }, [filterQuery, statusFilter]);

  const searchableVideos = useMemo(() => {
    if (!filterQuery.trim()) {
      return videos;
    }

    const query = filterQuery.trim().toLowerCase();
    return videos.filter((video) => {
      const title = video.title?.toLowerCase() || "";
      const description = video.description?.toLowerCase() || "";
      return title.includes(query) || description.includes(query);
    });
  }, [filterQuery, videos]);

  const handleDelete = async (videoId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    if (!confirm("Are you sure you want to delete this video?")) {
      return;
    }

    try {
      await apiService.deleteVideo(videoId);
      setVideos((prev) => prev.filter((v) => v.id !== videoId));
    } catch (err) {
      console.error("Error deleting video:", err);
      alert("Failed to delete video");
    }
  };

  const getStatusBadgeClass = (status: VideoStatus) => {
    switch (status) {
      case VideoStatus.UPLOADING:
        return "bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800";
      case VideoStatus.UPLOADED:
        return "bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-400 dark:border-indigo-800";
      case VideoStatus.PROCESSING:
        return "bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800";
      case VideoStatus.READY:
        return "bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800";
      case VideoStatus.ERROR:
        return "bg-rose-50 text-rose-600 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800";
      default:
        return "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700";
    }
  };

  return (
    <section className="yt-surface p-5 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">All Videos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {filteredVideos.length} of {totalVideos} · {filterSummary}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-8 rounded-lg text-xs" onClick={fetchVideos}>
          <RefreshCw className="mr-1.5 h-3 w-3" />
          Refresh
        </Button>
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="overflow-hidden rounded-2xl border bg-card"
            >
              <div className="aspect-video animate-pulse bg-muted" />
              <div className="space-y-3 p-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-full animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-center">
          <p className="text-rose-700">{error}</p>
          <Button onClick={fetchVideos} className="mt-3">
            Try Again
          </Button>
        </div>
      )}

      {!loading && !error && filteredVideos.length === 0 && (
        <div className="rounded-xl border border-border bg-card/80 p-8 text-center">
          <FileVideo className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-medium text-foreground">
            {videos.length === 0
              ? "No videos uploaded yet"
              : "No videos match your current filters"}
          </p>
          {hasActiveFilters && (
            <p className="mt-2 text-sm text-muted-foreground">
              Try broadening filters or clearing search terms.
            </p>
          )}
        </div>
      )}

      {!loading && !error && filteredVideos.length > 0 && (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filteredVideos.map((video) => (
            <Card
              key={video.id}
              className="group cursor-pointer overflow-hidden rounded-2xl border border-border bg-card py-0 shadow-sm transition-all duration-200 hover:border-border hover:shadow-md"
              onClick={() => onVideoSelect(video)}
            >
              <CardContent className="p-0">
                <div className="relative aspect-video overflow-hidden bg-slate-950">
                  {video.thumbnailUrl ? (
                    <img
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
                        <Play className="h-5 w-5 translate-x-0.5 text-white/80" />
                      </div>
                    </div>
                  )}

                  {video.duration && (
                    <span className="absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                      {formatDuration(video.duration)}
                    </span>
                  )}
                </div>

                <div className="space-y-2.5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-foreground">
                      {video.title}
                    </h3>
                    <Badge
                      variant="outline"
                      className={`mt-0.5 shrink-0 rounded-full border px-2 py-0 text-[11px] font-semibold ${getStatusBadgeClass(video.status)}`}
                    >
                      {(video.status === VideoStatus.PROCESSING ||
                        video.status === VideoStatus.UPLOADING) && (
                        <Loader2 className="mr-1 h-2.5 w-2.5 animate-spin" />
                      )}
                      {video.status}
                    </Badge>
                  </div>

                  {video.description && (
                    <p className="line-clamp-1 text-xs text-muted-foreground">
                      {video.description}
                    </p>
                  )}

                  <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
                    <span>{formatFileSize(video.fileSize)}</span>
                    <span className="text-border">·</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(video.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 border-t border-border/60 px-4 pb-3.5 pt-2.5">
                  <Button
                    size="sm"
                    className="h-8 flex-1 rounded-lg text-xs"
                    disabled={video.status !== VideoStatus.READY}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVideoSelect(video);
                    }}
                  >
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    Watch
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleDelete(video.id, e)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!loading &&
        !error &&
        searchableVideos.length === 0 &&
        filterQuery.trim() && (
          <p className="mt-4 text-xs text-muted-foreground">
            Search is active but no raw matches exist before status filtering.
          </p>
        )}
    </section>
  );
}
