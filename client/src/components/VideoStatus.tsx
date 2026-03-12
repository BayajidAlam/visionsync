// client/src/components/VideoStatus.tsx
import React, { useEffect } from 'react';
import { useSocket } from '../hooks/useSocket';

interface VideoStatusProps {
  videoId: string;
  currentStatus?: string;
}

const VideoStatus: React.FC<VideoStatusProps> = ({ videoId, currentStatus }) => {
  const { isConnected, videoStatus, progress, joinVideo } = useSocket();

  // Join video room when component mounts
  useEffect(() => {
    if (isConnected && videoId) {
      joinVideo(videoId);
    }
  }, [isConnected, videoId, joinVideo]);

  // Use real-time status or fallback to prop
  const status = videoStatus?.videoId === videoId ? videoStatus.status : currentStatus;
  const message = videoStatus?.videoId === videoId ? videoStatus.message : '';

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'UPLOADING': return 'text-blue-600';
      case 'UPLOADED': return 'text-indigo-600';
      case 'PROCESSING': return 'text-yellow-600';
      case 'READY': return 'text-green-600';
      case 'ERROR': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getStatusIcon = (status?: string) => {
    switch (status) {
      case 'UPLOADING': return '📤';
      case 'UPLOADED': return '✅';
      case 'PROCESSING': return '⚙️';
      case 'READY': return '🎬';
      case 'ERROR': return '❌';
      default: return '⏳';
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm">
      <div className="flex items-center space-x-3">
        <div className="text-2xl">
          {getStatusIcon(status)}
        </div>
        <div className="flex-1">
          <div className={`font-medium ${getStatusColor(status)}`}>
            {status || 'Unknown'}
          </div>
          {message && (
            <div className="text-sm text-gray-600 mt-1">
              {message}
            </div>
          )}
          
          {/* Progress bar for processing */}
          {status === 'PROCESSING' && progress?.videoId === videoId && (
            <div className="mt-2">
              <div className="bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-yellow-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.progress}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {progress.progress}% complete
              </div>
            </div>
          )}

          {/* Connection status */}
          <div className="flex items-center mt-2 text-xs">
            <div 
              className={`w-2 h-2 rounded-full mr-2 ${
                isConnected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="text-gray-500">
              {isConnected ? 'Live updates' : 'Connecting...'}
            </span>
          </div>
        </div>
      </div>

      {/* Ready state - show streaming button */}
      {status === 'READY' && videoStatus?.manifestUrl && (
        <div className="mt-3 pt-3 border-t">
          <button className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">
            🎬 Play Video
          </button>
        </div>
      )}

      {/* Error state - show retry option */}
      {status === 'ERROR' && (
        <div className="mt-3 pt-3 border-t">
          <button className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">
            🔄 Retry Processing
          </button>
        </div>
      )}
    </div>
  );
};

export default VideoStatus;