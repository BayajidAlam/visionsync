# VisionSync — Architecture

## Overview

VisionSync is an event-driven video upload and adaptive-streaming platform built on AWS. A client uploads a raw video directly to S3 via presigned URL; an S3 event notification triggers an async pipeline that transcodes the file into DASH format using FFmpeg on ECS Fargate; the result is served from CloudFront while the browser receives real-time progress over Socket.IO.

---

## High-Level Data Flow

```
Browser (React + dash.js)
  │
  │  1. POST /api/upload/generate-presigned-url
  ▼
Express Server (EC2 private, behind ALB)
  │
  │  2. Return presigned S3 PUT URL + videoId
  ▼
Browser
  │
  │  3. PUT video file directly to S3 (no server proxy)
  ▼
S3 Raw Bucket  ──[S3 Event Notification]──►  SQS Queue
                                                  │
                                                  │  4. Trigger Lambda
                                                  ▼
                                            Lambda (SQS trigger)
                                                  │
                                                  │  5. RunTask (ECS Fargate / Fargate Spot)
                                                  ▼
                                         ECS Fargate Task (FFmpeg container)
                                                  │
                                                  │  6. Download raw → encode DASH → upload segments
                                                  ▼
                                         S3 Processed Bucket  ──►  CloudFront CDN
                                                  │
                                                  │  7. POST /api/webhook/processing-complete
                                                  ▼
                                         Express Server
                                                  │
                                                  │  8. Update MongoDB + emit Socket.IO event
                                                  ▼
                                               Browser
                                                  │
                                                  │  9. dash.js loads manifest.mpd from CloudFront
                                                  ▼
                                            DASH adaptive playback
```

---

## Infrastructure Components

| Component | Service | Purpose |
|-----------|---------|---------|
| Frontend host | EC2 (public subnet) | Nginx serving React SPA |
| Backend host | EC2 (private subnet) | Express + Socket.IO API |
| Load balancer | ALB | Routes HTTP → backend, terminates TLS when cert configured |
| Database | EC2 × 3 (MongoDB replica set) | Video metadata, notifications |
| Cache | EC2 (Redis) | Rate limiting, Socket.IO message buffer |
| Raw storage | S3 | Receives presigned uploads |
| Processed storage | S3 | DASH segments + manifest + thumbnails |
| CDN | CloudFront | Low-latency segment delivery |
| Event queue | SQS | Decouples upload from processing |
| Orchestrator | Lambda | Reads SQS, starts ECS Fargate task |
| Transcoder | ECS Fargate | Runs FFmpeg container |
| IaC | Pulumi (TypeScript) | Provisions and manages all AWS resources |

---

## Network Topology

```
Internet
  │
  ├── ALB (public subnet, ports 80/443)
  │     └── Backend EC2 (private subnet :5000)
  │           ├── MongoDB Primary    (private :27017)
  │           ├── MongoDB Secondary1 (private :27017)
  │           ├── MongoDB Secondary2 (private :27017)
  │           └── Redis              (private :6379)
  │
  ├── Frontend EC2 (public subnet :80) — Nginx
  │
  └── Bastion EC2 (public subnet :22) — SSH jump host

ECS Fargate Tasks — private subnets, NAT gateway for outbound
Lambda             — VPC-attached, private subnets
S3 / SQS / CloudFront — AWS-managed
```

---

## Package Breakdown

### `client/` — React SPA
- Vite + React 18 + Tailwind + shadcn/ui
- `src/service/api.ts` — `ApiService` class; `VITE_API_URL` and `VITE_CLOUDFRONT_URL` build-time vars
- **dashjs loaded as UMD global** in `index.html` — NOT imported through Vite; Rollup mis-initialises its embedded webpack module system leaving `window.dashjs.MediaPlayer` undefined at runtime
- `VideoWatch.tsx` — uses `apiService.getManifestUrl(videoId)` (constructs URL from `VITE_CLOUDFRONT_URL`), never `video.manifestUrl` from DB (stale after CF distribution replacement)
- `VideoList.tsx` — thumbnail via `apiService.getThumbnailUrl(videoId)` + `onError` fallback for same reason
- Upload validates magic bytes before network (MP4/MOV `ftyp`, AVI `RIFF`, WebM EBML, OGG `OggS`)
- Presigned URL `expiresAt` checked against client clock with 30 s buffer before XHR starts

### `server/` — Express API
- Routes: `/api/upload`, `/api/videos`, `/api/webhook`, `/api/notifications`
- `src/config/env.ts` — all env vars; `TRUST_PROXY=true` required behind ALB for real client IP in rate limiting
- `src/config/circuitBreaker.ts` — `s3Breaker`, `dbBreaker`, `sqsBreaker`; opens after 5 failures, recovers after 60 s
- `src/middleware/rateLimiting.ts` — Redis sliding-window (sorted sets); in-memory fallback with 5-min purge
- `src/services/videoService.ts` — `setVideoError` / `markVideoAsReady` use `{ $ne: VideoStatus.READY }` to block duplicate webhook clobbering
- `src/socket/socketService.ts` — per-`videoId` rooms; buffers up to 20 events in Redis for 30 min for late-joining clients

