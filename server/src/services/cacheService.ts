import { cache } from "../config/redis.js";
import { Video, VideoStatus } from "../types/index.js";

export class CacheService {
  // Cache TTL configurations (in seconds)
  private static readonly CACHE_TTL = {
    VIDEO_METADATA: 300, // 5 minutes
    VIDEO_LIST: 120, // 2 minutes  
    VIDEO_SEARCH: 180, // 3 minutes
    VIDEO_STATUS: 30, // 30 seconds (frequently updated)
    VIDEO_STATS: 300, // 5 minutes
    VIDEO_BY_STATUS: 180, // 3 minutes
    MANIFEST_URL: 3600, // 1 hour (stable once ready)
  };

  // Cache key generators
  private static generateKey(type: string, identifier: string): string {
    return `video:${type}:${identifier}`;
  }

  // Video metadata caching
  async cacheVideo(video: Video): Promise<void> {
    try {
      const key = CacheService.generateKey("metadata", video.id);
      await cache.set(key, video, CacheService.CACHE_TTL.VIDEO_METADATA);
      console.log(`🔥 Cached video metadata: ${video.id}`);
    } catch (error) {
      console.error("Error caching video:", error);
    }
  }

  async getCachedVideo(videoId: string): Promise<Video | null> {
    try {
      const key = CacheService.generateKey("metadata", videoId);
      const cached = await cache.get(key);
      
      if (cached) {
        console.log(`🎯 Cache hit for video: ${videoId}`);
        return cached as Video;
      }
      
      console.log(`❌ Cache miss for video: ${videoId}`);
      return null;
    } catch (error) {
      console.error("Error getting cached video:", error);
      return null;
    }
  }

  async invalidateVideo(videoId: string): Promise<void> {
    try {
      const keys = [
        CacheService.generateKey("metadata", videoId),
        CacheService.generateKey("status", videoId),
        CacheService.generateKey("manifest", videoId),
      ];

      await Promise.all(keys.map(key => cache.del(key)));
      
      // Also invalidate list caches that might contain this video
      await this.invalidateListCaches();
      
      console.log(`🗑️  Invalidated caches for video: ${videoId}`);
    } catch (error) {
      console.error("Error invalidating video cache:", error);
    }
  }

  // Video list caching
  async cacheVideoList(videos: Video[]): Promise<void> {
    try {
      const key = CacheService.generateKey("list", "all");
      await cache.set(key, videos, CacheService.CACHE_TTL.VIDEO_LIST);
      console.log(`🔥 Cached video list: ${videos.length} videos`);
    } catch (error) {
      console.error("Error caching video list:", error);
    }
  }

  async getCachedVideoList(): Promise<Video[] | null> {
    try {
      const key = CacheService.generateKey("list", "all");
      const cached = await cache.get(key);
      
      if (cached) {
        console.log(`🎯 Cache hit for video list`);
        return cached as Video[];
      }
      
      console.log(`❌ Cache miss for video list`);
      return null;
    } catch (error) {
      console.error("Error getting cached video list:", error);
      return null;
    }
  }

  // Search results caching
  async cacheSearchResults(query: string, results: Video[]): Promise<void> {
    try {
      // Normalize query for consistent caching
      const normalizedQuery = query.toLowerCase().trim();
      const key = CacheService.generateKey("search", normalizedQuery);
      await cache.set(key, results, CacheService.CACHE_TTL.VIDEO_SEARCH);
      console.log(`🔥 Cached search results: "${query}" (${results.length} results)`);
    } catch (error) {
      console.error("Error caching search results:", error);
    }
  }

  async getCachedSearchResults(query: string): Promise<Video[] | null> {
    try {
      const normalizedQuery = query.toLowerCase().trim();
      const key = CacheService.generateKey("search", normalizedQuery);
      const cached = await cache.get(key);
      
      if (cached) {
        console.log(`🎯 Cache hit for search: "${query}"`);
        return cached as Video[];
      }
      
      console.log(`❌ Cache miss for search: "${query}"`);
      return null;
    } catch (error) {
      console.error("Error getting cached search results:", error);
      return null;
    }
  }

  // Video status caching (short TTL due to frequent updates)
  async cacheVideoStatus(videoId: string, status: VideoStatus): Promise<void> {
    try {
      const key = CacheService.generateKey("status", videoId);
      await cache.set(key, { status, timestamp: Date.now() }, CacheService.CACHE_TTL.VIDEO_STATUS);
      console.log(`🔥 Cached video status: ${videoId} -> ${status}`);
    } catch (error) {
      console.error("Error caching video status:", error);
    }
  }

