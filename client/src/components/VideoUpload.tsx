// client/src/components/VideoUpload.tsx - Fixed with proper backend integration

import { useState, useRef, useEffect } from "react";
import { Upload, X, Check, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { VideoUpload, VideoStatus } from "../types";
import { apiService } from "@/service/api";
import { formatFileSize } from "@/lib/utils";

interface VideoUploadProps {
  onUploadComplete: (videoId: string) => void;
}

export function VideoUploadComponent({ onUploadComplete }: VideoUploadProps) {
  const [uploads, setUploads] = useState<VideoUpload[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [isConnected, setIsConnected] = useState<boolean | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiService.testConnection().then(setIsConnected);
  }, []);

  const handleFiles = (files: FileList) => {
    const videoFiles = Array.from(files).filter((file) =>
      file.type.startsWith("video/"),
    );

    if (videoFiles.length === 0) {
      alert("Please select valid video files (MP4, MOV, AVI)");
      return;
    }

    // Check file size (5GB limit)
    const oversizedFiles = videoFiles.filter(
      (file) => file.size > 5 * 1024 * 1024 * 1024,
    );
    if (oversizedFiles.length > 0) {
      alert(
        `Some files are too large. Maximum size is 5GB.\nOversized files: ${oversizedFiles
          .map((f) => f.name)
          .join(", ")}`,
      );
      return;
    }

    const newUploads: VideoUpload[] = videoFiles.map((file) => ({
      file,
      progress: 0,
      status: VideoStatus.UPLOADING,
      error: undefined,
    }));

    setUploads((prev) => [...prev, ...newUploads]);

    // Start uploads
    newUploads.forEach((upload, index) => {
      startUpload(upload, uploads.length + index);
    });
  };

  const startUpload = async (upload: VideoUpload, index: number) => {
    try {
      console.log(`🚀 Starting upload for: ${upload.file.name}`);

      // Step 1: Generate presigned URL
      setUploads((prev) =>
        prev.map((u, i) =>
          i === index
            ? { ...u, status: VideoStatus.UPLOADING, progress: 5 }
            : u,
        ),
      );

      const { presignedUrl, videoId } = await apiService.generatePresignedUrl(
        upload.file.name,
        upload.file.type,
        upload.file.size,
      );

      console.log(`✅ Generated presigned URL for: ${videoId}`);

      // Update with videoId
      setUploads((prev) =>
        prev.map((u, i) => (i === index ? { ...u, videoId, progress: 10 } : u)),
      );

      // Step 2: Upload to S3
      console.log(`📤 Uploading to S3: ${upload.file.name}`);

      const uploadStartTime = Date.now();
      await apiService.uploadToS3(
        presignedUrl,
        upload.file,
        (loaded, total) => {
          const pct = (loaded / total) * 100;
          const elapsed = (Date.now() - uploadStartTime) / 1000; // seconds
          const speed = elapsed > 0 ? loaded / elapsed : 0; // bytes/s
          setUploads((prev) =>
            prev.map((u, i) =>
              i === index
                ? {
                    ...u,
                    progress: 10 + pct * 0.8,
                    bytesUploaded: loaded,
                    uploadSpeed: speed,
                  }
                : u,
            ),
          );
        },
      );

      console.log(`✅ S3 upload completed: ${videoId}`);

      // Step 3: Confirm upload with backend (🔥 THIS WAS MISSING!)
      setUploads((prev) =>
        prev.map((u, i) => (i === index ? { ...u, progress: 95 } : u)),
      );

      await apiService.confirmUpload(videoId);

      console.log(`✅ Upload confirmed with backend: ${videoId}`);

      // Step 4: Mark as complete
      setUploads((prev) =>
        prev.map((u, i) =>
          i === index
            ? {
                ...u,
                status: VideoStatus.UPLOADED,
                progress: 100,
              }
            : u,
        ),
      );

      console.log(`🎉 Upload process completed: ${videoId}`);
      onUploadComplete(videoId);
    } catch (error) {
      console.error("❌ Upload failed:", error);

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      setUploads((prev) =>
        prev.map((u, i) =>
          i === index
            ? {
                ...u,
                status: VideoStatus.ERROR,
                progress: 0,
                error: errorMessage,
              }
            : u,
        ),
      );
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const removeUpload = (index: number) => {
    setUploads((prev) => prev.filter((_, i) => i !== index));
  };

  const retryUpload = (index: number) => {
    const upload = uploads[index];
    if (upload) {
      setUploads((prev) =>
        prev.map((u, i) =>
          i === index
            ? {
                ...u,
                status: VideoStatus.UPLOADING,
                progress: 0,
                error: undefined,
              }
            : u,
        ),
      );
      startUpload(upload, index);
    }
  };

  const getStatusColor = (status: VideoStatus) => {
    switch (status) {
      case VideoStatus.UPLOADING:
        return "bg-blue-500";
      case VideoStatus.UPLOADED:
        return "bg-green-500";
      case VideoStatus.ERROR:
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  };

  const getStatusIcon = (status: VideoStatus) => {
    switch (status) {
      case VideoStatus.UPLOADING:
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case VideoStatus.UPLOADED:
        return <Check className="h-3 w-3" />;
      case VideoStatus.ERROR:
        return <AlertCircle className="h-3 w-3" />;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Upload Videos</span>
          <div className="flex items-center gap-2">
            {isConnected === null && (
              <Badge variant="secondary">
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
                Checking...
              </Badge>
            )}
            {isConnected === true && (
              <Badge
                variant="secondary"
                className="bg-green-100 text-green-800"
              >
                <Check className="h-3 w-3 mr-1" />
                Connected
              </Badge>
            )}
            {isConnected === false && (
              <Badge variant="destructive">
                <AlertCircle className="h-3 w-3 mr-1" />
                Disconnected
              </Badge>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection Warning */}
        {isConnected === false && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Cannot connect to backend server. Please check if the server is
              running on {apiService.getApiBaseUrl()}
            </AlertDescription>
          </Alert>
        )}

        {/* Upload Area */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
            dragActive
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/25 hover:border-primary/50"
          } ${isConnected === false ? "opacity-50 pointer-events-none" : ""}`}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <div className="space-y-2">
            <p className="text-lg font-medium">Drop video files here</p>
            <p className="text-sm text-muted-foreground">
              or click to browse (MP4, MOV, AVI supported, max 5GB each)
            </p>
          </div>
          <Button
            className="mt-4"
            onClick={() => fileInputRef.current?.click()}
            disabled={isConnected === false}
          >
            Select Files
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="video/*"
            multiple
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
          />
        </div>

        {/* Upload List */}
        {uploads.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-medium">Uploads ({uploads.length})</h3>
            {uploads.map((upload, index) => (
              <div key={index} className="border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{upload.file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(upload.file.size)}
                      {upload.videoId && (
                        <span className="ml-2 text-xs text-blue-600">
                          ID: {upload.videoId.slice(0, 8)}...
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      className={`${getStatusColor(upload.status)} text-white`}
                    >
                      <div className="flex items-center gap-1">
                        {getStatusIcon(upload.status)}
                        {upload.status}
                      </div>
                    </Badge>

                    {upload.status === VideoStatus.ERROR && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => retryUpload(index)}
                      >
                        Retry
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => removeUpload(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <Progress value={upload.progress} className="h-2" />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{Math.round(upload.progress)}% complete</span>
                    {upload.status === VideoStatus.UPLOADING &&
                      upload.progress > 10 && (
                        <span className="tabular-nums">
                          {upload.bytesUploaded !== undefined
                            ? `${formatFileSize(upload.bytesUploaded)} / ${formatFileSize(upload.file.size)}`
                            : "Uploading to S3..."}
                          {upload.uploadSpeed !== undefined &&
                            upload.uploadSpeed > 0 && (
                              <span className="ml-2 text-blue-500">
                                {formatFileSize(upload.uploadSpeed)}/s
                              </span>
                            )}
                        </span>
                      )}
                    {upload.status === VideoStatus.UPLOADING &&
                      upload.progress <= 10 && <span>Preparing...</span>}
                  </div>
                </div>

                {/* Error Message */}

                {upload.error && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription className="text-sm">
                      {upload.error}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Upload Summary */}
        {uploads.length > 0 && (
          <div className="text-sm text-muted-foreground border-t pt-3">
            <div className="flex justify-between">
              <span>
                Total: {uploads.length} file{uploads.length !== 1 ? "s" : ""}
              </span>
              <span>
                Completed:{" "}
                {
                  uploads.filter((u) => u.status === VideoStatus.UPLOADED)
                    .length
                }{" "}
                | Failed:{" "}
                {uploads.filter((u) => u.status === VideoStatus.ERROR).length}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
