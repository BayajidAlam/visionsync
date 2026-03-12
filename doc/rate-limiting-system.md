# Custom Rate Limiting System for Video Streaming Application

## Overview

This custom rate limiting system is specifically designed for video streaming applications with Redis backing and intelligent fallback to memory storage. It provides endpoint-specific rate limiting with sliding window algorithms for accurate request tracking.

## Features

✅ **Redis-based sliding window rate limiting** with memory fallback  
✅ **Endpoint-specific rate limits** optimized for video streaming  
✅ **Intelligent IP detection** with proxy support  
✅ **User-based rate limiting** for authenticated users  
✅ **Dynamic rate limiting** based on video size/quality  
✅ **Development environment support** with relaxed limits  
✅ **Premium user support** with configurable multipliers  
✅ **Comprehensive error messages** with helpful suggestions  
✅ **Monitoring and analytics** built-in

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Express App   │────│  Rate Limiters   │────│  Redis Client   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │                        │
                                │                        │
                       ┌──────────────────┐    ┌─────────────────┐
                       │ Config Manager   │    │ Memory Fallback │
                       └──────────────────┘    └─────────────────┘
```

## Rate Limiting Rules

### 1. General API Endpoints

- **Limit**: 100 requests per 15 minutes
- **Scope**: All `/api/*` routes
- **Use Case**: Standard API operations

### 2. Video Upload Endpoints

- **Limit**: 3 uploads per 15 minutes
- **Scope**: `/api/upload/*`, `/api/videos/upload`
- **Use Case**: Prevent abuse and control processing costs
- **Special**: Size-based dynamic limiting available

### 3. Video Streaming Endpoints

- **Limit**: 300 requests per minute (5/second average)
- **Scope**: `/api/videos/:id/segments`, `/api/videos/:id/manifest`
- **Use Case**: High-volume streaming support for smooth playback

### 4. Video Search/Listing

- **Limit**: 30 requests per minute
- **Scope**: `/api/videos/search`, `/api/videos`
- **Use Case**: Prevent search abuse while allowing browsing

### 5. Authentication Endpoints

- **Limit**: 10 attempts per 15 minutes
- **Scope**: `/api/auth/*`, `/api/login`, `/api/register`
- **Use Case**: Security against brute force attacks

### 6. Status Check Endpoints

- **Limit**: 60 requests per minute (1/second average)
- **Scope**: `/api/videos/:id/status`, `/api/processing/status`
- **Use Case**: Prevent excessive polling

### 7. Webhook Endpoints

- **Limit**: 100 requests per minute
- **Scope**: `/api/webhook/*`
- **Use Case**: External service callbacks

### 8. Admin Endpoints

- **Limit**: 20 requests per 5 minutes
- **Scope**: `/api/admin/*`
- **Use Case**: Restrict admin operations for security

## Implementation Details

### Redis Sliding Window Algorithm

```typescript
// Uses Redis sorted sets for accurate sliding windows
pipeline.zRemRangeByScore(key, 0, windowStart); // Remove old entries
pipeline.zAdd(key, { score: now, value: `${now}-${Math.random()}` }); // Add current request
pipeline.zCard(key); // Count requests in window
pipeline.expire(key, windowSeconds); // Set expiration
```

### Memory Fallback

```typescript
// Automatic fallback when Redis is unavailable
if (this.useRedis && redisClient?.isOpen) {
  return this.redisRateLimit(key, options);
} else {
  return this.memoryRateLimit(key, options);
}
```

## Configuration

### Environment Variables

```bash
# Rate limiting configuration
RATE_LIMIT_STORE=redis                 # 'redis' or 'memory'
RATE_LIMIT_WINDOW_MS=900000           # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100           # General limit

# Redis configuration
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_TLS=false
REDIS_CLUSTER_MODE=false
```

### Development vs Production

```typescript
// Development environment gets relaxed limits
if (environment === "development") {
  config.maxRequests *= 10; // 10x general limits
  uploadLimits *= 5; // 5x upload limits
}
```

## Usage Examples

### Basic Usage

```typescript
import { RateLimiters } from "./middleware/rateLimiting.js";

// Apply to all API routes
app.use("/api", RateLimiters.general);

// Apply to specific endpoints
app.use("/api/upload", RateLimiters.upload);
app.use("/api/videos/:id/stream", RateLimiters.streaming);
```

### Custom Rate Limiting

```typescript
import { rateLimiter } from "./middleware/rateLimiting.js";

// Custom rate limiter with specific configuration
const customLimiter = rateLimiter.createMiddleware({
  windowMs: 5 * 60 * 1000, // 5 minutes
  maxRequests: 50,
  keyGenerator: (req) => `custom:${req.ip}`,
  message: {
    error: "Custom limit exceeded",
    message: "Too many custom requests",
  },
});

app.use("/api/custom", customLimiter);
```

### User-Based Rate Limiting

```typescript
import { createUserRateLimit } from "./middleware/rateLimiting.js";

// Rate limiting per user
app.post(
  "/api/user-action",
  authenticateUser,
  (req, res, next) => {
    const userId = req.user.id;
    const userRateLimit = createUserRateLimit(userId, {
      windowMs: 10 * 60 * 1000, // 10 minutes
      maxRequests: 20,
    });

    userRateLimit(req, res, next);
  },
  handleUserAction
);
```

### Dynamic Rate Limiting

```typescript
// Rate limiting based on video quality
app.get(
  "/api/videos/:id/stream",
  (req, res, next) => {
    const quality = req.query.quality;
    const limits = getQualityLimits(quality); // Custom function

    const qualityLimiter = rateLimiter.createMiddleware(limits);
    qualityLimiter(req, res, next);
  },
  streamVideo
);
```

## Monitoring

### Health Check Endpoint

```bash
GET /health
```

Response includes rate limiting status:

```json
{
  "status": "ok",
  "rateLimiting": {
    "store": "redis",
    "system": "custom-redis-sliding-window",
    "endpoints": {
      "general": "100 req/900000ms",
      "upload": "3 req/15min",
      "streaming": "300 req/1min"
    },
    "features": [
      "Redis sliding window",
      "Memory fallback",
      "Endpoint-specific limits"
    ]
  }
}
```

### Rate Limit Headers

All rate-limited responses include headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200000
X-RateLimit-Store: redis
```

### Error Responses

```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again later.",
  "retryAfter": 900,
  "limit": 100,
  "remaining": 0,
  "resetTime": "2024-01-01T12:00:00.000Z",
  "type": "general_api_limit"
}
```

## Performance Considerations

### Redis Performance

- Uses Redis pipelines for atomic operations
- Automatic cleanup of expired entries
- Optimized for high-throughput streaming applications

### Memory Usage

- Sliding window approach minimizes memory footprint
- Automatic key expiration prevents memory leaks
- Graceful fallback to memory when Redis unavailable

### Network Efficiency

- Batched Redis operations reduce network calls
- Intelligent key generation prevents conflicts
- Connection pooling for Redis clients

## Security Features

### IP Detection

- Supports X-Forwarded-For headers
- Handles proxy configurations
- Prevents IP spoofing

### Brute Force Protection

- Strict limits on authentication endpoints
- Progressive delays for repeated failures
- Admin operation restrictions

### DDoS Mitigation

- Multiple rate limiting layers
- Endpoint-specific protections
- Real-time traffic analysis

## Scaling Considerations

### Multi-Instance Deployment

- Redis-based coordination between instances
- Consistent rate limiting across cluster
- No single point of failure

### Global Rate Limiting

- Distributed rate limiting support
- Multi-region deployment ready
- CDN integration compatible

### High Availability

- Redis Cluster support
- Automatic failover to memory
- Graceful degradation

## Cost Optimization

### Infrastructure Costs

- Efficient Redis usage patterns
- Memory fallback reduces Redis dependency
- Optimized for AWS ElastiCache

### Processing Costs

- Upload limits control video processing costs
- Streaming limits prevent bandwidth abuse
- Status check limits reduce API overhead

### Development Efficiency

- Environment-specific configurations
- Easy limit adjustments
- Comprehensive monitoring

## Future Enhancements

### Planned Features

- [ ] Token bucket algorithm option
- [ ] Geographic rate limiting
- [ ] ML-based adaptive limits
- [ ] Real-time limit adjustments
- [ ] Advanced analytics dashboard

### Premium Features

- [ ] Custom rate limit plans
- [ ] API key-based limiting
- [ ] Tenant-based isolation
- [ ] Advanced reporting

## Troubleshooting

### Common Issues

1. **Redis Connection Failed**

   - System automatically falls back to memory
   - Check Redis configuration and connectivity
   - Verify Redis client setup

2. **Rate Limits Too Restrictive**

   - Adjust limits in `rateLimitConfig.ts`
   - Consider user type multipliers
   - Check environment-specific settings

3. **Performance Issues**
   - Monitor Redis memory usage
   - Check pipeline efficiency
   - Verify connection pooling

### Debug Mode

```bash
# Enable debug logging
DEBUG=rate-limiter npm start
```

### Monitoring Commands

```bash
# Check Redis rate limiting keys
redis-cli KEYS "rate_limit:*"

# Monitor Redis operations
redis-cli MONITOR

# Check memory usage
redis-cli INFO memory
```

## Conclusion

This custom rate limiting system provides a robust, scalable, and cost-effective solution for video streaming applications. It balances security, performance, and user experience while providing the flexibility needed for different use cases and environments.

The system is production-ready with Redis backing and intelligent fallback mechanisms, making it suitable for high-traffic video streaming platforms with varying user needs and usage patterns.
