# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
# Install all workspace dependencies
make install

# Run server + client concurrently (server on :5000, client on :5173)
make dev

# Or individually
cd server && npm run dev    # tsx watch (hot reload)
cd client && npm run dev    # vite

# Build all
make build

# Lint
cd server && npm run lint
cd client && npm run lint
```

### Infrastructure
```bash
make deploy           # pulumi up (provisions all AWS infra) + saves outputs + patches server/.env
make outputs          # show live stack values (IPs, URLs, bucket names)
make save-outputs     # cache Pulumi outputs to .env.infra (needs PULUMI_CONFIG_PASSPHRASE)
make update-env       # patch server/.env with current Pulumi outputs
make destroy          # tear down all infra (prompts for confirmation)

# Database setup (runs via Ansible over bastion)
make setup-all-db     # MongoDB replica set + Redis
make check-mongodb    # verify replica set health
make check-redis      # ping Redis through bastion

# Deploy application
make deploy-server    # build Docker image → push ECR → restart backend container
make deploy-client    # build client image on frontend host
make deploy-lambda    # build lambda zip → update function code directly (no pulumi)
make deploy-processor # build FFmpeg processor image → push ECR
make deploy-prod      # server + client + processor + lambda + status
make full-deploy      # first-time setup after pulumi up: DB setup + all app components

# Operations
make logs-server-prod # tail backend container logs
make logs-frontend    # tail frontend container logs
make status-prod      # container status + ALB health check
make ssh-frontend     # SSH directly to frontend EC2
make ssh-backend-prod # SSH to backend EC2 via bastion jump
```

## Architecture

5 independent TypeScript packages communicate through AWS services:

```
client (Vite/React)
    ↓ presigned PUT
    S3 raw bucket  →  S3 event notification  →  SQS
                                                  ↓
                                              lambda (SQS trigger)
                                                  ↓ RunTask
                                              container (ECS Fargate)
                                                  ↓ FFmpeg → S3 processed bucket
                                                  ↓ POST /api/webhook/processing-complete
server (Express)  ←──────────────────────────────┘
    ↓ Socket.IO
