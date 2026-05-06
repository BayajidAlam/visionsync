import { Request, Response, NextFunction, RequestHandler } from "express";
import { redisClient } from "../config/redis.js";
import { config } from "../config/env.js";
import { logger } from "../config/logger.js";
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
  onLimitReached?: (req: Request, res: Response) => void;
  message?: Record<string, unknown>;
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

export class CustomRateLimiter {
  // Memory store for fallback — periodically purged to prevent leak
  private memoryStore: Map<string, { count: number; resetTime: number }> = new Map();
  private memoryPurgeInterval: NodeJS.Timeout;

  constructor() {
    // Purge expired memory-store entries every 5 minutes
    this.memoryPurgeInterval = setInterval(() => this.purgeMemoryStore(), 5 * 60 * 1000);
  }

  private get useRedis(): boolean {
    return config.RATE_LIMIT_STORE === "redis" && redisClient.isOpen;
  }

  private purgeMemoryStore(): void {
    const now = Date.now();
    for (const [key, record] of this.memoryStore.entries()) {
      if (now > record.resetTime) this.memoryStore.delete(key);
    }
  }

  public getClientIP(req: Request): string {
    if (config.TRUST_PROXY) {
      const forwarded = req.headers["x-forwarded-for"];
      if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
      const realIp = req.headers["x-real-ip"];
      if (typeof realIp === "string") return realIp;
    }
    return req.socket.remoteAddress || "unknown";
  }

  private generateKey(req: Request, prefix: string): string {
    return `rate_limit:${prefix}:${this.getClientIP(req)}`;
  }

  private async redisRateLimit(
    key: string,
    options: RateLimitOptions,
  ): Promise<RateLimitResult> {
    try {
      const now = Date.now();
      const windowStart = now - options.windowMs;
      const windowSeconds = Math.ceil(options.windowMs / 1000);

      const pipeline = redisClient.multi();
      pipeline.zRemRangeByScore(key, 0, windowStart);
      pipeline.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
      pipeline.zCard(key);
      pipeline.expire(key, windowSeconds);

      const results = await pipeline.exec();

      // node-redis v4: exec() returns raw values per command, NOT [err, value] tuples
      // results[2] is the zCard result — a number directly
      const totalHits = typeof results[2] === "number" ? results[2] : 0;

      const allowed = totalHits <= options.maxRequests;
      const remaining = Math.max(0, options.maxRequests - totalHits);
      const resetTime = new Date(now + options.windowMs);

      return { allowed, remaining, resetTime, totalHits };
    } catch (error) {
      logger.error("Redis rate limit error — falling back to memory", {
        key,
        error: (error as Error).message,
      });
      return this.memoryRateLimit(key, options);
    }
  }

  private memoryRateLimit(
    key: string,
    options: RateLimitOptions,
  ): RateLimitResult {
    const now = Date.now();
    const record = this.memoryStore.get(key);

    if (!record || now > record.resetTime) {
      const resetTime = new Date(now + options.windowMs);
      this.memoryStore.set(key, { count: 1, resetTime: resetTime.getTime() });
      return { allowed: true, remaining: options.maxRequests - 1, resetTime, totalHits: 1 };
    }

    record.count += 1;
    const allowed = record.count <= options.maxRequests;
    const remaining = Math.max(0, options.maxRequests - record.count);
    return { allowed, remaining, resetTime: new Date(record.resetTime), totalHits: record.count };
  }

  async applyRateLimit(
    req: Request,
    res: Response,
    options: RateLimitOptions,
  ): Promise<RateLimitResult> {
    const key = options.keyGenerator
      ? options.keyGenerator(req)
      : this.generateKey(req, "default");

    const result = this.useRedis
      ? await this.redisRateLimit(key, options)
      : this.memoryRateLimit(key, options);

    if (options.headers !== false) {
      const retryAfterSecs = Math.ceil((result.resetTime.getTime() - Date.now()) / 1000);
      res.set({
        "X-RateLimit-Limit": String(options.maxRequests),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(result.resetTime.getTime()),
        "X-RateLimit-Store": this.useRedis ? "redis" : "memory",
        ...(result.allowed ? {} : { "Retry-After": String(retryAfterSecs) }),
      });
    }

    return result;
  }