  async getCachedVideoStatus(videoId: string): Promise<VideoStatus | null> {
    try {
      const key = CacheService.generateKey("status", videoId);
      const cached = await cache.get(key);
      
      if (cached) {
        console.log(`🎯 Cache hit for status: ${videoId}`);
        return (cached as any).status;
      }
      
      return null;
    } catch (error) {
      console.error("Error getting cached video status:", error);
      return null;
    }
  }

  // Videos by status caching
  async cacheVideosByStatus(status: VideoStatus, videos: Video[]): Promise<void> {
    try {
      const key = CacheService.generateKey("by_status", status);
      await cache.set(key, videos, CacheService.CACHE_TTL.VIDEO_BY_STATUS);
      console.log(`🔥 Cached videos by status: ${status} (${videos.length} videos)`);
    } catch (error) {
      console.error("Error caching videos by status:", error);
    }
  }

  async getCachedVideosByStatus(status: VideoStatus): Promise<Video[] | null> {
    try {
      const key = CacheService.generateKey("by_status", status);
      const cached = await cache.get(key);
      
      if (cached) {
        console.log(`🎯 Cache hit for videos by status: ${status}`);
        return cached as Video[];
      }
      
      return null;
    } catch (error) {
      console.error("Error getting cached videos by status:", error);
      return null;
    }
  }

  // Video stats caching
  async cacheVideoStats(stats: any): Promise<void> {
    try {
      const key = CacheService.generateKey("stats", "overview");
      await cache.set(key, stats, CacheService.CACHE_TTL.VIDEO_STATS);
      console.log(`🔥 Cached video stats`);
    } catch (error) {
      console.error("Error caching video stats:", error);
    }
  }

  async getCachedVideoStats(): Promise<any | null> {
    try {
      const key = CacheService.generateKey("stats", "overview");
      const cached = await cache.get(key);
      
      if (cached) {
        console.log(`🎯 Cache hit for video stats`);
        return cached;
      }
      
      return null;
    } catch (error) {
      console.error("Error getting cached video stats:", error);
      return null;
    }
  }

  // Manifest URL caching (stable once video is ready)
  async cacheManifestUrl(videoId: string, manifestUrl: string): Promise<void> {
    try {
      const key = CacheService.generateKey("manifest", videoId);
      await cache.set(key, manifestUrl, CacheService.CACHE_TTL.MANIFEST_URL);
      console.log(`🔥 Cached manifest URL: ${videoId}`);
    } catch (error) {
      console.error("Error caching manifest URL:", error);
    }
  }

  async getCachedManifestUrl(videoId: string): Promise<string | null> {
    try {
      const key = CacheService.generateKey("manifest", videoId);
      const cached = await cache.get(key);
      
      if (cached) {
        console.log(`🎯 Cache hit for manifest: ${videoId}`);
        return cached as string;
      }
      
      return null;
    } catch (error) {
      console.error("Error getting cached manifest URL:", error);
      return null;
    }
  }

  // Cache invalidation helpers
  async invalidateListCaches(): Promise<void> {
    try {
      const listKeys = [
        CacheService.generateKey("list", "all"),
        CacheService.generateKey("stats", "overview"),
      ];

      await Promise.all(listKeys.map(key => cache.del(key)));
      console.log(`🗑️  Invalidated list caches`);
    } catch (error) {
      console.error("Error invalidating list caches:", error);
    }
  }

  async invalidateSearchCaches(): Promise<void> {
    try {
      // In Redis, we'd need to track search keys or use pattern matching
      // For now, we'll implement this when we move to advanced search solutions
      console.log(`🗑️  Search cache invalidation triggered`);
    } catch (error) {
      console.error("Error invalidating search caches:", error);
    }
  }

  // Batch cache operations
  async warmupVideoCache(videos: Video[]): Promise<void> {
    try {
      const cachePromises = videos.map(video => this.cacheVideo(video));
      await Promise.all(cachePromises);
      console.log(`🔥 Warmed up cache for ${videos.length} videos`);
    } catch (error) {
      console.error("Error warming up video cache:", error);
    }
  }

  // Cache statistics
  async getCacheStats(): Promise<{
    hits: number;
    misses: number;
    hitRate: number;
  }> {
    // This would require implementing hit/miss counters
    // For now, return mock data
    return {
      hits: 0,
      misses: 0,
      hitRate: 0
    };
  }
}

export const cacheService = new CacheService();