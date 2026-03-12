import { Request, Response, NextFunction } from "express";
import { cache } from "../config/redis.js";

interface CacheOptions {
  ttl?: number; // TTL in seconds
  keyGenerator?: (req: Request) => string;
  skipCache?: (req: Request) => boolean;
  shouldCache?: (req: Request, res: Response, result: any) => boolean;
}

/**
 * Response caching middleware for Express
 * Caches API responses in Redis to reduce database load
 */
export function responseCache(options: CacheOptions = {}) {
  const {
    ttl = 300, // 5 minutes default
    keyGenerator = defaultKeyGenerator,
    skipCache = () => false,
    shouldCache = defaultShouldCache,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Skip caching for certain conditions
      if (skipCache(req)) {
        return next();
      }

      // Generate cache key
      const cacheKey = keyGenerator(req);

      // Try to get cached response
      const cachedResponse = await cache.get(cacheKey);
      
      if (cachedResponse) {
        console.log(`🎯 Cache hit: ${cacheKey}`);
        res.json(cachedResponse);
        return;
      }

      console.log(`❌ Cache miss: ${cacheKey}`);

      // Store original json method
      const originalJson = res.json.bind(res);
      
      // Override res.json to cache the response
      res.json = function(body: any) {
        // Cache the response if conditions are met
        if (res.statusCode === 200 && shouldCache(req, res, body)) {
          cache.set(cacheKey, body, ttl).catch(error => {
            console.error("Error caching response:", error);
          });
          console.log(`🔥 Cached response: ${cacheKey}`);
        }
        
        // Call original json method
        return originalJson(body);
      };

      next();
    } catch (error) {
      console.error("Cache middleware error:", error);
      next(); // Continue without caching
    }
  };
}

/**
 * Default cache key generator
 */
function defaultKeyGenerator(req: Request): string {
  const { method, originalUrl, query } = req;
  const queryString = Object.keys(query)
    .sort()
    .map(key => `${key}=${query[key]}`)
    .join("&");
  
  return `api:${method}:${originalUrl}${queryString ? `?${queryString}` : ""}`;
}

/**
 * Default function to determine if response should be cached
 */
function defaultShouldCache(req: Request, res: Response, result: any): boolean {
  // Don't cache errors
  if (res.statusCode !== 200) return false;
  
  // Don't cache empty responses
  if (!result || (result.data && Array.isArray(result.data) && result.data.length === 0)) {
    return false;
  }
  
  return true;
}

/**
 * Pre-configured caching middlewares for common use cases
 */
export const CacheMiddleware = {
  // Video metadata - 5 minutes
  videoMetadata: responseCache({
    ttl: 300,
    keyGenerator: (req) => `video:metadata:${req.params.id}`,
  }),

  // Video lists - 2 minutes (frequently updated)
  videoList: responseCache({
    ttl: 120,
    keyGenerator: (req) => `video:list:${req.originalUrl}`,
  }),

  // Search results - 3 minutes
  searchResults: responseCache({
    ttl: 180,
    keyGenerator: (req) => `video:search:${encodeURIComponent(req.query.q as string || '')}`,
    skipCache: (req) => !req.query.q || (req.query.q as string).length < 2,
  }),

  // Video status - 30 seconds (frequently polled)
  videoStatus: responseCache({
    ttl: 30,
    keyGenerator: (req) => `video:status:${req.params.id}`,
  }),

  // Video statistics - 5 minutes
  videoStats: responseCache({
    ttl: 300,
    keyGenerator: () => "video:stats:overview",
  }),

  // Videos by status - 3 minutes
  videosByStatus: responseCache({
    ttl: 180,
    keyGenerator: (req) => `video:by_status:${req.params.status}`,
  }),

  // Manifest URLs - 1 hour (stable once ready)
  manifestUrl: responseCache({
    ttl: 3600,
    keyGenerator: (req) => `video:manifest:${req.params.id}`,
    shouldCache: (req, res, result) => {
      // Only cache successful manifest responses
      return res.statusCode === 200 || res.statusCode === 302;
    },
  }),
};

/**
 * Cache invalidation helper
 */
export async function invalidatePatternCache(pattern: string): Promise<void> {
  try {
    // This would require Redis SCAN or pattern matching
    // For now, we'll implement basic invalidation
    console.log(`🗑️  Pattern cache invalidation: ${pattern}`);
  } catch (error) {
    console.error("Error invalidating pattern cache:", error);
  }
}

/**
 * Cache warming utility
 */
export async function warmCache(routes: { method: string; path: string; ttl?: number }[]): Promise<void> {
  console.log(`🔥 Warming cache for ${routes.length} routes`);
  // Implementation would make requests to warm up the cache
  // This is useful for popular endpoints after deployment
}