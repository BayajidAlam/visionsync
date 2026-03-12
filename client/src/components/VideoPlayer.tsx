import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Video, VideoStatus } from "../types";
// dashjs is loaded as a UMD global via <script src="/dashjs.min.js"> in index.html.
// Do NOT import it through the bundler — both Rollup and esbuild mis-initialize
// dashjs’s embedded webpack module system, leaving window.dashjs.MediaPlayer undefined.
const _dashjs = () => (window as any).dashjs;

interface VideoPlayerProps {
  video: Video;
  onClose: () => void;
}

export function VideoPlayer({ video, onClose }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dashPlayerRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qualityLevels, setQualityLevels] = useState<any[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);

  // Initialize DASH player
  useEffect(() => {
    if (video.status === VideoStatus.READY && videoRef.current) {
      try {
        // Clean up previous player
        if (dashPlayerRef.current) {
          dashPlayerRef.current.destroy();
        }

        if (video.manifestUrl) {
          // Initialize DASH player using the stored CloudFront manifest URL
          const manifestUrl = video.manifestUrl;
          const player = _dashjs().MediaPlayer().create();

          // Configure player
          player.updateSettings({
            streaming: {
              abr: {
                autoSwitchBitrate: {
                  video: true,
                  audio: true,
                },
              },
            },
          });

          // Set up event listeners (using string constants avoids static-property
          // resolution issues across different dashjs bundle formats)
          player.on("streamInitialized", () => {
            console.log("DASH stream initialized");
            const tracks = (player as any).getBitrateInfoListFor("video");
            setQualityLevels(tracks);
          });

          player.on("qualityChangeRendered", (e: any) => {
            setCurrentQuality(e.newQuality);
          });

          player.on("error", (e: any) => {
            console.error("DASH Error:", e);
            setError(`Streaming error: ${e.error}`);
          });

          // Initialize player with video element and manifest
          player.initialize(videoRef.current, manifestUrl, false);
          dashPlayerRef.current = player;
        } else if (video.videoUrl) {
          // Fallback to regular video
          videoRef.current.src = video.videoUrl;
        } else {
          setError("No video source available");
        }
      } catch (err) {
        setError("Failed to initialize video player");
        console.error("Video initialization error:", err);
      }
    }

    // Cleanup on unmount
    return () => {
      if (dashPlayerRef.current) {
        dashPlayerRef.current.destroy();
        dashPlayerRef.current = null;
      }
    };
  }, [video]);

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    }
  };

  const changeQuality = (qualityIndex: number) => {
    if (dashPlayerRef.current) {
      if (qualityIndex === -1) {
        // Auto quality
        dashPlayerRef.current.updateSettings({
          streaming: {
            abr: {
              autoSwitchBitrate: { video: true },
            },
          },
        });
      } else {
        // Manual quality
        dashPlayerRef.current.updateSettings({
          streaming: {
            abr: {
              autoSwitchBitrate: { video: false },
            },
          },
        });
        dashPlayerRef.current.setQualityFor("video", qualityIndex);
      }
      setCurrentQuality(qualityIndex);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = vol;
      setVolume(vol);
      setIsMuted(vol === 0);
    }
  };

  const toggleFullscreen = () => {
    if (videoRef.current) {
      if (!isFullscreen) {
        videoRef.current.requestFullscreen();
        setIsFullscreen(true);
      } else {
        document.exitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const formatBitrate = (bitrate: number) => {
    return `${Math.round(bitrate / 1000)}kbps`;
  };

  if (video.status !== VideoStatus.READY) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{video.title}</span>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <RotateCcw className="h-4 w-4" />
            <AlertDescription>
              Video is {video.status}. Please wait for processing to complete.
              <Badge variant="secondary" className="ml-2">
                {video.status}
              </Badge>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{video.title}</span>
          <div className="flex items-center gap-2">
            <Badge variant="outline">DASH Streaming</Badge>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Video Player */}
          <div className="relative bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              className="w-full aspect-video"
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onError={() => setError("Failed to load video")}
            />

            {error && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Alert variant="destructive" className="max-w-md">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </div>
            )}
          </div>

          {/* Video Controls */}
          {!error && (
            <div className="space-y-3">
              {/* Progress Bar */}
              <div className="space-y-2">
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>

              {/* Control Buttons */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={togglePlay}>
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={toggleMute}>
                      {isMuted ? (
                        <VolumeX className="h-4 w-4" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </Button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={volume}
                      onChange={handleVolumeChange}
                      className="w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {/* Quality Selector */}
                  {qualityLevels.length > 0 && (
                    <select
                      value={currentQuality}
                      onChange={(e) => changeQuality(parseInt(e.target.value))}
                      className="text-sm border rounded px-2 py-1"
                    >
                      <option value={-1}>Auto</option>
                      {qualityLevels.map((level, index) => (
                        <option key={index} value={index}>
                          {level.height}p ({formatBitrate(level.bitrate)})
                        </option>
                      ))}
                    </select>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleFullscreen}
                  >
                    <Maximize className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Streaming Stats */}
          {dashPlayerRef.current && (
            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <p>🔴 Live DASH Stream</p>
              <p>Quality Levels: {qualityLevels.length}</p>
              <p>
                Current Quality:{" "}
                {currentQuality === -1
                  ? "Auto"
                  : `${qualityLevels[currentQuality]?.height}p`}
              </p>
            </div>
          )}

          {/* Video Info */}
          <div className="space-y-2 pt-4 border-t">
            <h3 className="font-semibold">{video.title}</h3>
            {video.description && (
              <p className="text-sm text-muted-foreground">
                {video.description}
              </p>
            )}
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>
                Uploaded: {new Date(video.createdAt).toLocaleDateString()}
              </span>
              <Badge variant="secondary">Ready</Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
