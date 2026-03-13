import express from "express";
import { NotificationModel } from "../model/notification.js";

const router = express.Router();

// GET /api/notifications?videoId=xxx[&limit=50]
router.get(
  "/",
  async (req: express.Request, res: express.Response): Promise<void> => {
    try {
      const { videoId, limit = "50" } = req.query;
      const filter: Record<string, string> = {};
      if (videoId && typeof videoId === "string") {
        filter.videoId = videoId;
      }

      const notifications = await NotificationModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(Math.min(Number(limit), 200));

      res.json({ data: notifications });
    } catch (err) {
      console.error("Get notifications error:", err);
      res.status(500).json({ error: "Failed to get notifications" });
    }
  },
);

// GET /api/notifications/:videoId  — chronological timeline for one video
router.get(
  "/:videoId",
  async (req: express.Request, res: express.Response): Promise<void> => {
    try {
      const { videoId } = req.params;
      const notifications = await NotificationModel.find({ videoId }).sort({
        createdAt: 1,
      });

      res.json({ data: notifications });
    } catch (err) {
      console.error("Get video notifications error:", err);
      res.status(500).json({ error: "Failed to get video notifications" });
    }
  },
);

export default router;
