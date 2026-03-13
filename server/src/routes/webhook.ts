// server/src/routes/webhook.ts - Updated with Socket.IO
import express from "express";
import { videoService } from "../services/videoService.js";
import { socketService } from "../socket/socketService.js";
import { VideoStatus } from "../types/index.js";
import { saveNotification } from "../services/notificationService.js";

const router = express.Router();

// Webhook for video processing completion
router.post("/processing-complete", async (req, res) => {
  try {
    const { videoId, status, manifestUrl, error } = req.body;

    if (!videoId || !status) {
      res.status(400).json({
        error: "Missing required fields: videoId, status",
      });
      return;
    }

    console.log(`📥 Webhook received: Video ${videoId} status: ${status}`);

    // Guard: never downgrade a video that is already 'ready' to 'error'.
    // This prevents a duplicate or stale ECS task from clobbering a successful result.
    if (status === "error" || error) {
      const existing = await videoService.getVideoById(videoId);
      if (existing && existing.status === VideoStatus.READY) {
        console.log(
          `⚠️  Ignoring error webhook for ${videoId} — video is already READY`,
        );
        res.json({ message: "Ignored: video already ready" });
        return;
      }
    }

    // Update database
    let updatedVideo;
    if (status === "ready" && manifestUrl) {
      updatedVideo = await videoService.markVideoAsReady(videoId, manifestUrl);

      // ✅ EMIT REAL-TIME UPDATE
      socketService.emitVideoStatus(videoId, "READY", {
        manifestUrl,
        message: "Video processing complete! Ready for streaming.",
      });

      // Persist notification
      await saveNotification(
        videoId,
        "ready",
        "Video is ready to watch",
        "Processing finished. Your video is now available for streaming.",
        "ready",
      );
    } else if (status === "error" || error) {
      updatedVideo = await videoService.updateVideoStatus(
        videoId,
        VideoStatus.ERROR,
      );

      // ❌ EMIT ERROR UPDATE
      socketService.emitVideoStatus(videoId, "ERROR", {
        error: error || "Processing failed",
        message: "Video processing failed. Please try uploading again.",
      });

      // Persist notification
      await saveNotification(
        videoId,
        "error",
        "Processing failed",
        error || "Video processing encountered an error. Please re-upload.",
        "error",
      );
    } else {
      updatedVideo = await videoService.updateVideoStatus(
        videoId,
        status.toUpperCase() as VideoStatus,
      );

      const isProcessing = status.toLowerCase() === "processing";
      // 🔄 EMIT PROCESSING UPDATE
      socketService.emitVideoStatus(videoId, status.toUpperCase(), {
        message: `Video is ${status}`,
      });

      // Persist processing start notification
      if (isProcessing) {
        await saveNotification(
          videoId,
          "processing",
          "Processing started",
          "Your video is being transcoded into multiple quality levels.",
          "processing",
        );
      }
    }

    if (!updatedVideo) {
      res.status(404).json({ error: "Video not found" });
      return;
    }

    console.log(`✅ Video ${videoId} updated and broadcasted`);

    res.json({
      data: updatedVideo,
      message: "Video status updated and broadcasted",
    });
  } catch (error) {
    console.error("Processing webhook error:", error);
    res.status(500).json({ error: "Failed to update video status" });
  }
});

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "vision-sync-server",
    connections: socketService.getConnectionCount(),
  });
});

export default router;
