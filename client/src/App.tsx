import { useState } from 'react'
import { VideoUploadComponent } from './components/VideoUpload'
import { VideoList } from './components/VideoList'
import { VideoPlayer } from './components/VideoPlayer'
import type { Video } from './types'

function App() {
  const [refreshTrigger, setRefreshTrigger] = useState(0)
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null)

  const handleUploadComplete = (videoId: string) => {
    console.log('Upload completed for video:', videoId)
    // Refresh the video list
    setRefreshTrigger(prev => prev + 1)
  }

  const handleVideoSelect = (video: Video) => {
    setSelectedVideo(video)
  }

  const handleClosePlayer = () => {
    setSelectedVideo(null)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto py-8 px-4">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            VisionSync
          </h1>
          <p className="text-gray-600">
            Upload, process, and stream your videos with adaptive quality
          </p>
        </div>

        {/* Main Content */}
        <div className="space-y-8">
          {selectedVideo ? (
            /* Video Player View */
            <VideoPlayer 
              video={selectedVideo} 
              onClose={handleClosePlayer}
            />
          ) : (
            /* Upload and List View */
            <>
              <VideoUploadComponent 
                onUploadComplete={handleUploadComplete}
              />
              
              <VideoList 
                refreshTrigger={refreshTrigger}
                onVideoSelect={handleVideoSelect}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="mt-16 pt-8 border-t border-gray-200">
          <div className="text-center text-sm text-gray-500">
            <p>VisionSync - Adaptive Video Streaming Platform</p>
            <p className="mt-1">
              Supports MP4, MOV, AVI formats with automatic DASH conversion
            </p>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default App