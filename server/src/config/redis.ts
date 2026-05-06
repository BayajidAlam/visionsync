import { createClient } from "redis";
import { config } from "./env.js";
import { logger } from "./logger.js";

export const redisClient = createClient({
  url: config.REDIS_URL || "redis://localhost:6379",
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error("Redis reconnect limit reached — giving up");
        return false;
      }
      const delay = Math.min(retries * 100, 3000);
      logger.warn("Redis reconnecting", { retries, delayMs: delay });
      return delay;
    },
  },
  commandsQueueMaxLength: 500,
});

redisClient.on("error", (err: Error) => {
  logger.error("Redis client error", { message: err.message });
});

redisClient.on("connect", () => {
  logger.info("Redis connected");
});

redisClient.on("ready", () => {
  logger.info("Redis client ready");
});

redisClient.on("end", () => {
  logger.warn("Redis connection ended");
});

// Connect to Redis
export const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (error) {
    logger.warn("Redis unavailable — running without cache", { error: (error as Error).message });
  }
};

// Redis cache helper functions
export const cache = {
  // Get value from cache
  async get(key: string) {
    try {
      if (!redisClient.isOpen) return null;
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error("Redis get error", { error: (error as Error).message });
      return null;
    }
  },

  // Set value in cache with optional TTL (in seconds)
  async set(key: string, value: any, ttl: number = 3600) {
    try {
      if (!redisClient.isOpen) return false;
      await redisClient.setEx(key, ttl, JSON.stringify(value));
      return true;
    } catch (error) {
      logger.error("Redis set error", { error: (error as Error).message });
      return false;
    }
  },

  // Delete key from cache
  async del(key: string) {
    try {
      if (!redisClient.isOpen) return false;
      await redisClient.del(key);
      return true;
    } catch (error) {
      logger.error("Redis del error", { error: (error as Error).message });
      return false;
    }
  },

  // Check if key exists
  async exists(key: string) {
    try {
      if (!redisClient.isOpen) return false;
      const exists = await redisClient.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error("Redis exists error", { error: (error as Error).message });
      return false;
    }
  },
};

// Graceful shutdown
export const disconnectRedis = async () => {
  try {
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  } catch (error) {
    logger.error("Error disconnecting Redis", { error: (error as Error).message });
  }
};
