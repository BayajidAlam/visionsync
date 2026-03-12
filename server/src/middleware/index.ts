import express from "express";
import cors from "cors";
import helmet from "helmet";
import { RateLimiters } from "./rateLimiting.js";
import { config } from "../config/env.js";

// Custom Redis store for rate limiting
export function setupMiddleware(app: express.Application): void {
  // Security headers
  app.use(helmet());

  // CORS
  app.use(
    cors({
      origin: config.FRONTEND_URL,
      credentials: true,
    })
  );

  // Body parsing
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // 🚀 CUSTOM RATE LIMITING SYSTEM - Optimized for Video Streaming
  console.log(
    "� Applying custom rate limiting for video streaming application"
  );

  // General API rate limiter
  app.use("/api/", RateLimiters.general);

  // Video upload endpoints - strict limiting
  app.use("/api/upload/", RateLimiters.upload);
  app.use("/api/videos/upload", RateLimiters.upload);

  // Video streaming endpoints - high volume support
  app.use("/api/videos/:id/segments", RateLimiters.streaming);
  app.use("/api/videos/:id/manifest", RateLimiters.streaming);
  app.use("/api/videos/:id/stream", RateLimiters.streaming);

  // Video processing status checks
  app.use("/api/videos/:id/status", RateLimiters.status);
  app.use("/api/processing/status", RateLimiters.status);

  // Video search and listing
  app.use("/api/videos/search", RateLimiters.search);
  app.use("/api/videos", RateLimiters.search);

  // Authentication endpoints
  app.use("/api/auth/", RateLimiters.auth);
  app.use("/api/login", RateLimiters.auth);
  app.use("/api/register", RateLimiters.auth);

  // Webhook endpoints
  app.use("/api/webhook/", RateLimiters.webhook);

  // Admin endpoints
  app.use("/api/admin/", RateLimiters.admin);

  // Request logging in development
  if (config.NODE_ENV === "development") {
    app.use(
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
        next();
      }
    );
  }
}

// Error handling middleware
export function setupErrorHandling(app: express.Application): void {
  // Health check endpoint
  app.get("/health", (req: express.Request, res: express.Response) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      rateLimiting: {
        store: config.RATE_LIMIT_STORE,
        system: "custom-redis-sliding-window",
        endpoints: {
          general: `${config.RATE_LIMIT_MAX_REQUESTS} req/${config.RATE_LIMIT_WINDOW_MS}ms`,
          upload: "3 req/15min",
          streaming: "300 req/1min",
          search: "30 req/1min",
          auth: "10 req/15min",
          status: "60 req/1min",
          webhook: "100 req/1min",
          admin: "20 req/5min",
        },
        features: [
          "Redis sliding window",
          "Memory fallback",
          "Endpoint-specific limits",
          "Intelligent IP detection",
          "User-based limiting ready",
          "Video size-based limiting",
        ],
      },
    });
  });

  // 404 handler
  app.use("*", (req: express.Request, res: express.Response) => {
    res.status(404).json({
      error: "Route not found",
      message: `Cannot ${req.method} ${req.originalUrl}`,
    });
  });

  // Global error handler
  app.use(
    (
      err: any,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      console.error("Error:", err);

      if (res.headersSent) {
        return next(err);
      }

      const statusCode = err.statusCode || 500;
      const message =
        config.NODE_ENV === "production"
          ? "Internal server error"
          : err.message || "Something went wrong";

      res.status(statusCode).json({
        error: message,
        ...(config.NODE_ENV === "development" && { stack: err.stack }),
      });
    }
  );
}
