/**
 * Rate Limiting Configuration for Video Streaming Application
 * Customized for different endpoint types and usage patterns
 */

export const RateLimitConfig = {
  // General API endpoints
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100, // 100 requests per 15 minutes
    description: "General API rate limit for standard endpoints",
  },

  // Video upload endpoints - most restrictive
  upload: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 3, // Only 3 uploads per 15 minutes
    description: "Strict upload limit to prevent abuse and control costs",
  },

  // Video streaming endpoints - high volume support
  streaming: {
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 300, // 300 requests per minute (5 per second average)
    description: "High-volume streaming support for smooth playback",
  },

  // Video processing status checks
  status: {
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 60, // 1 request per second average
    description: "Status polling limit to prevent excessive API calls",
  },

  // Video search and listing
  search: {
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 30, // 30 searches per minute
    description: "Search rate limit to prevent abuse while allowing browsing",
  },

  // Authentication endpoints
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 10, // 10 auth attempts per 15 minutes
    description: "Authentication rate limit for security",
  },

  // Webhook endpoints - external services
  webhook: {
    windowMs: 1 * 60 * 1000, // 1 minute
    maxRequests: 100, // 100 webhooks per minute
    description: "Webhook rate limit for external service callbacks",
  },

  // Admin endpoints - very restrictive
  admin: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 20, // 20 requests per 5 minutes
    description: "Admin operation rate limit for security",
  },

  // Dynamic configurations for special cases
  uploadBySize: {
    small: {
      windowMs: 10 * 60 * 1000, // 10 minutes
      maxRequests: 5, // 5 small uploads per 10 minutes
      maxSizeBytes: 50 * 1024 * 1024, // 50MB
      description: "Small video uploads (under 50MB)",
    },
    large: {
      windowMs: 30 * 60 * 1000, // 30 minutes
      maxRequests: 2, // 2 large uploads per 30 minutes
      maxSizeBytes: Infinity,
      description: "Large video uploads (over 50MB)",
    },
  },

  // Premium user configurations (for future use)
  premium: {
    uploadMultiplier: 3, // 3x upload limits
    streamingMultiplier: 2, // 2x streaming limits
    searchMultiplier: 2, // 2x search limits
    description: "Premium user rate limit multipliers",
  },

  // Development environment configurations
  development: {
    generalMultiplier: 10, // 10x limits in development
    uploadMultiplier: 5, // 5x upload limits in development
    description: "Development environment has relaxed limits",
  },
} as const;

/**
 * Get rate limit configuration based on environment and user type
 */
export function getRateLimitConfig(
  endpoint: keyof typeof RateLimitConfig,
  environment: string = "production",
  userType: "free" | "premium" = "free"
) {
  const baseConfig = RateLimitConfig[endpoint];

  if (
    !baseConfig ||
    typeof baseConfig !== "object" ||
    !("windowMs" in baseConfig)
  ) {
    throw new Error(`Invalid endpoint configuration: ${String(endpoint)}`);
  }

  let config = { ...baseConfig };

  // Apply environment multipliers
  if (environment === "development" && RateLimitConfig.development) {
    const devConfig = RateLimitConfig.development;

    if (endpoint === "general" && devConfig.generalMultiplier) {
      config.maxRequests *= devConfig.generalMultiplier;
    } else if (endpoint === "upload" && devConfig.uploadMultiplier) {
      config.maxRequests *= devConfig.uploadMultiplier;
    }
  }

  // Apply premium user multipliers
  if (userType === "premium" && RateLimitConfig.premium) {
    const premiumConfig = RateLimitConfig.premium;

    if (endpoint === "upload" && premiumConfig.uploadMultiplier) {
      config.maxRequests *= premiumConfig.uploadMultiplier;
    } else if (endpoint === "streaming" && premiumConfig.streamingMultiplier) {
      config.maxRequests *= premiumConfig.streamingMultiplier;
    } else if (endpoint === "search" && premiumConfig.searchMultiplier) {
      config.maxRequests *= premiumConfig.searchMultiplier;
    }
  }

  return config;
}

/**
 * Rate limiting strategies explanation
 */
export const RateLimitingStrategies = {
  slidingWindow: {
    description:
      "Uses Redis sorted sets to maintain accurate sliding time windows",
    advantages: [
      "Most accurate rate limiting",
      "Prevents burst traffic at window boundaries",
      "Memory efficient with automatic cleanup",
    ],
    implementation: "Redis ZREMRANGEBYSCORE + ZADD + ZCARD",
    redisCommands: ["ZREMRANGEBYSCORE", "ZADD", "ZCARD", "EXPIRE"],
    memoryEfficient: true,
    accuracyLevel: "high",
  },

  fixedWindow: {
    description: "Simple counter-based approach with fixed time windows",
    advantages: [
      "Simple implementation",
      "Low memory usage",
      "Fast operations",
    ],
    implementation: "Redis INCR + EXPIRE",
    redisCommands: ["INCR", "EXPIRE"],
    memoryEfficient: true,
    accuracyLevel: "medium",
  },

  tokenBucket: {
    description:
      "Allows burst traffic up to bucket capacity, refills over time",
    advantages: [
      "Handles natural traffic bursts",
      "Smooth rate limiting",
      "User-friendly for legitimate usage",
    ],
    implementation: "Redis EVAL with Lua script",
    redisCommands: ["EVAL"],
    memoryEfficient: false,
    accuracyLevel: "high",
  },
} as const;

/**
 * Get the appropriate rate limiting strategy based on endpoint type
 */
export function getStrategyForEndpoint(
  endpoint: keyof typeof RateLimitConfig
): keyof typeof RateLimitingStrategies {
  // Strategy selection based on endpoint characteristics
  switch (endpoint) {
    case "streaming":
      // High volume, needs burst handling
      return "tokenBucket";

    case "upload":
    case "admin":
      // Strict control, high accuracy needed
      return "slidingWindow";

    case "auth":
      // Security critical, simple and reliable
      return "fixedWindow";

    case "webhook":
    case "status":
    case "search":
    default:
      // Balanced approach for most endpoints
      return "slidingWindow";
  }
}

export default RateLimitConfig;
