import express from "express";
import { videoService } from "../services/videoService.js";
import { socketService } from "../socket/socketService.js";
import { VideoStatus } from "../types/index.js";
import { saveNotification } from "../services/notificationService.js";
import { validateWebhookPayload } from "../middleware/validation.js";
import { logger } from "../config/logger.js";

const router = express.Router();

router.post("/processing-complete", validateWebhookPayload, async (req: express.Request, res: express.Response) => {
  try {
    const { videoId, status, manifestUrl, error } = req.body;

    logger.info("Webhook received", { videoId, status });

    let updatedVideo;

    if (status === "ready" && manifestUrl) {
      updatedVideo = await videoService.markVideoAsReady(videoId, manifestUrl);

      if (!updatedVideo) {
        logger.warn("Ready webhook ignored — video already READY or not found", { videoId });
        res.json({ message: "Ignored: video already ready or not found" });
        return;
      }

      socketService.emitVideoStatus(videoId, "READY", {
        manifestUrl,
        message: "Video processing complete! Ready for streaming.",
      });

      await saveNotification(
        videoId,
        "ready",
        "Video is ready to watch",
        "Processing finished. Your video is now available for streaming.",
        "ready",
      );
    } else if (status === "error" || error) {
      // Atomic update: only sets ERROR if video is NOT already READY.
      // Prevents a duplicate or stale ECS task from clobbering a successful result.
      updatedVideo = await videoService.setVideoError(videoId);

      if (!updatedVideo) {
        logger.warn("Error webhook ignored — video already READY or not found", { videoId });
        res.json({ message: "Ignored: video already ready or not found" });
        return;
      }

      socketService.emitVideoStatus(videoId, "ERROR", {
        error: error || "Processing failed",
        message: "Video processing failed. Please try uploading again.",
      });

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
      // updateVideoStatus already emits the socket event — no duplicate emit here

      if (status.toLowerCase() === "processing") {
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

    logger.info("Video status updated and broadcasted", { videoId, status });

    res.json({
      data: updatedVideo,
      message: "Video status updated and broadcasted",
    });
  } catch (err) {
    logger.error("Processing webhook error", { error: (err as Error).message });
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
