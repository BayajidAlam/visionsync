import { Request, Response, NextFunction, RequestHandler } from "express";
import { redisClient } from "../config/redis.js";
import { config } from "../config/env.js";
import {
  RateLimitConfig,
  getRateLimitConfig,
  RateLimitingStrategies,
  getStrategyForEndpoint,
} from "../config/rateLimitConfig.js";

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  onLimitReached?: (req: Request, res: Response) => void;
  message?: any;
  headers?: boolean;
  strategy?: keyof typeof RateLimitingStrategies;
  endpointType?: keyof typeof RateLimitConfig;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  totalHits: number;
}

/**
 * Custom Redis-based Rate Limiter for Video Streaming Application
 * Optimized for different endpoint types with intelligent fallback
 */
export class CustomRateLimiter {
  private useRedis: boolean;
  private memoryStore: Map<string, { count: number; resetTime: number }> =
    new Map();

  constructor() {
    this.useRedis = config.RATE_LIMIT_STORE === "redis" && redisClient?.isOpen;
    console.log(
      `🔒 Rate Limiter initialized with ${
        this.useRedis ? "Redis" : "Memory"
      } store`
    );
  }

  /**
   * Generate rate limit key based on IP and endpoint type
   */
  private generateKey(req: Request, prefix: string): string {
    const ip = this.getClientIP(req);
    return `rate_limit:${prefix}:${ip}`;
  }

