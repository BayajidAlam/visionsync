/**
 * Custom Rate Limiting Usage Examples
 * Video Streaming Application
 */

import express from "express";
import {
  rateLimiter,
  RateLimiters,
  createUserRateLimit,
  createVideoSizeBasedLimit,
} from "../middleware/rateLimiting.js";
import { getRateLimitConfig } from "../config/rateLimitConfig.js";
import { config } from "../config/env.js";

const app = express();

// ============================================
// 1. BASIC USAGE - Apply to all routes
// ============================================

// Apply general rate limiting to all API routes
app.use("/api", RateLimiters.general);

// ============================================
// 2. ENDPOINT-SPECIFIC RATE LIMITING
// ============================================

// Video upload with size-based limiting
app.post(
  "/api/videos/upload",
  createVideoSizeBasedLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 3, // 3 uploads per 15 minutes
  }),
  (req, res) => {
    // Upload logic here
    res.json({ message: "Upload started" });
  }
);

// Video streaming endpoints
app.get(
  "/api/videos/:id/segments/:segment",
  RateLimiters.streaming,
  (req, res) => {
    // Serve video segment
    res.json({ segment: req.params.segment });
  }
);

// Video search with custom configuration
app.get(
  "/api/videos/search",
  rateLimiter.createMiddleware({
    ...getRateLimitConfig("search", config.NODE_ENV),
    keyGenerator: (req) => {
      // Custom key generation including search query
      const query = (req.query.q as string) || "default";
      const ip = req.ip;
      return `search:${ip}:${query.slice(0, 20)}`;
    },
    message: {
      error: "Search limit exceeded",
      message: "Too many search requests for this query",
      hint: "Try a different search term or wait a moment",
    },
  }),
  (req, res) => {
    // Search logic here
    res.json({ results: [] });
  }
);

// ============================================
// 3. USER-BASED RATE LIMITING
// ============================================

// Authenticated routes with user-specific limits
app.post(
  "/api/videos/premium-upload",
  // Middleware to extract user ID (implement according to your auth system)
  (req, res, next) => {
    // Example: req.user = { id: 'user123', type: 'premium' };
    next();
  },
  // User-specific rate limiting
  (req, res, next) => {
    const userId = (req as any).user?.id;
    const userType = (req as any).user?.type || "free";

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const userRateLimit = createUserRateLimit(userId, {
      ...getRateLimitConfig("upload", config.NODE_ENV, userType),
      keyGenerator: () => `user_upload:${userId}`,
    });

    userRateLimit(req, res, next);
  },
  (req, res) => {
    res.json({ message: "Premium upload started" });
  }
);

// ============================================
// 4. DYNAMIC RATE LIMITING
// ============================================

// Rate limiting based on video quality/size
app.get(
  "/api/videos/:id/stream",
  (req, res, next) => {
    const quality = req.query.quality as string;
    let limits;

    switch (quality) {
      case "4k":
        limits = { windowMs: 1 * 60 * 1000, maxRequests: 50 }; // More restrictive for 4K
        break;
      case "1080p":
        limits = { windowMs: 1 * 60 * 1000, maxRequests: 100 };
        break;
      case "720p":
      default:
        limits = { windowMs: 1 * 60 * 1000, maxRequests: 200 };
        break;
    }

    const qualityRateLimit = rateLimiter.createMiddleware({
      ...limits,
      keyGenerator: (req) => `stream_quality:${quality}:${req.ip}`,
      message: {
        error: "Streaming limit exceeded",
        message: `Too many ${quality} streaming requests`,
        suggestion: "Try a lower quality setting",
      },
    });

    qualityRateLimit(req, res, next);
  },
  (req, res) => {
    res.json({ streamUrl: `/streams/${req.params.id}` });
  }
);

// ============================================
// 5. COMBINED RATE LIMITING
// ============================================

