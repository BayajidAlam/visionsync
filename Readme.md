# VisionSync: Scalable Cloud-Native Video Streaming Platform

VisionSync is an on-demand video streaming platform — upload a video, get back adaptive DASH streams at multiple quality levels, delivered via CloudFront CDN with real-time status updates.

![VisionSync](https://github.com/user-attachments/assets/fd472f19-4583-4f34-a477-12f44d3de38e)

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Folder Structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Deployment Commands](#deployment-commands)
- [Video Processing Pipeline](#video-processing-pipeline)
- [API Reference](#api-reference)
- [Troubleshooting](#troubleshooting)

---

## Architecture

![System Architecture]()

**Infrastructure zones:**

| Zone | Components |
|------|-----------|
| Public Subnets | ALB, Frontend EC2 (Nginx), Bastion |
| Private Subnets | Backend EC2, MongoDB ×3, Redis |
| AWS Managed | S3, SQS, Lambda, ECS Fargate, CloudFront, ECR |

All infrastructure provisioned via Pulumi (TypeScript). Databases configured via Ansible over bastion.

### Network Topology

![Network Topology]()

---

## Features

- **Presigned S3 upload** — video bytes never touch Express; upload progress + speed tracked via XHR
- **Magic-byte validation** — MP4/MOV (`ftyp`), AVI (`RIFF`), WebM (EBML), OGG (`OggS`) checked client-side before any network call
- **Async processing pipeline** — S3 → SQS → Lambda → ECS Fargate; upload returns immediately
- **FFmpeg DASH encoding** — 1080p/720p/480p/360p renditions, 4-second segments, 128k AAC
- **Adaptive streaming** — dash.js UMD global; ABR quality switching with buffer flush on manual change
- **Fargate Spot** — files < 1 GB use FARGATE_SPOT (70% probability); on-demand fallback in same Lambda invocation
- **Real-time status** — Socket.IO rooms per `videoId`; Redis buffers up to 20 events per video for late-joining clients
- **Idempotent webhooks** — `{ $ne: VideoStatus.READY }` MongoDB filter prevents duplicate ECS task from clobbering final state
- **Redis sliding-window rate limiting** — 7 tiers (upload, general, streaming, status, search, webhook, auth); in-memory fallback
- **Circuit breakers** — `opossum` wraps S3, MongoDB, SQS calls; opens after 5 failures, resets after 60 s
- **Structured logging** — `pino` JSON output; `LOG_LEVEL` env controls verbosity

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, dash.js, Socket.IO client |
| Backend | Node.js 18+, Express, TypeScript, Socket.IO, Mongoose, AWS SDK v3, opossum, pino |
| Video processor | Node.js, FFmpeg, AWS SDK v3 (runs in ECS Fargate container) |
| Lambda | Node.js 18, AWS SDK v3 — SQS trigger, ECS RunTask orchestration |
| Database | MongoDB 6 replica set (1 primary + 2 secondary), Redis 7 |
| IaC | Pulumi (TypeScript) |
| Config mgmt | Ansible |
| AWS services | EC2, ECS Fargate, Lambda, S3, SQS, ALB, CloudFront, ECR, NAT Gateway |

---

## Folder Structure

```
/client         React SPA — video upload, library, DASH player
/server         Express API — upload, video, webhook, notification routes
/container      FFmpeg processor — runs as ECS Fargate task
/lambda         SQS trigger — launches ECS task (Spot vs on-demand logic)
/IaC            Pulumi infrastructure — VPC, EC2, ECS, S3, ALB, CloudFront…
/ansible        Playbooks — MongoDB replica set setup, Redis Docker deploy
/docs           Architecture diagrams (.excalidraw), REQUIREMENTS, OPERATIONS, COST_ANALYSIS
Makefile        All deploy / ops commands
```

---

## Prerequisites

- AWS CLI configured (`aws configure`)
- Node.js 18+, npm
- Docker 20.10+
- Pulumi CLI + account (`pulumi login`)
- Ansible (`pip install ansible`)
- Make

---

## Getting Started

### Local Development

```bash
# Install all workspace dependencies
make install

# Start server (:5000) + client (:5173) concurrently
make dev
```

**server/.env** (copy from `server/.env.example`):

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/vision-sync
REDIS_URL=redis://localhost:6379
AWS_REGION=ap-southeast-1
S3_BUCKET_RAW=<your-raw-bucket>
S3_BUCKET_PROCESSED=<your-processed-bucket>
SQS_QUEUE_URL=<your-sqs-url>
FRONTEND_URL=http://localhost:5173
```

**client/.env**:

```env
VITE_API_URL=http://localhost:5000
VITE_CLOUDFRONT_URL=https://<your-cf-domain>
```

### Cloud Deployment (Step by Step)

```bash
# 1. Provision AWS infrastructure
make deploy

# 2. Populate server/.env with live resource values
make update-env

# 3. Set up databases (MongoDB replica set + Redis)
make setup-all-db

# 4. Build and push container images to ECR
make push-containers

# 5. Deploy backend + frontend
make deploy-prod
```

After `make destroy` + re-deploy, run `make deploy-client` to bake the new CloudFront domain into the client build.

---

## Deployment Commands

```bash
# Infrastructure
make deploy              # pulumi up — provision all AWS infra
make destroy             # tear down all infra (prompts confirmation)
make outputs             # print stack outputs (IPs, URLs, bucket names)
make update-env          # patch server/.env from Pulumi outputs
make save-outputs        # save Pulumi outputs to .env.infra

# Containers
make push-containers     # build + push server + client images to ECR
make deploy-processor    # build + push ECS video processor image
make deploy-lambda       # package + update Lambda function

# Application deploy
make deploy-server       # build image → push ECR → restart backend container
make deploy-client       # build client image on frontend EC2
make deploy-prod         # deploy-server + deploy-client + status-prod

# Database
make setup-mongodb       # configure MongoDB replica set via Ansible
make setup-redis         # deploy Redis via Ansible
make setup-all-db        # both
make check-mongodb       # verify replica set health
make check-redis         # ping Redis through bastion

# Ops
make status-prod         # container status + ALB health
make logs-server-prod    # tail backend container logs
make logs-frontend       # tail frontend container logs
make ssh-backend-prod    # SSH into backend EC2 via bastion
make ssh-frontend        # SSH into frontend EC2

# Dev
make install             # install all workspace dependencies
make build               # build all packages
make dev                 # start server + client in development mode
make clean               # remove build artifacts
```

---

## Video Processing Pipeline

![Pipeline]()

```
1. Browser   POST /api/upload/generate-presigned-url
             ← { presignedUrl, videoId, expiresAt }

2. Browser   PUT <presignedUrl>  (direct to S3 — no server bandwidth)

3. Browser   POST /api/upload/confirm/:videoId
             Server sets status → UPLOADED

4. S3        ObjectCreated event on videos/* key → SQS message

5. Lambda    Triggered by SQS; extracts videoId from key path
             File < 1 GB → FARGATE_SPOT (70% probability), else on-demand

6. ECS       Downloads raw video from S3
             FFmpeg DASH encode: 1080p·4500k / 720p·2500k / 480p·1200k / 360p·600k + 128k AAC
             4-second segments → manifest.mpd + chunk-{r}-{n}.m4s + thumbnail.jpg
             Uploads all to S3 processed bucket

7. ECS       POST /api/webhook/processing-complete
             { videoId, status: "ready", manifestUrl }

8. Server    MongoDB update with { $ne: READY } guard (idempotent)
             Socket.IO emits video-status to video-{videoId} room

9. Browser   dash.js initializes against CloudFront CDN URL
             ABR switches quality based on available bandwidth
```

Status sequence: `UPLOADING → UPLOADED → PROCESSING → READY` (or `ERROR`)

---

## API Reference

### Upload

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/upload/generate-presigned-url` | Create video record + return S3 presigned PUT URL |
| `POST` | `/api/upload/confirm/:id` | Mark video UPLOADED, trigger processing |

**generate-presigned-url body:** `{ fileName, fileType, fileSize }`
**Response:** `{ data: { presignedUrl, videoId, expiresAt }, message }`

### Videos

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/videos` | List all videos (sorted by createdAt desc) |
| `GET` | `/api/videos/search` | Search by title/description |
| `GET` | `/api/videos/status/:status` | Filter by status |
| `GET` | `/api/videos/stats/overview` | Video count by status |
| `GET` | `/api/videos/:id` | Get single video |
| `GET` | `/api/videos/:id/status` | Get video status |
| `PUT` | `/api/videos/:id` | Update video metadata |
| `DELETE` | `/api/videos/:id` | Delete video + S3 files |
| `GET` | `/api/videos/:id/manifest.mpd` | Redirect to CloudFront manifest URL |
| `GET` | `/api/videos/:id/segments/:segment` | Proxy segment from S3 |

### Webhook (internal — called by ECS)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/webhook/processing-complete` | Update video status, emit socket event |
| `GET` | `/api/webhook/health` | `{ status: "ok", connections: N }` |

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/notifications` | List notifications |

### Rate Limits

| Endpoint group | Window | Limit |
|----------------|--------|-------|
| upload | 15 min | 20 |
| general (default) | 15 min | 100 |
| streaming | 1 min | 300 |
| status | 1 min | 60 |
| search | 1 min | 30 |
| webhook | 1 min | 100 |
| auth | 15 min | 10 |

Headers on every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

### Socket.IO Events

**Client → Server:**

```js
socket.emit('join-video', videoId)   // join room, replays buffered events
socket.emit('leave-video', videoId)  // leave room
socket.emit('join-user', userId)     // join user-level room
```

**Server → Client:**

```js
socket.on('video-status', ({ videoId, status, data }) => { ... })
socket.on('processing-progress', ({ videoId, progress, stage }) => { ... })
socket.on('error', (message) => { ... })
```

---

## Troubleshooting

See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** for detailed troubleshooting covering:

- BASTION_IP empty / `.env.infra` stale
- CORS blocked — `Origin not allowed`
- Video stuck at PROCESSING
- Socket.IO not connecting (ALB sticky sessions)
- Rate limit 429 — Redis key flush commands
- Pulumi state drift / locked stack

**Quick diagnostics:**

```bash
make status-prod
make logs-server-prod
make check-mongodb
make check-redis
curl $ALB/api/webhook/health
```

---

## Cost Summary (~$130/month)

| Component | Monthly |
|-----------|---------|
| EC2 (bastion, frontend, backend, MongoDB ×3, Redis) | ~$93 |
| Storage + networking (S3, ALB, NAT, CloudFront) | ~$37 |
| ECS Fargate (50 videos/month, 70% Spot) | ~$0.18 |


See **[docs/COST_ANALYSIS.md](docs/COST_ANALYSIS.md)** for full breakdown and at-scale projections.
