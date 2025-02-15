// App.tsx
import { useState, useRef } from 'react';
import './App.css';

interface PresignedUrlResponse {
  presignedUrl: string;
  videoId: string;
}

const App = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<{ message: string; isError: boolean }>({ 
    message: '', 
    isError: false 
  });
  const [videoUrl, setVideoUrl] = useState('');
  const [isUploading, setIsUploading] = useState(false);
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

      // Show success
      const uploadedVideoUrl = `https://your-bucket.s3.amazonaws.com/${videoId}`;
      setVideoUrl(uploadedVideoUrl);
      setStatus({ 
        message: '🎉 Video uploaded successfully!', 
        isError: false 
      });
      
    } catch (error) {
      console.error('Upload error:', error);
      setStatus({ 
        message: '❌ Upload failed. Please try again.', 
        isError: true 
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="container">
      <div className="upload-header">
        <h1>Video Upload</h1>
        <p>Upload your video in MP4, MOV, or AVI format</p>
      </div>

      <div className="upload-zone">
        <input
          ref={fileInputRef}
          type="file"
          className="file-input"
          accept="video/*"
          onChange={handleFileChange}
          disabled={isUploading}
        />
        <button 
          className="custom-file-input"
          onClick={triggerFileInput}
          disabled={isUploading}
        >
          {selectedFile ? 'Change File' : 'Select Video'}
        </button>

        {selectedFile && (
          <div className="file-details">
            <p>Selected file: {selectedFile.name}</p>
            <p>Size: {(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
          </div>
        )}

        <button
          className="upload-button"
          onClick={handleUpload}
          disabled={!selectedFile || isUploading}
        >
          {isUploading ? (
            <>
              <span className="loading-spinner">⏳</span>
              Uploading...
            </>
          ) : (
            'Start Upload'
          )}
        </button>
      </div>

      {status.message && (
        <div className={`status-message ${status.isError ? 'status-error' : 'status-success'}`}>
          {status.message}
        </div>
      )}

      {videoUrl && (
        <div className="video-preview">
          <h2>Preview</h2>
          <video controls>
            <source src={videoUrl} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
          <div className="video-links">
            <a
              href={videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="video-link"
            >
              Open in new tab
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;