// Multiple rate limiters for sensitive operations
app.delete(
  "/api/videos/:id",
  RateLimiters.auth, // Authentication rate limit
  rateLimiter.createMiddleware({
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 5, // Only 5 deletions per 5 minutes
    keyGenerator: (req) => `delete_video:${req.ip}`,
    message: {
      error: "Delete limit exceeded",
      message:
        "Too many video deletions. Please wait before deleting more videos.",
    },
  }),
  (req, res) => {
    // Delete logic here
    res.json({ message: "Video deleted" });
  }
);

// ============================================
// 6. RATE LIMITING WITH CUSTOM LOGIC
// ============================================

// Rate limiting with custom business logic
app.post(
  "/api/videos/bulk-upload",
  (req, res, next) => {
    const videoCount = req.body.videos?.length || 0;

    // Dynamic rate limiting based on bulk upload size
    const bulkRateLimit = rateLimiter.createMiddleware({
      windowMs: 30 * 60 * 1000, // 30 minutes
      maxRequests: Math.max(1, Math.floor(10 / videoCount)), // Fewer requests for larger bulks
      keyGenerator: (req) => `bulk_upload:${videoCount}:${req.ip}`,
      message: {
        error: "Bulk upload limit exceeded",
        message: `Too many bulk uploads with ${videoCount} videos`,
        suggestion: "Try uploading fewer videos at once",
      },
      onLimitReached: (req, res) => {
        // Custom logic when limit is reached
        console.log(
          `Bulk upload limit reached for IP: ${req.ip}, videos: ${videoCount}`
        );
      },
    });

    bulkRateLimit(req, res, next);
  },
  (req, res) => {
    res.json({ message: "Bulk upload started" });
  }
);

// ============================================
// 7. RATE LIMITING BYPASS FOR INTERNAL SERVICES
// ============================================

// Bypass rate limiting for internal services
app.use("/api/internal", (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  const internalKey = process.env.INTERNAL_API_KEY;

  if (apiKey === internalKey) {
    // Skip rate limiting for internal services
    next();
  } else {
    // Apply standard rate limiting
    RateLimiters.general(req, res, next);
  }
});

// ============================================
// 8. MONITORING AND ANALYTICS
// ============================================

// Rate limiting status endpoint
app.get("/api/rate-limit/status", (req, res) => {
  res.json({
    message: "Rate limiting is active",
    store: config.RATE_LIMIT_STORE,
    endpoints: {
      general: "100 req/15min",
      upload: "3 req/15min",
      streaming: "300 req/1min",
      search: "30 req/1min",
      auth: "10 req/15min",
      status: "60 req/1min",
      webhook: "100 req/1min",
      admin: "20 req/5min",
    },
    tips: [
      "Premium users get higher limits",
      "Rate limits are per IP address",
      "Use efficient polling for status checks",
      "Consider video quality for streaming",
    ],
  });
});

export default app;

// ============================================
// 9. USAGE PATTERNS & BEST PRACTICES
// ============================================

/**
 * BEST PRACTICES:
 *
 * 1. Apply general rate limiting to all API routes
 * 2. Use endpoint-specific limits for different operations
 * 3. Implement user-based limiting for authenticated routes
 * 4. Use dynamic limiting based on content (video quality, size)
 * 5. Combine multiple rate limiters for sensitive operations
 * 6. Provide helpful error messages with suggestions
 * 7. Monitor rate limiting effectiveness and adjust as needed
 * 8. Use Redis for production, memory for development
 * 9. Implement bypass mechanisms for internal services
 * 10. Consider premium user benefits and adjust limits accordingly
 *
 * MONITORING:
 *
 * - Track rate limit hits by endpoint
 * - Monitor Redis performance and memory usage
 * - Analyze user behavior patterns
 * - Adjust limits based on infrastructure capacity
 * - Set up alerts for unusual traffic patterns
 *
 * SCALING CONSIDERATIONS:
 *
 * - Use Redis Cluster for high-availability setups
 * - Implement distributed rate limiting for multi-region deployments
 * - Consider rate limiting at the CDN/load balancer level
 * - Use connection pooling for Redis clients
 * - Implement graceful degradation when Redis is unavailable
 */
