import { useEffect, useMemo, useState } from "react";
import { Clock, Eye, FileVideo, Play, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Video, VideoStatus } from "../types";
import { apiService } from "@/service/api";
import { formatDuration, formatFileSize } from "@/lib/utils";

interface VideoListProps {
  refreshTrigger: number;
  onVideoSelect: (video: Video) => void;
  filterQuery?: string;
  statusFilter?: "all" | VideoStatus;
  onVideosLoaded?: (videos: Video[]) => void;
}

export function VideoList({
  refreshTrigger,
  onVideoSelect,
  filterQuery = "",
  statusFilter = "all",
  onVideosLoaded,
}: VideoListProps) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVideos = async () => {
    try {
      setLoading(true);
      const response = await apiService.getAllVideos();
      setVideos(response.data);
      onVideosLoaded?.(response.data);
      setError(null);
    } catch (err) {
      setError("Failed to fetch videos");
      console.error("Error fetching videos:", err);
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
        return "bg-blue-100 text-blue-700 border-blue-200";
      case VideoStatus.UPLOADED:
        return "bg-indigo-100 text-indigo-700 border-indigo-200";
      case VideoStatus.PROCESSING:
        return "bg-amber-100 text-amber-700 border-amber-200";
      case VideoStatus.READY:
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case VideoStatus.ERROR:
        return "bg-rose-100 text-rose-700 border-rose-200";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200";
    }
  };

  return (
    <section className="yt-surface p-5 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
            Video Library
          </p>
          <h2 className="mt-1 text-2xl font-bold text-foreground">Your Feed</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {filteredVideos.length} shown / {totalVideos} total •{" "}
            {filterSummary}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchVideos}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
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
              className="group overflow-hidden rounded-2xl border border-border/80 bg-card/90 py-0 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
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
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900">
                      <Play className="h-10 w-10 text-white/70" />
                    </div>
                  )}

                  {video.duration && (
                    <span className="absolute bottom-2 right-2 rounded-md bg-black/80 px-2 py-1 text-xs font-semibold text-white">
                      {formatDuration(video.duration)}
                    </span>
                  )}
                </div>

                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 text-sm font-semibold text-foreground">
                      {video.title}
                    </h3>
                    <Badge
                      variant="outline"
                      className={`shrink-0 border ${getStatusBadgeClass(video.status)}`}
                    >
                      {video.status}
                    </Badge>
                  </div>

                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {video.description ||
                      "Adaptive stream ready for distribution and playback."}
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>{formatFileSize(video.fileSize)}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(video.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 border-t border-border/70 px-4 pb-4 pt-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={video.status !== VideoStatus.READY}
                    onClick={(e) => {
                      e.stopPropagation();
                      onVideoSelect(video);
                    }}
                  >
                    <Eye className="mr-1 h-3.5 w-3.5" />
                    Watch
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
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