client (real-time status)
```

### `server/` — Express API
- Entry: `src/server.ts` → `src/app.ts`
- Routes: `/api/upload`, `/api/videos`, `/api/webhook`, `/api/notifications`
- `src/config/env.ts` — all env vars; `TRUST_PROXY=true` required behind ALB for IP-based rate limiting
- `src/config/logger.ts` — structured JSON to stdout/stderr; respects `LOG_LEVEL` env (`debug|info|warn|error`, default `info`)
- `src/config/circuitBreaker.ts` — `s3Breaker`, `dbBreaker`, `sqsBreaker` wrap external calls; opens after 5 failures, recovers after 60s
- `src/middleware/rateLimiting.ts` — custom Redis sliding-window limiter (sorted sets); falls back to in-memory with 5-min purge. Uses `RATE_LIMIT_STORE=redis` in prod
- `src/middleware/caching.ts` — `responseCache()` middleware wraps `res.json` to cache 200 responses in Redis; `CacheMiddleware` exports pre-tuned instances per route (metadata 5m, list 2m, status 30s, manifest 1h). **Redis is used for two distinct purposes**: rate limiting (sorted sets) and response caching (string keys) — both share the same connection but use separate key namespaces (`rate_limit:*` vs `video:*`)
- `src/services/videoService.ts` — all DB ops; `setVideoError` and `markVideoAsReady` use `{ $ne: VideoStatus.READY }` MongoDB filter to prevent duplicate webhook clobbering
- `src/services/searchService.ts` — `SearchService.basicSearch()` uses MongoDB `$regex` (case-insensitive) across title/description/filename; supports `SearchFilters` (status, date range, duration, fileSize) and `SearchOptions` (pagination, sort). Current approach; Elasticsearch/Atlas Search/Typesense alternatives documented inline as `ADVANCED_SEARCH_SOLUTIONS` export
- `src/socket/socketService.ts` — Socket.IO rooms per `videoId`; buffers up to 20 messages per video in Redis for 30 min (late-joining clients get missed events); limits: 100 max connections, 5 per IP, 10 rooms per connection
- `src/services/notificationService.ts` — persists notifications to DB; client fetches on mount to restore history across page reloads
- **Route ordering in `src/routes/video.ts`**: `/search`, `/stats/overview`, and `/status/:status` must be registered before `/:id` routes or Express captures them as video IDs

### `client/` — React SPA
- Vite + React 18 + Tailwind + shadcn/ui
- Routes: `/` (App — feed/studio), `/watch/:id` (VideoWatch)
- `src/service/api.ts` — single `ApiService` class; `VITE_API_URL` and `VITE_CLOUDFRONT_URL` env vars
- `src/hooks/useSocket.ts` — manages Socket.IO connection; exposes `joinVideo`, `leaveVideo`, `videoStatus`, `progress`, `reconnect`
- **dashjs loaded as UMD global** via `<script>` in `index.html`. Do NOT import through Vite/bundler — Rollup and esbuild both mis-initialize its embedded webpack module system, leaving `window.dashjs.MediaPlayer` undefined. Access via `(window as any).dashjs`
- `VideoPlayer.tsx` — prefers `apiService.getManifestUrl(video.id)` (CDN URL) over `video.manifestUrl` (DB-stored) when `VITE_CLOUDFRONT_URL` set. Quality change uses `setQualityFor("video", index, true)` — `replace=true` flushes buffer so all chunks load at new resolution
- Upload validates magic bytes client-side before network (MP4/MOV `ftyp`, AVI `RIFF`, WebM EBML, OGG `OggS`)
- Presigned URLs include `expiresAt`; client checks clock before upload to catch skew/slow-network
- App only re-fetches from API on terminal states (READY/ERROR) to avoid rate limit exhaustion; intermediate states (UPLOADING, PROCESSING) applied via `videoStatusUpdate` prop on VideoList

### `lambda/` — SQS trigger
- Single handler `src/index.ts`; triggered by S3 event notifications on raw bucket
- Parses S3 event format (`Records[0].s3.bucket/object`); extracts `videoId` from key path `videos/<videoId>/<filename>`
- Starts ECS Fargate task; uses FARGATE_SPOT for files < 1 GB (configurable via `USE_FARGATE_SPOT`, `SPOT_PERCENTAGE`), falls back to on-demand if Spot unavailable
- **Does not override `WEBHOOK_URL` in container env** — ECS task definition has correct ALB URL hardcoded; overriding from Lambda env sets it to empty string

### `container/` — FFmpeg processor
- `src/process-video.ts` — downloads from S3 raw, runs FFmpeg DASH encode (4 renditions: 1080p/720p/540p/360p), uploads segments + manifest to S3 processed, POSTs webhook to server
- S3 upload batched in groups of 10 to avoid throttling the AWS SDK connection pool (a 1080p DASH output can have 200+ chunk files)
- Thumbnail extracted at 3s into video (falls back to frame 0 if video shorter than 3s), uploaded as `<videoId>/thumbnail.jpg`
- **SIGTERM handler mandatory for Spot instances** — AWS gives a 2-minute reclaim warning; handler sends error webhook so backend updates status and emits Socket.IO event; without it video stays stuck in PROCESSING

### `IaC/` — Pulumi (TypeScript)
- Provisions VPC, ALB, EC2 (frontend/backend), ECS cluster, S3, SQS, Lambda, CloudFront, MongoDB EC2 replica set, Redis EC2
- Stack outputs (IPs, URLs, connection strings) read by `make update-env` to patch `server/.env`
- Raw videos bucket: 7-day lifecycle (deleted after processing), versioning suspended
- Processed videos bucket: private (all access via CloudFront OAC, not OAI); versioning enabled
- CloudFront caching: `.mpd` manifests 5-min TTL (change during ABR adaptation); `.m4s` segments 1-year TTL (immutable once written)

## S3 Key Structure

- Raw uploads: `videos/<videoId>/<filename>` (e.g. `videos/abc123/original.mp4`)
- Processed output: `<videoId>/manifest.mpd`, `<videoId>/init-1080p.m4s`, `<videoId>/chunk-1080p-seg1.m4s`, ..., `<videoId>/thumbnail.jpg`
- Quality labels: `1080p`, `720p`, `540p`, `360p`, `audio` — FFmpeg RepresentationIDs (0–4) are renamed post-encode by `renameSegmentsWithQualityLabels()` before S3 upload; the MPD's `Representation id` attributes and `media` template are patched to match

## Key Patterns

**node-redis v4 pipeline:** `pipeline.exec()` returns raw values, not `[err, value]` tuples. `results[2]` from `zCard` is number directly, not `[null, number]`.

**`ApiError` class** (`server/src/types/index.ts`): throw `ApiError.notFound()` / `ApiError.badRequest()` / `ApiError.internal()` in routes, pass to `next()`. Global error handler in `src/middleware/index.ts` distinguishes `isOperational` errors (expose message) from internal (generic message in prod).

**Rate limit key format:** `rate_limit:<prefix>:<ip>` global; `upload:<ip>`, `user:<userId>:<req.path>` scoped.

**Local env vars:**
- `server/.env` — copy from `server/.env.example`; requires `MONGODB_URI`, `REDIS_URL`, `S3_BUCKET_RAW`, `S3_BUCKET_PROCESSED`, `SQS_QUEUE_URL`, `AWS_REGION`, `CLOUDFRONT_DOMAIN`
- `client/.env` — `VITE_API_URL=http://localhost:5000`, `VITE_CLOUDFRONT_URL=<your-cf-domain>`
- `TRUST_PROXY=true` prod only (behind ALB); omit locally or rate limiting uses wrong IP
- `.env.infra` — auto-generated by `make save-outputs`; caches Pulumi outputs so deploy targets work without re-querying the Pulumi stack
