import { createClient } from "redis";
import { config } from "./env.js";

// Create Redis client
export const redisClient = createClient({
  url: config.REDIS_URL || "redis://localhost:6379",
});

// Redis connection handlers
redisClient.on("error", (err: Error) => {
  console.error("Redis Client Error:", err);
});

redisClient.on("connect", () => {
  console.log("✅ Connected to Redis");
});

redisClient.on("ready", () => {
  console.log("🚀 Redis client ready");
});

redisClient.on("end", () => {
  console.log("❌ Redis connection ended");
});

// Connect to Redis
export const connectRedis = async () => {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
    }
  } catch (error) {
    console.error("Failed to connect to Redis:", error);
    // Don't throw error - app should work without Redis
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
      console.error("Redis get error:", error);
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
      console.error("Redis set error:", error);
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
      console.error("Redis del error:", error);
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
      console.error("Redis exists error:", error);
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
    console.error("Error disconnecting Redis:", error);
  }
};
