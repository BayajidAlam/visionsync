# VisionSync — Requirements & Solutions

## Functional Requirements

### FR-1: Video Upload

| Requirement | Status | Implementation |
|-------------|--------|---------------|
| Upload up to 5 GB | ✅ | Size check in `VideoUpload.tsx` before presigned URL request |
| MP4, MOV, AVI, WebM, OGG | ✅ | Magic-byte validation before any network call |
| Upload progress + speed | ✅ | XHR `upload.onprogress`; bytes + speed displayed |
| Concurrent uploads | ✅ | Upload queue; multiple files processed sequentially |
| Expired URL guard | ✅ | `isUrlExpired(expiresAt, 30_000)` check before XHR starts |

**Solution — Presigned S3 Upload:**
```
Browser → POST /api/upload/generate-presigned-url
Server  → creates DB record (UPLOADING) + S3 presigned PUT URL
Browser ← { presignedUrl, videoId, expiresAt }

Browser → PUT <presignedUrl> directly to S3 (no server proxy)
Browser → POST /api/upload/confirm/:videoId
Server  → status UPLOADING → UPLOADED
```

Video bytes never transit Express — no bandwidth cost, no memory pressure on the server.

**Magic byte check (runs before network):**
```typescript
const hasFtyp = b[4]===0x66 && b[5]===0x74 && b[6]===0x79 && b[7]===0x70; // MP4/MOV
const hasRiff = b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46; // AVI
const hasWebm = b[0]===0x1a && b[1]===0x45 && b[2]===0xdf && b[3]===0xa3; // WebM
const hasOgg  = b[0]===0x4f && b[1]===0x67 && b[2]===0x67 && b[3]===0x53; // OGG
```

---

### FR-2: Video Processing

| Requirement | Status | Implementation |
|-------------|--------|---------------|
| Transcode to multiple quality levels | ✅ | FFmpeg DASH encoding in `container/src/process-video.ts` |
| Generate adaptive manifest | ✅ | `manifest.mpd` uploaded to S3 processed bucket |
| Async (non-blocking) | ✅ | S3 → SQS → Lambda → ECS; upload returns immediately |
| Processing failure handling | ✅ | ECS posts error webhook; DB updated atomically; browser notified |
| Duplicate processing prevention | ✅ | `{ $ne: VideoStatus.READY }` MongoDB filter on all terminal updates |

**Solution — Event-Driven ECS Pipeline:**

S3 → SQS → Lambda → ECS Fargate. Upload completes the moment S3 accepts the file. Processing happens entirely async. Lambda chooses Fargate Spot (< 1 GB, 70% probability) or on-demand (≥ 1 GB or Spot unavailable). Retry is automatic — SQS redelivers if Lambda fails; Lambda retries Spot→on-demand in the same invocation.

---

### FR-3: Adaptive Streaming

| Requirement | Status | Implementation |
|-------------|--------|---------------|
| DASH adaptive streaming | ✅ | dash.js UMD global; manifest from CloudFront |
| ABR quality switching | ✅ | `setQualityFor("video", index, true)` — `replace=true` flushes buffer |
| Manual quality selection | ✅ | Quality menu shows height + bitrate |
| CDN segment delivery | ✅ | All segments + manifest served from `VITE_CLOUDFRONT_URL` |
| Fallback when CF not set | ✅ | `getManifestUrl()` falls back to ALB proxy path |

**Why dashjs as UMD global (not bundled):**
dash.js contains an embedded webpack runtime. Bundling through Vite (Rollup) or esbuild causes module system conflicts — `window.dashjs.MediaPlayer` is `undefined` at runtime. Loading as a classic `<script>` tag in `index.html` before the React bundle runs avoids this entirely.

**Why `apiService.getManifestUrl()` not `video.manifestUrl`:**
`video.manifestUrl` is stored in MongoDB at processing time. After `make destroy` + `make deploy`, CloudFront gets a new domain — all stored URLs point to the deleted distribution. `apiService.getManifestUrl(videoId)` constructs the URL from `VITE_CLOUDFRONT_URL` baked at build time, always pointing to the live distribution.

---

### FR-4: Real-Time Status Updates

| Requirement | Status | Implementation |
|-------------|--------|---------------|
| Live processing status | ✅ | Socket.IO room per `videoId`; UPLOADING → UPLOADED → PROCESSING → READY / ERROR |
| Reconnect on disconnect | ✅ | `connectionStateRecovery` (2-min window); `useSocket.ts` reconnect logic |
| Replay missed events | ✅ | Redis list buffer (max 20, TTL 30 min); replayed on `join-video` |
| Per-video rooms | ✅ | `video-{videoId}` rooms; no global channel |
| Connection limits | ✅ | 100 global, 5 per IP, 10 rooms per socket |

**Solution — Redis-buffered Socket.IO:**
```typescript
emitVideoStatus(videoId, status, data) {
  const room = io.sockets.adapter.rooms.get(`video-${videoId}`);
  if (!room || room.size === 0) {
    // No active listeners — buffer for replay on reconnect
    redisClient.rPush(`video:msgbuf:${videoId}`, JSON.stringify(payload));
    return;
  }
  io.to(`video-${videoId}`).emit("video-status", payload);
}
```

On `join-video`, server replays buffered messages → browser transitions to correct state without polling. Prevents the common "tab was closed during processing, comes back to stale PROCESSING status" UX problem.

---

