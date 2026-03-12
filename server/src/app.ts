import express from "express";
import { setupMiddleware, setupErrorHandling } from "./middleware/index.js";
import uploadRoutes from "./routes/upload.js";
import videoRoutes from "./routes/video.js";
import webhookRoutes from "./routes/webhook.js";

export function createApp(): express.Application {
  const app = express();

  // Required when running behind a reverse proxy (ALB, nginx).
  // Without this, req.ip is always the proxy's internal IP — breaking IP-based rate limiting.
  app.set("trust proxy", 1);

  // Setup middleware
  setupMiddleware(app);

  // API routes
  app.use("/api/webhook", webhookRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/videos", videoRoutes);

  // Root endpoint
  app.get("/", (req: express.Request, res: express.Response) => {
    res.json({
      message: "VisionSync API Server",
      version: "1.0.0",
      status: "running",
      endpoints: {
        upload: "/api/upload",
        videos: "/api/videos",
        webhook: "/api/webhook",
        health: "/api/webhook/health",
      },
    });
  });

  // Setup error handling
  setupErrorHandling(app);

  return app;
}
