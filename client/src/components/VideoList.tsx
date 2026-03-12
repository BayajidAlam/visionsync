import { useState, useEffect } from 'react'
import { Play, Clock, FileVideo, Trash2, Edit, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Video, VideoStatus } from '../types'
import { apiService } from '@/service/api'
import { formatDuration, formatFileSize } from '@/lib/utils'


interface VideoListProps {
  refreshTrigger: number
  onVideoSelect: (video: Video) => void
}

export function VideoList({ refreshTrigger, onVideoSelect }: VideoListProps) {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchVideos = async () => {
    try {
      setLoading(true)
      const response = await apiService.getAllVideos()
      setVideos(response.data)
      setError(null)
    } catch (err) {
      setError('Failed to fetch videos')
      console.error('Error fetching videos:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchVideos()
  }, [refreshTrigger])

  const handleDelete = async (videoId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!confirm('Are you sure you want to delete this video?')) {
      return
    }

    try {
      await apiService.deleteVideo(videoId)
      setVideos(prev => prev.filter(v => v.id !== videoId))
    } catch (err) {
      console.error('Error deleting video:', err)
      alert('Failed to delete video')
    }
  }

  const getStatusColor = (status: VideoStatus) => {
    switch (status) {
      case VideoStatus.UPLOADING: return 'bg-blue-500'
      case VideoStatus.UPLOADED: return 'bg-yellow-500'
      case VideoStatus.PROCESSING: return 'bg-orange-500'
      case VideoStatus.READY: return 'bg-green-500'
      case VideoStatus.ERROR: return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Videos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Videos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-red-500">{error}</p>
            <Button onClick={fetchVideos} className="mt-4">
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Your Videos ({videos.length})</span>
          <Button variant="outline" size="sm" onClick={fetchVideos}>
            Refresh
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {videos.length === 0 ? (
          <div className="text-center py-8">
            <FileVideo className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No videos uploaded yet</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {videos.map((video) => (
              <Card 
                key={video.id} 
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => onVideoSelect(video)}
              >
                <CardContent className="p-4">
                  <div className="space-y-3">
                    {/* Thumbnail placeholder */}
                    <div className="aspect-video bg-muted rounded-lg flex items-center justify-center">
                      {video.thumbnailUrl ? (
                        <img 
                          src={video.thumbnailUrl} 
                          alt={video.title}
                          className="w-full h-full object-cover rounded-lg"
                        />
                      ) : (
                        <Play className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>

                    {/* Video info */}
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium line-clamp-2 flex-1">
                          {video.title}
                        </h3>
                        <Badge 
                          variant="secondary"
                          className={`${getStatusColor(video.status)} text-white text-xs shrink-0`}
                        >
                          {video.status}
                        </Badge>
                      </div>

                      {video.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {video.description}
                        </p>
                      )}

                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        {video.duration && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDuration(video.duration)}
                          </div>
                        )}
                        <span>{formatFileSize(video.fileSize)}</span>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        {new Date(video.createdAt).toLocaleDateString()}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t">
                      <Button 
                        size="sm" 
                        variant="outline"
                        className="flex-1"
                        disabled={video.status !== VideoStatus.READY}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        Watch
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation()
                          // Handle edit
                        }}
                      >
                        <Edit className="h-3 w-3" />
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={(e) => handleDelete(video.id, e)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}