### FR-5: Video Library

| Requirement | Status | Implementation |
|-------------|--------|---------------|
| List all videos | ✅ | `GET /api/videos` → MongoDB, sorted by `createdAt` desc |
| Filter by status | ✅ | Status filter chips; `useMemo` filter in `VideoList.tsx` |
| Search by title/description | ✅ | Case-insensitive `includes()` filter |
| Delete video | ✅ | `DELETE /api/videos/:id`; hover trash button on thumbnail |
| Thumbnail display | ✅ | `apiService.getThumbnailUrl(videoId)` + `onError` fallback |

**Thumbnail fallback pattern:**
```tsx
// Always render fallback div (visible if img absent/fails)
<div className="absolute inset-0 flex items-center justify-center ...">
  <Play ... />
</div>
// Img layered on top for READY videos; hidden on error
{video.status === VideoStatus.READY && (
  <img
    src={apiService.getThumbnailUrl(video.id)}
    onError={(e) => { e.currentTarget.style.display = "none"; }}
    className="absolute inset-0 h-full w-full object-cover ..."
  />
)}
```

---

### FR-6: Notifications

| Requirement | Status | Implementation |
|-------------|--------|---------------|
| In-app notification centre | ✅ | Bell icon; unread badge count |
| Persist across refresh | ✅ | `POST /api/notifications` on webhook; loaded from DB on mount |
| Status-specific icons | ✅ | CheckCircle2, AlertTriangle, Loader2, UploadCloud |
| Click-to-watch on READY | ✅ | Navigates to `/watch/:videoId` |
| Progress milestones | ✅ | Checkpoints at 10, 25, 50, 75, 90, 100% from `processing-progress` events |

---

## Non-Functional Requirements

### NFR-1: Reliability — Idempotent Webhooks

ECS tasks can run twice (Spot interruption + retry, Lambda timeout, SQS redeliver). The second webhook must not downgrade a READY video to ERROR.

```typescript
// Both methods use { $ne: READY } — atomic, no race condition
markVideoAsReady(videoId, manifestUrl) {
  return Video.findOneAndUpdate(
    { _id: videoId, status: { $ne: VideoStatus.READY } },
    { $set: { status: VideoStatus.READY, manifestUrl } },
    { new: true }
  );
}
```

Returns `null` if already READY → webhook handler responds 200 "Ignored" → no duplicate socket event.

### NFR-2: Performance

| Metric | Target | How |
|--------|--------|-----|
| Upload non-blocking | instant | S3 presigned; server returns on confirm only |
| Processing non-blocking | instant | SQS decoupling |
| API response < 200 ms p95 | ✅ | MongoDB indexed; Redis rate limit state |
| Streaming start < 2 s | ✅ | CloudFront edge cache; small init segment |

### NFR-3: Rate Limiting

Seven tiers, Redis sliding window (sorted sets), in-memory fallback:

| Limiter | Window | Limit | Key prefix |
|---------|--------|-------|-----------|
| upload | 15 min | 20 | `upload:<ip>` |
| general | 15 min | 100 | `rate_limit:default:<ip>` |
| streaming | 1 min | 300 | `stream:<ip>` |
| status | 1 min | 60 | `status:<ip>` |
| search | 1 min | 30 | `search:<ip>` |
| webhook | 1 min | 100 | `webhook:<ip>` |
| auth | 15 min | 10 | `auth:<ip>` |

**Sliding window implementation:**
```typescript
pipeline.zRemRangeByScore(key, 0, windowStart)  // evict old entries
pipeline.zAdd(key, { score: now, value: unique }) // record this hit
pipeline.zCard(key)                               // count in window
pipeline.expire(key, windowSeconds)               // auto-cleanup
// node-redis v4: exec() returns raw values — results[2] is number directly, not [err, value]
```

`TRUST_PROXY=true` required in prod — without it, all requests appear from the ALB IP and share one bucket.

### NFR-4: Circuit Breakers

Three breakers wrap all external calls (`opossum`):

```typescript
// Opens after 5 failures, recovers after 60s
s3Breaker  = new CircuitBreaker(s3Call,  { timeout: 5000, errorThresholdPercentage: 50, resetTimeout: 60000 });
dbBreaker  = new CircuitBreaker(dbCall,  { timeout: 3000, errorThresholdPercentage: 50, resetTimeout: 60000 });
sqsBreaker = new CircuitBreaker(sqsCall, { timeout: 5000, errorThresholdPercentage: 50, resetTimeout: 60000 });
```

While open, calls fail immediately instead of hanging for the full timeout. Prevents cascading failures under dependency outages.

### NFR-5: Security

- **Presigned URL expiry** — 15-min TTL; client checks clock before upload
- **Magic-byte validation** — prevents MIME spoofing
- **Rate limiting** — 7 tiers; Redis-backed in prod
- **CORS** — `FRONTEND_URL` comma-separated; no wildcard
- **No credentials in code** — EC2 instance profile for AWS SDK; secrets via env vars
- **ECS in private subnets** — `assignPublicIp: DISABLED`; outbound via NAT
- **MongoDB + Redis in private subnets** — no public IP; accessible from backend SG only

### NFR-6: Observability

- Structured JSON logging (`pino`; `LOG_LEVEL` env)
- `GET /api/webhook/health` returns live Socket.IO connection count
- Rate limit headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- `ApiError` class distinguishes operational errors (message exposed) from internal (generic message in prod)
