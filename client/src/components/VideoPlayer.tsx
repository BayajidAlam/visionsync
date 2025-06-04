import React, { useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, AlertCircle } from 'lucide-react';

// DASH.js types
interface DashPlayer {
  initialize: (videoElement: HTMLVideoElement, url: string, autoPlay: boolean) => void;
  destroy: () => void;
  on: (event: string, callback: (e: any) => void) => void;
  off: (event: string, callback: (e: any) => void) => void;
  getQualityFor: (type: string) => number;
  setQualityFor: (type: string, quality: number) => void;
  getBitrateInfoListFor: (type: string) => Array<{ bitrate: number; width?: number; height?: number; qualityIndex: number }>;
}

declare global {
  interface Window {
    dashjs: {
      MediaPlayer: () => {
        create: () => DashPlayer;
      };
    };
  }
}

interface VideoPlayerProps {
  manifestUrl: string;
  title?: string;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  manifestUrl,
  title = "Video",
  poster,
  autoPlay = false,
  className = ""
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerRef = useRef<DashPlayer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qualities, setQualities] = useState<Array<{ bitrate: number; width?: number; height?: number; qualityIndex: number }>>([]);
  const [currentQuality, setCurrentQuality] = useState<string>('auto');
  const [dashLoaded, setDashLoaded] = useState(false);

  // Load DASH.js library
  useEffect(() => {
    if (window.dashjs) {
      setDashLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.dashjs.org/latest/dash.all.min.js';
    script.onload = () => setDashLoaded(true);
    script.onerror = () => setError('Failed to load video player library');
    document.head.appendChild(script);

    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  // Initialize player when DASH.js is loaded
  useEffect(() => {
    if (!dashLoaded || !videoRef.current || !manifestUrl) return;

    const video = videoRef.current;
    const player = window.dashjs.MediaPlayer().create();
    playerRef.current = player;

    // Event listeners
    const onStreamInitialized = () => {
      setIsLoading(false);
      const bitrateInfo = player.getBitrateInfoListFor('video');
      setQualities(bitrateInfo);
    };

    const onError = (e: any) => {
      console.error('DASH player error:', e);
      setError('Failed to load video');
      setIsLoading(false);
    };

    const onCanPlay = () => {
      setIsLoading(false);
    };

    player.on('streamInitialized', onStreamInitialized);
    player.on('error', onError);
    video.addEventListener('canplay', onCanPlay);

    try {
      player.initialize(video, manifestUrl, autoPlay);
    } catch (err) {
      console.error('Error initializing player:', err);
      setError('Failed to initialize video player');
      setIsLoading(false);
    }

    return () => {
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      video.removeEventListener('canplay', onCanPlay);
    };
  }, [dashLoaded, manifestUrl, autoPlay]);

  const handleQualityChange = (value: string) => {
    if (playerRef.current) {
      const qualityIndex = value === 'auto' ? -1 : parseInt(value);
      playerRef.current.setQualityFor('video', qualityIndex);
      setCurrentQuality(value);
    }
  };

  const handleRetry = () => {
    setError(null);
    setIsLoading(true);
    window.location.reload();
  };

  if (error) {
    return (
      <div className={`w-full ${className}`}>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex flex-col gap-3">
            <div>
              <h3 className="font-semibold">Video Unavailable</h3>
              <p className="text-sm">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={handleRetry} className="w-fit">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className={`relative w-full bg-black rounded-lg overflow-hidden ${className}`}>
      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10">
          <Loader2 className="h-8 w-8 animate-spin text-white mb-3" />
          <p className="text-white text-sm">Loading video...</p>
        </div>
      )}
      
      {/* Video Element */}
      <video
        ref={videoRef}
        controls
        poster={poster}
        className="w-full h-auto block"
        style={{ aspectRatio: '16/9' }}
      >
        <p className="text-white p-4">Your browser does not support the video tag or DASH streaming.</p>
      </video>

      {/* Quality Selector */}
      {qualities.length > 0 && (
        <div className="absolute top-3 right-3 z-20">
          <Select value={currentQuality} onValueChange={handleQualityChange}>
            <SelectTrigger className="w-32 bg-black/70 border-white/20 text-white text-xs">
              <SelectValue placeholder="Quality" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto</SelectItem>
              {qualities.map((quality, index) => (
                <SelectItem 
                  key={index} 
                  value={quality.qualityIndex.toString()}
                >
                  {quality.height}p ({Math.round(quality.bitrate / 1000)}k)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
};