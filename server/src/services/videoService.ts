import {
  Video,
  VideoStatus,
  CreateVideoRequest,
  UpdateVideoRequest,
} from "../types/index.js";
import { s3Service } from "./s3Service.js";
import { config } from "../config/env.js";
// sqsService import removed — S3 Event Notification handles SQS trigger now
import { IVideo, VideoModel } from "../model/video.js";
import { socketService } from "../socket/socketService.js";
import { cacheService } from "./cacheService.js";

export class VideoService {
  // Convert MongoDB document to API response format
  private mapDocumentToVideo(doc: IVideo): Video {
    return {
      id: doc._id.toString(),
      title: doc.title,
      description: doc.description,
      filename: doc.filename,
      fileSize: doc.fileSize,
      duration: doc.duration,
      status: doc.status,
      thumbnailUrl: doc.thumbnailUrl,
      videoUrl: doc.videoUrl,
      manifestUrl: doc.manifestUrl,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  async createVideo(
    videoId: string,
    request: CreateVideoRequest
  ): Promise<Video> {
    try {
      const video = new VideoModel({
        _id: videoId,
        title: request.fileName,
        filename: request.fileName,
        fileSize: request.fileSize,
        status: VideoStatus.UPLOADING,
      });

      const savedVideo = await video.save();
      const result = this.mapDocumentToVideo(savedVideo);

      // 🔄 EMIT CREATION EVENT
      socketService.emitVideoStatus(videoId, "UPLOADING", {
        filename: request.fileName,
        fileSize: request.fileSize,
        message: "Video upload started",
      });

      return result;
    } catch (error) {
      console.error("Error creating video:", error);
      throw new Error("Failed to create video record");
    }
  }

  async updateVideoStatus(
    id: string,
    status: VideoStatus
  ): Promise<Video | null> {
    try {
      const video = await VideoModel.findByIdAndUpdate(
        id,
        { status },
        { new: true }
      );

      if (!video) return null;

      const result = this.mapDocumentToVideo(video);

      // 🔥 Update caches
      await cacheService.cacheVideo(result);
      await cacheService.cacheVideoStatus(id, status);
      await cacheService.invalidateListCaches(); // Status change affects lists

      // 🔄 EMIT STATUS CHANGE (except for webhook-triggered updates to avoid duplication)
      if (status !== VideoStatus.READY && status !== VideoStatus.ERROR) {
        socketService.emitVideoStatus(id, status, {
          message: `Video status changed to ${status}`,
        });
      }

      return result;
    } catch (error) {
      console.error("Error updating video status:", error);
      throw new Error("Failed to update video status");
    }
  }

  async markVideoAsUploaded(videoId: string): Promise<Video | null> {
    try {
      const video = await this.getVideoById(videoId);
      if (!video) return null;

      // FIX: Only update status to UPLOADED and notify client.
      // The SQS trigger is now handled by S3 Event Notification automatically.
      // Sending to SQS here would cause DOUBLE processing (S3 event + this call).
      // This endpoint is now purely for UI feedback — it shows the user "Upload complete!"
      // while S3 independently fires the event that starts processing.
      const uploadedVideo = await this.updateVideoStatus(videoId, VideoStatus.UPLOADED);

      // 📤 EMIT UPLOAD COMPLETE — informs frontend the file reached S3 successfully
      socketService.emitVideoStatus(videoId, "UPLOADED", {
        message: "Upload complete! Processing will start shortly.",
      });

      return uploadedVideo;
    } catch (error) {
      console.error("Error marking video as uploaded:", error);
      throw new Error("Failed to update upload status");
    }
  }

  async getAllVideos(): Promise<Video[]> {
    try {
      // 🔥 Try cache first
      const cachedVideos = await cacheService.getCachedVideoList();
      if (cachedVideos) {
        return cachedVideos;
      }

      // Cache miss - fetch from database
      const videos = await VideoModel.find().sort({ createdAt: -1 });
      const mappedVideos = videos.map((video) => this.mapDocumentToVideo(video));

      // 🔥 Cache the results
      await cacheService.cacheVideoList(mappedVideos);

      return mappedVideos;
    } catch (error) {
      console.error("Error fetching videos:", error);
      throw new Error("Failed to fetch videos");
    }
  }

  async getVideoById(id: string): Promise<Video | null> {
    try {
      // 🔥 Try cache first
      const cachedVideo = await cacheService.getCachedVideo(id);
      if (cachedVideo) {
        return cachedVideo;
      }

      // Cache miss - fetch from database
      const video = await VideoModel.findById(id);
      if (!video) {
        return null;
      }

      const mappedVideo = this.mapDocumentToVideo(video);

      // 🔥 Cache the result
      await cacheService.cacheVideo(mappedVideo);

      return mappedVideo;
    } catch (error) {
      console.error("Error fetching video:", error);
      throw new Error("Failed to fetch video");
    }
  }

  async updateVideo(
    id: string,
    updates: UpdateVideoRequest
  ): Promise<Video | null> {
    try {
      const video = await VideoModel.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true }
      );

      if (!video) {
        return null;
      }

      const mappedVideo = this.mapDocumentToVideo(video);

      // 🔥 Update cache and invalidate related caches
      await cacheService.cacheVideo(mappedVideo);
      await cacheService.invalidateListCaches();

      return mappedVideo;
    } catch (error) {
      console.error("Error updating video:", error);
      throw new Error("Failed to update video");
    }
  }

