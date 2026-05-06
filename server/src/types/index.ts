export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly isOperational = true,
  ) {
    super(message);
    this.name = 'ApiError';
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message: string): ApiError {
    return new ApiError(400, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, message);
  }

  static internal(message: string): ApiError {
    return new ApiError(500, message, false);
  }
}

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