### `lambda/` — SQS trigger
- `src/index.ts` triggered by S3 ObjectCreated notifications on raw bucket
- Extracts `videoId` from key path `videos/<videoId>/<filename>`
- Uses `FARGATE_SPOT` for files < 1 GB; retries with on-demand Fargate if Spot capacity fails in same invocation
- Does NOT override `WEBHOOK_URL` — task definition has correct ALB URL hardcoded; override with empty string silently breaks the container

### `container/` — FFmpeg processor
- `src/process-video.ts` — download S3 raw → FFmpeg DASH encode → upload segments + `manifest.mpd` to S3 processed → POST webhook

### `IaC/` — Pulumi (TypeScript)
- Provisions VPC, ALB, EC2, ECS cluster, S3, SQS, Lambda, CloudFront, MongoDB replica set, Redis
- Outputs cached to `.env.infra` via `make save-outputs`

---

## Video Processing Pipeline

### Stage 1 — S3 → SQS

S3 sends `ObjectCreated` for keys matching `videos/*`. SQS provides natural retry (message stays in queue on Lambda failure).

```json
{
  "Records": [{
    "s3": {
      "bucket": { "name": "vision-sync-raw-videos-dev" },
      "object": { "key": "videos/<videoId>/original.mp4", "size": 52428800 }
    }
  }]
}
```

### Stage 2 — Lambda: Parse + Orchestrate

```typescript
// Extract videoId from S3 key
const videoId = s3Key.split("/")[1];

// Capacity selection
const isUrgent = fileSize > 1_073_741_824;           // ≥ 1 GB
const useSpot = !isUrgent && Math.random() * 100 < 70; // 70% Spot

// Spot failure fallback (same invocation, no re-queue)
if (useSpot && failure.reason?.includes("RESOURCE")) {
  // retry with FARGATE on-demand
}
```

Does NOT override `WEBHOOK_URL` — task definition has correct ALB URL.

### Stage 3 — ECS Fargate: FFmpeg DASH Encode

Runs in private subnet (`assignPublicIp: DISABLED`). Outbound via NAT Gateway.

| Resolution | Bitrate | Segment |
|-----------|---------|---------|
| 1080p | 4500 kbps | 4 s |
| 720p | 2500 kbps | 4 s |
| 480p | 1200 kbps | 4 s |
| 360p | 600 kbps | 4 s |
| Audio | 128 kbps AAC | 4 s |

**Output S3 structure:**
```
s3://vision-sync-processed-videos-dev/<videoId>/
  ├── manifest.mpd
  ├── init-1.m4s, init-4.m4s        (video + audio init segments)
  ├── chunk-1-1.m4s … chunk-1-N.m4s (video representation, ~1.6 MB each)
  ├── chunk-4-1.m4s … chunk-4-N.m4s (audio representation, ~3.8 kB each)
  └── thumbnail.jpg
```

Segment naming: `chunk-{representation}-{segment}.m4s`. Highest representation = audio (tiny). Video representations 1–N sorted by quality.

### Stage 4 — Webhook → Express

```json
POST /api/webhook/processing-complete
{ "videoId": "...", "status": "ready", "manifestUrl": "https://<cf>/<videoId>/manifest.mpd" }
```

Idempotent via `{ $ne: READY }` MongoDB filter — duplicate tasks cannot clobber a successful result.

### Stage 5 — Socket.IO Notification

```
Room active    → io.to("video-{videoId}").emit("video-status", payload)
Room empty     → redisClient.rPush("video:msgbuf:{videoId}", payload) [max 20, TTL 30 min]
Late join      → server replays buffer → browser gets missed events instantly
```

### Status Transitions

```
UPLOADING → UPLOADED → PROCESSING → READY
                                 ↘ ERROR

READY is terminal — { $ne: READY } prevents any backward transition
```

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Presigned S3 upload | Video bytes never transit Express — no bandwidth cost, no memory pressure |
| S3 → SQS → Lambda → ECS | Fully decoupled; upload returns instantly, processing is async |
| Fargate Spot for < 1 GB | ~70% cost saving; same-invocation on-demand fallback prevents failures |
| DASH over HLS | Native browser support; dash.js handles ABR without polyfills |
| Redis message buffer (30 min) | Late-joining clients replay missed events without polling |
| MongoDB `{ $ne: READY }` | Idempotent webhook — duplicate ECS tasks cannot downgrade READY to ERROR |
| Circuit breakers on S3/DB/SQS | Fail fast; prevents cascading failures under dependency outages |
| `TRUST_PROXY=true` prod-only | ALB sets `X-Forwarded-For`; enabling in dev allows IP spoofing in rate limit keys |
| Redis on EC2 (not ElastiCache) | Saves $30–80/month; same instance serves both rate limiting and socket buffer |
| MongoDB on EC2 (not Atlas) | Saves ~$135/month vs M10 × 3 Atlas; cost of operational overhead acceptable at this scale |