  async deleteVideo(id: string): Promise<boolean> {
    try {
      const video = await VideoModel.findById(id);
      if (!video) {
        return false;
      }

      const result = await VideoModel.findByIdAndDelete(id);

      if (result) {
        // 🔥 Invalidate all caches for this video
        await cacheService.invalidateVideo(id);

        // Delete from S3 (async, don't wait)
        s3Service.deleteVideo(id, video.filename).catch((error) => {
          console.error("Error deleting video from S3:", error);
        });
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error deleting video:", error);
      throw new Error("Failed to delete video");
    }
  }

  async markVideoAsReady(
    videoId: string,
    manifestPath: string
  ): Promise<Video | null> {
    try {
      // Build CloudFront URLs
      const cloudfrontBaseUrl = config.CLOUDFRONT_DOMAIN
        ? `https://${config.CLOUDFRONT_DOMAIN}`
        : `https://d-example.cloudfront.net`; // fallback for local dev

      const manifestUrl = `${cloudfrontBaseUrl}/${manifestPath}`;
      const videoUrl = `${cloudfrontBaseUrl}/${videoId}/`;
      const thumbnailUrl = `${cloudfrontBaseUrl}/${videoId}/thumbnail.jpg`;

      // Update video with CloudFront URLs
      const video = await VideoModel.findByIdAndUpdate(
        videoId,
        {
          status: VideoStatus.READY,
          manifestUrl,
          videoUrl,
          thumbnailUrl,
          updatedAt: new Date(),
        },
        { new: true }
      );

      if (!video) return null;

      const result = this.mapDocumentToVideo(video);

      // 🔄 EMIT READY STATUS WITH CLOUDFRONT URLs
      socketService.emitVideoStatus(videoId, "READY", {
        manifestUrl,
        videoUrl,
        thumbnailUrl,
        message: "Video is ready for streaming!",
        streamingUrl: manifestUrl, // Direct link for the player
      });

      console.log(`✅ Video ${videoId} marked as ready with CloudFront URLs`);
      console.log(`   Manifest: ${manifestUrl}`);
      console.log(`   Video: ${videoUrl}`);

      return result;
    } catch (error) {
      console.error("Error marking video as ready:", error);
      throw new Error("Failed to mark video as ready");
    }
  }

  async getSignedStreamingUrl(videoId: string): Promise<string | null> {
    try {
      const video = await this.getVideoById(videoId);
      if (!video || !video.manifestUrl) return null;

      // For now, return the public CloudFront URL
      // Later, you can implement CloudFront signed URLs here
      return video.manifestUrl;
    } catch (error) {
      console.error("Error getting signed URL:", error);
      return null;
    }
  }

  // MongoDB-specific search methods
  async searchVideos(query: string): Promise<Video[]> {
    try {
      // 🔥 Try cache first
      const cachedResults = await cacheService.getCachedSearchResults(query);
      if (cachedResults) {
        return cachedResults;
      }

      // Cache miss - search database
      const videos = await VideoModel.find({
        $or: [
          { title: { $regex: query, $options: "i" } },
          { description: { $regex: query, $options: "i" } },
        ],
      }).sort({ createdAt: -1 });

      const mappedVideos = videos.map((video) => this.mapDocumentToVideo(video));

      // 🔥 Cache search results
      await cacheService.cacheSearchResults(query, mappedVideos);

      return mappedVideos;
    } catch (error) {
      console.error("Error searching videos:", error);
      throw new Error("Failed to search videos");
    }
  }

  async getVideosByStatus(status: VideoStatus): Promise<Video[]> {
    try {
      // 🔥 Try cache first
      const cachedVideos = await cacheService.getCachedVideosByStatus(status);
      if (cachedVideos) {
        return cachedVideos;
      }

      // Cache miss - fetch from database
      const videos = await VideoModel.find({ status }).sort({ createdAt: -1 });
      const mappedVideos = videos.map((video) => this.mapDocumentToVideo(video));

      // 🔥 Cache the results
      await cacheService.cacheVideosByStatus(status, mappedVideos);

      return mappedVideos;
    } catch (error) {
      console.error("Error fetching videos by status:", error);
      throw new Error("Failed to fetch videos by status");
    }
  }

  async getVideoStats(): Promise<{
    total: number;
    byStatus: Record<VideoStatus, number>;
    totalSize: number;
  }> {
    try {
      // 🔥 Try cache first
      const cachedStats = await cacheService.getCachedVideoStats();
      if (cachedStats) {
        return cachedStats;
      }

      // Cache miss - compute stats
      const [total, statusCounts, sizeResult] = await Promise.all([
        VideoModel.countDocuments(),
        VideoModel.aggregate([
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]),
        VideoModel.aggregate([
          { $group: { _id: null, totalSize: { $sum: "$fileSize" } } },
        ]),
      ]);

      const byStatus = Object.values(VideoStatus).reduce((acc, status) => {
        acc[status] = 0;
        return acc;
      }, {} as Record<VideoStatus, number>);

      statusCounts.forEach(({ _id, count }) => {
        byStatus[_id as VideoStatus] = count;
      });

      const stats = {
        total,
        byStatus,
        totalSize: sizeResult[0]?.totalSize || 0,
      };

      // 🔥 Cache the computed stats
      await cacheService.cacheVideoStats(stats);

      return stats;
    } catch (error) {
      console.error("Error getting video stats:", error);
      throw new Error("Failed to get video statistics");
    }
  }
}

export const videoService = new VideoService();