  createMiddleware(options: RateLimitOptions): RequestHandler {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const result = await this.applyRateLimit(req, res, options);

        if (!result.allowed) {
          if (options.onLimitReached) {
            options.onLimitReached(req, res);
            return;
          }

          const retryAfterSecs = Math.ceil(
            (result.resetTime.getTime() - Date.now()) / 1000,
          );

          res.status(429).json(
            options.message ?? {
              error: "Too many requests",
              message: "Rate limit exceeded. Please try again later.",
              retryAfter: retryAfterSecs,
              limit: options.maxRequests,
              remaining: result.remaining,
              resetTime: result.resetTime.toISOString(),
            },
          );
          return;
        }

        next();
      } catch (error) {
        logger.error("Rate limiting error — allowing request through", {
          error: (error as Error).message,
        });
        next();
      }
    };
  }

  destroy(): void {
    clearInterval(this.memoryPurgeInterval);
  }
}

export const rateLimiter = new CustomRateLimiter();

export const RateLimiters = {
  general: rateLimiter.createMiddleware({
    ...getRateLimitConfig("general", config.NODE_ENV),
    message: { error: "Too many requests", message: "General API rate limit exceeded", type: "general_api_limit" },
  }),

  upload: rateLimiter.createMiddleware({
    ...getRateLimitConfig("upload", config.NODE_ENV),
    keyGenerator: (req) => `upload:${rateLimiter.getClientIP(req)}`,
    message: { error: "Upload limit exceeded", message: "Too many video uploads. Please wait before uploading again.", type: "upload_limit" },
  }),

  streaming: rateLimiter.createMiddleware({
    ...getRateLimitConfig("streaming", config.NODE_ENV),
    keyGenerator: (req) => `stream:${rateLimiter.getClientIP(req)}`,
    message: { error: "Streaming limit exceeded", message: "Too many streaming requests. Please reduce playback quality or pause briefly.", type: "streaming_limit" },
  }),

  status: rateLimiter.createMiddleware({
    ...getRateLimitConfig("status", config.NODE_ENV),
    keyGenerator: (req) => `status:${rateLimiter.getClientIP(req)}`,
    message: { error: "Status check limit exceeded", message: "Too many status checks. Please reduce polling frequency.", type: "status_limit" },
  }),

  search: rateLimiter.createMiddleware({
    ...getRateLimitConfig("search", config.NODE_ENV),
    keyGenerator: (req) => `search:${rateLimiter.getClientIP(req)}`,
    message: { error: "Search limit exceeded", message: "Too many search requests. Please wait before searching again.", type: "search_limit" },
  }),

  auth: rateLimiter.createMiddleware({
    ...getRateLimitConfig("auth", config.NODE_ENV),
    keyGenerator: (req) => `auth:${rateLimiter.getClientIP(req)}`,
    message: { error: "Authentication limit exceeded", message: "Too many authentication attempts. Please wait before trying again.", type: "auth_limit" },
  }),

  webhook: rateLimiter.createMiddleware({
    ...getRateLimitConfig("webhook", config.NODE_ENV),
    keyGenerator: (req) => `webhook:${rateLimiter.getClientIP(req)}`,
    message: { error: "Webhook limit exceeded", message: "Too many webhook requests.", type: "webhook_limit" },
  }),

  admin: rateLimiter.createMiddleware({
    ...getRateLimitConfig("admin", config.NODE_ENV),
    keyGenerator: (req) => `admin:${rateLimiter.getClientIP(req)}`,
    message: { error: "Admin limit exceeded", message: "Too many admin requests. Please wait before performing admin actions.", type: "admin_limit" },
  }),
};

export const createUserRateLimit = (userId: string, options: RateLimitOptions): RequestHandler => {
  return rateLimiter.createMiddleware({
    ...options,
    keyGenerator: (req) => `user:${userId}:${req.path}`,
  });
};

export const createVideoSizeBasedLimit = (baseOptions: RateLimitOptions): RequestHandler => {
  return rateLimiter.createMiddleware({
    ...baseOptions,
    keyGenerator: (req) => {
      const fileSize = parseInt(req.headers["content-length"] || "0");
      const sizeCategory = fileSize > 100 * 1024 * 1024 ? "large" : "small";
      return `video_size:${sizeCategory}:${rateLimiter.getClientIP(req)}`;
    },
  });
};
