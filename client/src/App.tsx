import { useState, useRef } from 'react';
import { VideoPlayer } from './components/VideoPlayer';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Upload, Video, Library, ArrowLeft, Play, Clock, CheckCircle, XCircle, Loader2 } from 'lucide-react';

interface PresignedUrlResponse {
  presignedUrl: string;
  videoId: string;
}

interface Video {
  id: string;
  name: string;
  status: 'uploading' | 'processing' | 'completed' | 'failed';
  manifestUrl?: string;
  uploadedAt: string;
  size: number;
}

function App() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ message: string; isError: boolean }>({ 
    message: '', 
    isError: false 
  });
  const [isUploading, setIsUploading] = useState(false);
  const [videos, setVideos] = useState<Video[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null);
  const [currentView, setCurrentView] = useState<'upload' | 'library' | 'watch'>('upload');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setSelectedFile(file || null);
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setStatus({ message: 'Requesting upload URL...', isError: false });

    try {
      // Get presigned URL
      const presignedUrlResponse = await fetch(
        'http://localhost:5000/upload/generate-presigned-url',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            fileName: selectedFile.name, 
            fileType: selectedFile.type 
          }),
        }
      );

      if (!presignedUrlResponse.ok) throw new Error('Failed to get upload URL');

      const { presignedUrl, videoId } = await presignedUrlResponse.json() as PresignedUrlResponse;
      setStatus({ message: 'Uploading your video...', isError: false });

      // Upload to S3
      const uploadResponse = await fetch(presignedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': selectedFile.type },
        body: selectedFile,
      });

      if (!uploadResponse.ok) throw new Error('Upload failed');

      // Create video record
      const newVideo: Video = {
        id: videoId,
        name: selectedFile.name,
        status: 'processing',
        uploadedAt: new Date().toISOString(),
        size: selectedFile.size
      };

      setVideos(prev => [newVideo, ...prev]);
      setStatus({ 
        message: '🎉 Video uploaded! Processing will begin shortly...', 
        isError: false 
      });

      // Reset form
      setSelectedFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // TODO: Poll for processing status or use WebSocket
      // For now, simulate processing completion after 30 seconds
      setTimeout(() => {
        setVideos(prev => prev.map(video => 
          video.id === videoId 
            ? { 
                ...video, 
                status: 'completed',
                manifestUrl: `https://processed-sync-videos-bucket.s3.amazonaws.com/${videoId}/manifest.mpd`
              }
            : video
        ));
      }, 30000);
      
    } catch (error) {
      console.error('Upload error:', error);
      setStatus({ 
        message: 'Upload failed. Please try again.', 
        isError: true 
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleWatchVideo = (video: Video) => {
    if (video.status === 'completed' && video.manifestUrl) {
      setSelectedVideo(video);
      setCurrentView('watch');
    }
  };

  const getStatusBadge = (status: Video['status']) => {
    switch (status) {
      case 'uploading':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800"><Loader2 className="w-3 h-3 mr-1 animate-spin" />Uploading</Badge>;
      case 'processing':
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" />Processing</Badge>;
      case 'completed':
        return <Badge variant="secondary" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Ready</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  const formatFileSize = (bytes: number) => {
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <Video className="h-8 w-8 text-blue-600" />
              <h1 className="text-2xl font-bold text-gray-900">VisionSync</h1>
            </div>
            <nav className="flex space-x-2">
              <Button
                variant={currentView === 'upload' ? 'default' : 'ghost'}
                onClick={() => setCurrentView('upload')}
                className="flex items-center space-x-2"
              >
                <Upload className="h-4 w-4" />
                <span>Upload</span>
              </Button>
              <Button
                variant={currentView === 'library' ? 'default' : 'ghost'}
                onClick={() => setCurrentView('library')}
                className="flex items-center space-x-2"
              >
                <Library className="h-4 w-4" />
                <span>Library</span>
                {videos.length > 0 && (
                  <Badge variant="secondary" className="ml-1">{videos.length}</Badge>
                )}
              </Button>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentView === 'upload' && (
          <div className="max-w-2xl mx-auto">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Upload className="h-5 w-5" />
                  <span>Upload Video</span>
                </CardTitle>
                <CardDescription>
                  Upload your video in MP4, MOV, or AVI format. It will be processed into multiple qualities for adaptive streaming.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* File Input */}
                <div className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept="video/*"
                    onChange={handleFileChange}
                    disabled={isUploading}
                  />
                  
                  <div 
                    className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-gray-400 transition-colors cursor-pointer"
                    onClick={triggerFileInput}
                  >
                    <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                    <p className="text-lg font-medium text-gray-900 mb-2">
                      {selectedFile ? 'Change File' : 'Select Video File'}
                    </p>
                    <p className="text-sm text-gray-500">
                      Click to browse or drag and drop your video file
                    </p>
                  </div>

                  {selectedFile && (
                    <Card className="bg-blue-50">
                      <CardContent className="pt-4">
                        <div className="flex items-center space-x-3">
                          <Video className="h-5 w-5 text-blue-600" />
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">{selectedFile.name}</p>
                            <p className="text-sm text-gray-500">Size: {formatFileSize(selectedFile.size)}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Upload Button */}
                <Button
                  onClick={handleUpload}
                  disabled={!selectedFile || isUploading}
                  className="w-full"
                  size="lg"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    'Start Upload'
                  )}
                </Button>

                {/* Status Message */}
                {status.message && (
                  <Alert variant={status.isError ? "destructive" : "default"}>
                    <AlertDescription>{status.message}</AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {currentView === 'library' && (
          <div>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Video Library</h2>
              <p className="text-gray-600">Manage and watch your uploaded videos</p>
            </div>
            
            {videos.length === 0 ? (
              <Card className="max-w-2xl mx-auto">
                <CardContent className="pt-6 text-center">
                  <Library className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">No videos yet</h3>
                  <p className="text-gray-500 mb-4">Upload your first video to get started</p>
                  <Button onClick={() => setCurrentView('upload')}>
                    <Upload className="w-4 h-4 mr-2" />
                    Upload Video
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {videos.map((video) => (
                  <Card key={video.id} className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <CardTitle className="text-lg truncate">{video.name}</CardTitle>
                          <CardDescription className="mt-1">
                            {formatDate(video.uploadedAt)} • {formatFileSize(video.size)}
                          </CardDescription>
                        </div>
                        {getStatusBadge(video.status)}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="flex justify-between items-center">
                        <div className="text-sm text-gray-500">
                          ID: {video.id.split('/').pop()?.substring(0, 8)}...
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleWatchVideo(video)}
                          disabled={video.status !== 'completed'}
                          className="flex items-center space-x-1"
                        >
                          <Play className="w-3 h-3" />
                          <span>Watch</span>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {currentView === 'watch' && selectedVideo && (
          <div>
            <div className="mb-6">
              <Button
                variant="ghost"
                onClick={() => setCurrentView('library')}
                className="mb-4"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Library
              </Button>
              <h2 className="text-2xl font-bold text-gray-900">{selectedVideo.name}</h2>
              <p className="text-gray-600">
                Uploaded on {formatDate(selectedVideo.uploadedAt)} • {formatFileSize(selectedVideo.size)}
              </p>
            </div>
            
            {selectedVideo.manifestUrl ? (
              <div className="max-w-4xl mx-auto">
                <VideoPlayer 
                  manifestUrl={selectedVideo.manifestUrl}
                  title={selectedVideo.name}
                  className="w-full"
                />
              </div>
            ) : (
              <Card className="max-w-2xl mx-auto">
                <CardContent className="pt-6 text-center">
                  <Clock className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Video Not Ready</h3>
                  <p className="text-gray-500">This video is still being processed. Please check back later.</p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;