  /**
   * Extract client IP address with proper proxy support
   */
  public getClientIP(req: Request): string {
    return (
      (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
      (req.headers["x-real-ip"] as string) ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      "unknown"
    );
  }

  /**
   * Redis-based rate limiting implementation
   */
  private async redisRateLimit(
    key: string,
    options: RateLimitOptions
  ): Promise<RateLimitResult> {
    try {
      const pipeline = redisClient.multi();
      const windowSeconds = Math.ceil(options.windowMs / 1000);

      // Use sliding window with Redis sorted sets for more accurate rate limiting
      const now = Date.now();
      const windowStart = now - options.windowMs;

      // Remove old entries
      pipeline.zRemRangeByScore(key, 0, windowStart);
      // Add current request
      pipeline.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
      // Count requests in window
      pipeline.zCard(key);
      // Set expiration
      pipeline.expire(key, windowSeconds);

      const results = await pipeline.exec();
      let totalHits = 0;

      if (
        results &&
        results[2] &&
        Array.isArray(results[2]) &&
        results[2][1] !== null
      ) {
        totalHits = Number(results[2][1]) || 0;
      }

      const allowed = totalHits <= options.maxRequests;
      const remaining = Math.max(0, options.maxRequests - totalHits);
      const resetTime = new Date(now + options.windowMs);

      return {
        allowed,
        remaining,
        resetTime,
        totalHits,
      };
    } catch (error) {
      console.error("Redis rate limit error:", error);
      // Fallback to memory store
      return this.memoryRateLimit(key, options);
    }
  }

  /**
   * Memory-based rate limiting fallback
   */
  private memoryRateLimit(
    key: string,
    options: RateLimitOptions
  ): RateLimitResult {
    const now = Date.now();
    const record = this.memoryStore.get(key);

    if (!record || now > record.resetTime) {
      // Create new window
      const resetTime = new Date(now + options.windowMs);
      this.memoryStore.set(key, { count: 1, resetTime: resetTime.getTime() });

      return {
        allowed: true,
        remaining: options.maxRequests - 1,
        resetTime,
        totalHits: 1,
      };
    }

    // Increment existing window
    record.count += 1;
    const allowed = record.count <= options.maxRequests;
    const remaining = Math.max(0, options.maxRequests - record.count);

    return {
      allowed,
      remaining,
      resetTime: new Date(record.resetTime),
      totalHits: record.count,
    };
  }

  /**
   * Apply rate limiting to request
   */
  async applyRateLimit(
    req: Request,
    res: Response,
    options: RateLimitOptions
  ): Promise<RateLimitResult> {
    const key = options.keyGenerator
      ? options.keyGenerator(req)
      : this.generateKey(req, "default");

    const result = this.useRedis
      ? await this.redisRateLimit(key, options)
      : this.memoryRateLimit(key, options);

    // Add headers if enabled
    if (options.headers !== false) {
      res.set({
        "X-RateLimit-Limit": options.maxRequests.toString(),
        "X-RateLimit-Remaining": result.remaining.toString(),
        "X-RateLimit-Reset": result.resetTime.getTime().toString(),
        "X-RateLimit-Store": this.useRedis ? "redis" : "memory",
      });
    }

    return result;
  }

  /**
   * Create middleware function
   */
  createMiddleware(options: RateLimitOptions): RequestHandler {
    return async (
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void> => {
      try {
        const result = await this.applyRateLimit(req, res, options);

        if (!result.allowed) {
          if (options.onLimitReached) {
            options.onLimitReached(req, res);
            return;
          }

          res.status(429).json(
            options.message || {
              error: "Too many requests",
              message: "Rate limit exceeded. Please try again later.",
              retryAfter: Math.ceil(
                (result.resetTime.getTime() - Date.now()) / 1000
              ),
              limit: options.maxRequests,
              remaining: result.remaining,
              resetTime: result.resetTime.toISOString(),
            }
          );
          return;
        }

        next();
      } catch (error) {
        console.error("Rate limiting error:", error);
        // On error, allow the request to proceed
        next();
      }
    };
  }
}

// Singleton instance
export const rateLimiter = new CustomRateLimiter();

/**
 * Pre-configured rate limiters for different endpoint types
 */
export const RateLimiters = {
  // General API endpoints
  general: rateLimiter.createMiddleware({
    ...getRateLimitConfig("general", config.NODE_ENV),
    message: {
      error: "Too many requests",
      message: "General API rate limit exceeded",
      type: "general_api_limit",
    },
  }),

  // Video upload endpoints - more restrictive
  upload: rateLimiter.createMiddleware({
    ...getRateLimitConfig("upload", config.NODE_ENV),
    keyGenerator: (req) => `upload:${rateLimiter.getClientIP(req)}`,
    message: {
      error: "Upload limit exceeded",
      message: "Too many video uploads. Please wait before uploading again.",
      type: "upload_limit",
      suggestion: "Consider uploading multiple videos in a single session",
    },
  }),

  // Video streaming endpoints - high volume, short window
  streaming: rateLimiter.createMiddleware({
    ...getRateLimitConfig("streaming", config.NODE_ENV),
    keyGenerator: (req) => `stream:${rateLimiter.getClientIP(req)}`,
    skipSuccessfulRequests: false,
    message: {
      error: "Streaming limit exceeded",
      message:
        "Too many streaming requests. Please reduce playback quality or pause briefly.",
      type: "streaming_limit",
    },
  }),

  // Video processing status checks
  status: rateLimiter.createMiddleware({
    ...getRateLimitConfig("status", config.NODE_ENV),
    keyGenerator: (req) => `status:${rateLimiter.getClientIP(req)}`,
    message: {
      error: "Status check limit exceeded",
      message: "Too many status checks. Please reduce polling frequency.",
      type: "status_limit",
    },
  }),

  // Video search and listing
  search: rateLimiter.createMiddleware({
    ...getRateLimitConfig("search", config.NODE_ENV),
    keyGenerator: (req) => `search:${rateLimiter.getClientIP(req)}`,
    message: {
      error: "Search limit exceeded",
      message: "Too many search requests. Please wait before searching again.",
      type: "search_limit",
    },
  }),

  // Authentication endpoints
  auth: rateLimiter.createMiddleware({
    ...getRateLimitConfig("auth", config.NODE_ENV),
    keyGenerator: (req) => `auth:${rateLimiter.getClientIP(req)}`,
    message: {
      error: "Authentication limit exceeded",
      message:
        "Too many authentication attempts. Please wait before trying again.",
      type: "auth_limit",
    },
  }),

  // Webhook endpoints - external services
  webhook: rateLimiter.createMiddleware({
    ...getRateLimitConfig("webhook", config.NODE_ENV),
    keyGenerator: (req) => `webhook:${rateLimiter.getClientIP(req)}`,
    message: {
      error: "Webhook limit exceeded",
      message: "Too many webhook requests.",
      type: "webhook_limit",
    },
  }),

  // Admin endpoints - very restrictive
  admin: rateLimiter.createMiddleware({
    ...getRateLimitConfig("admin", config.NODE_ENV),
    keyGenerator: (req) => `admin:${rateLimiter.getClientIP(req)}`,
    message: {
      error: "Admin limit exceeded",
      message:
        "Too many admin requests. Please wait before performing admin actions.",
      type: "admin_limit",
    },
  }),
};

/**
 * User-based rate limiting (requires authentication)
 */
export const createUserRateLimit = (
  userId: string,
  options: RateLimitOptions
) => {
  return rateLimiter.createMiddleware({
    ...options,
    keyGenerator: () => `user:${userId}:${options.keyGenerator || "default"}`,
  });
};

/**
 * Dynamic rate limiting based on video size/quality
 */
export const createVideoSizeBasedLimit = (baseOptions: RateLimitOptions) => {
  return rateLimiter.createMiddleware({
    ...baseOptions,
    keyGenerator: (req) => {
      const fileSize = parseInt(req.headers["content-length"] || "0");
      const sizeCategory = fileSize > 100 * 1024 * 1024 ? "large" : "small"; // 100MB threshold
      return `video_size:${sizeCategory}:${rateLimiter.getClientIP(req)}`;
    },
  });
};
