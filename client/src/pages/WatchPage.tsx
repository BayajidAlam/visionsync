// client/src/pages/WatchPage.tsx
// Clean route: /watch/:videoId  — fetches video then renders the player

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, AlertTriangle } from "lucide-react";
import { VideoWatch } from "../components/VideoWatch";
import { apiService } from "@/service/api";
import { VideoStatus, type Video } from "../types";

export function WatchPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();

  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoId) {
      setError("No video ID provided.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let poller: ReturnType<typeof setInterval> | null = null;
    setLoading(true);
    setError(null);

    const loadVideo = async (showSpinner = false): Promise<void> => {
      try {
        if (showSpinner && !cancelled) setLoading(true);
        const res = await apiService.getVideo(videoId);
        if (cancelled) return;

        setVideo(res.data);
        setError(null);
        setLoading(false);

        const isTerminal =
          res.data.status === VideoStatus.READY ||
          res.data.status === VideoStatus.ERROR;

        if (!isTerminal && !poller) {
          poller = setInterval(() => {
            void loadVideo(false);
          }, 5000);
        }

        if (isTerminal && poller) {
          clearInterval(poller);
          poller = null;
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load video.",
          );
          setLoading(false);
        }
      }
    };

    void loadVideo(true);

    return () => {
      cancelled = true;
      if (poller) clearInterval(poller);
    };
  }, [videoId]);

  const handleBack = () => navigate(-1);

  if (loading) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-[#0f0f0f]">
        <div className="flex flex-col items-center gap-3 text-white/60">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Loading video…</p>
        </div>
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-4 bg-[#0f0f0f] px-6 text-center">
        <AlertTriangle className="h-10 w-10 text-rose-400" />
        <p className="text-base font-semibold text-white">
          {error ?? "Video not found."}
        </p>
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition"
        >
          <ArrowLeft className="h-4 w-4" />
          Go back
        </button>
      </div>
    );
  }

  return <VideoWatch video={video} onClose={handleBack} />;
}
