import type {
  ApiResponse,
  DBNotification,
  UploadResponse,
  Video,
  VideoStatus,
} from "../types";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";
const CLOUDFRONT_URL = import.meta.env.VITE_CLOUDFRONT_URL || "";

export class ApiService {
  private baseUrl: string;
  private cloudfrontUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
    this.cloudfrontUrl = CLOUDFRONT_URL;

  }
  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `API Error: ${response.status} ${response.statusText}`;

      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error || errorMessage;
      } catch {
        // Use default error message if response isn't JSON
      }

      throw new Error(errorMessage);
    }

    return response.json();
  }

  // Generate presigned URL for upload
  async generatePresignedUrl(
    fileName: string,
    fileType: string,
    fileSize?: number,
  ): Promise<UploadResponse> {
    const response = await this.fetch<{ data: UploadResponse }>(
      "/api/upload/generate-presigned-url",
      {
        method: "POST",
        body: JSON.stringify({
          fileName,
          fileType,
          fileSize: fileSize || 0,
        }),
      },
    );

    return response.data;
  }

  // 🔥 NEW: Upload confirmation
  async confirmUpload(videoId: string): Promise<ApiResponse<Video>> {
    return this.fetch<ApiResponse<Video>>(`/api/upload/confirm/${videoId}`, {
      method: "POST",
    });
  }

  // Upload file to S3
  async uploadToS3(
    url: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(e.loaded, e.total);
        }
      });

      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      });

      xhr.addEventListener("error", () => {
        reject(new Error("Upload failed"));
      });

      xhr.addEventListener("timeout", () => {
        reject(new Error("Upload failed: Timeout"));
      });

      xhr.open("PUT", url);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.timeout = 300000; // 5 minutes timeout
      xhr.send(file);
    });
  }

  // 🔥 VIDEO APIS
  async getAllVideos(): Promise<ApiResponse<Video[]>> {
    return this.fetch<ApiResponse<Video[]>>("/api/videos");
  }

  async getVideo(id: string): Promise<ApiResponse<Video>> {
    return this.fetch<ApiResponse<Video>>(`/api/videos/${id}`);
  }

  async getVideoStatus(
    id: string,
  ): Promise<ApiResponse<{ status: VideoStatus }>> {
    return this.fetch<ApiResponse<{ status: VideoStatus }>>(
      `/api/videos/${id}/status`,
    );
  }

  // 🔥 NEW: Search videos
  async searchVideos(query: string): Promise<ApiResponse<Video[]>> {
    return this.fetch<ApiResponse<Video[]>>(
      `/api/videos/search?q=${encodeURIComponent(query)}`,
    );
  }

  // 🔥 NEW: Get video statistics
  async getVideoStats(): Promise<ApiResponse<any>> {
    return this.fetch<ApiResponse<any>>("/api/videos/stats/overview");
  }

  // 🔥 NEW: Get videos by status
  async getVideosByStatus(status: VideoStatus): Promise<ApiResponse<Video[]>> {
    return this.fetch<ApiResponse<Video[]>>(`/api/videos/status/${status}`);
  }

  async updateVideo(
    id: string,
    data: Partial<Pick<Video, "title" | "description">>,
  ): Promise<ApiResponse<Video>> {
    return this.fetch<ApiResponse<Video>>(`/api/videos/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  async deleteVideo(id: string): Promise<ApiResponse<void>> {
    return this.fetch<ApiResponse<void>>(`/api/videos/${id}`, {
      method: "DELETE",
    });
  }

  // 🔥 STREAMING APIS
  getManifestUrl(videoId: string): string {
    if (this.cloudfrontUrl) {
      return `${this.cloudfrontUrl}/${videoId}/manifest.mpd`;
    } else {
      return `${this.baseUrl}/api/videos/${videoId}/manifest`;
    }
  }

  getThumbnailUrl(videoId: string): string {
    if (this.cloudfrontUrl) {
      return `${this.cloudfrontUrl}/${videoId}/thumbnail.jpg`;
    }
    return `${this.baseUrl}/api/videos/${videoId}/thumbnail`;
  }

  getSegmentUrl(videoId: string, segment: string): string {
    if (this.cloudfrontUrl) {
      return `${this.cloudfrontUrl}/${videoId}/${segment}`;
    }
    return `${this.baseUrl}/api/videos/${videoId}/segments/${segment}`;
  }

  // 🔥 NEW: Health check
  async checkHealth(): Promise<any> {
    return this.fetch<any>("/health");
  }

  // 🔥 NEW: Webhook health
  async checkWebhookHealth(): Promise<any> {
    return this.fetch<any>("/api/webhook/health");
  }

  // Notifications — DB-persisted lifecycle events
  async fetchNotifications(
    videoId?: string,
    limit = 50,
  ): Promise<DBNotification[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (videoId) params.set("videoId", videoId);
    const res = await this.fetch<{ data: DBNotification[] }>(
      `/api/notifications?${params}`,
    );
    return res.data;
  }

  async fetchVideoTimeline(videoId: string): Promise<DBNotification[]> {
    const res = await this.fetch<{ data: DBNotification[] }>(
      `/api/notifications/${encodeURIComponent(videoId)}`,
    );
    return res.data;
  }

  // 🔥 UTILITY METHODS
  getApiBaseUrl(): string {
    return this.baseUrl;
  }

  getCloudfrontUrl(): string {
    return this.cloudfrontUrl;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.checkHealth();
      return true;
    } catch {
      return false;
    }
  }
}

export const apiService = new ApiService();
