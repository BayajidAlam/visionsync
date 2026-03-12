export interface Video {
  id: string;
  title: string;
  description?: string;
  filename: string;
  fileSize: number;
  duration?: number;
  status: VideoStatus;
  thumbnailUrl?: string;
  videoUrl?: string;
  manifestUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export const VideoStatus = {
  UPLOADING: "uploading",
  UPLOADED: "uploaded",
  PROCESSING: "processing",
  READY: "ready",
  ERROR: "error",
} as const;

export type VideoStatus = (typeof VideoStatus)[keyof typeof VideoStatus];

export interface UploadResponse {
  presignedUrl: string;
  videoId: string;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  error?: string;
}

export interface VideoUpload {
  error: any;
  file: File;
  progress: number;
  status: VideoStatus;
  videoId?: string;
  bytesUploaded?: number;
  uploadSpeed?: number; // bytes per second
}
