export interface Video {
  id: string
  title: string
  description?: string
  filename: string
  fileSize: number
  duration?: number
  status: VideoStatus
  thumbnailUrl?: string
  videoUrl?: string
  manifestUrl?: string
  createdAt: string
  updatedAt: string
}

export enum VideoStatus {
  UPLOADING = 'uploading',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error'
}

export interface UploadResponse {
  presignedUrl: string
  videoId: string
}

export interface ApiResponse<T> {
  data: T
  message?: string
  error?: string
}

export interface CreateVideoRequest {
  fileName: string
  fileType: string
  fileSize: number
}

export interface UpdateVideoRequest {
  title?: string
  description?: string
}