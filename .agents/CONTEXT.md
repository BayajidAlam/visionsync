# VisionSync — Project Context
> **This is the single source of truth for the entire project.**
> Every agent, skill, and AI conversation should read this file first.
> File location: `.agents/CONTEXT.md`

---

## 🎯 What This Project Is

**VisionSync** is a production-ready, cloud-native **video streaming platform** built on AWS.

Users upload videos → they are automatically transcoded into adaptive DASH format → delivered globally via CloudFront CDN with real-time status updates.

---

## 📊 Documentation & Diagrams (Excalidraw)

**Rule:** Whenever an agent explains a data flow, process, architecture, or complex logic, it **MUST** generate a raw `.excalidraw` JSON block.
*Why?* The user requires diagrams to be directly copy-pasteable as Excalidraw files for visual documentation. **DO NOT** use Mermaid. Always output Excalidraw JSON in a code block.

---

## 🏗️ Architecture at a Glance

```
User Browser
    │
    ├─── HTTPS ──→ CloudFront CDN (global delivery of processed videos)
    │
    └─── HTTP/WS → ALB (Application Load Balancer)
                       │
               Backend EC2 ASG (1–5 instances, private subnet)
               Node.js + Express + Socket.IO  [port 5000]
                  │          │
              MongoDB RS   Redis EC2
              (3 nodes)   (1 node)
              zone 1c     zone 1c

S3 Raw Bucket ──(Event Notification)──→ SQS Queue → Lambda Fn
                                                          │
                                                   ECS Fargate Task
                                                   (FFmpeg container)
                                                          │
                                                   S3 Processed Bucket
                                                          │
                                                   CloudFront CDN ──→ User (DASH.js player)
```

### Data Flow (End-to-End)
```
1.  User requests presigned URL  → POST /api/upload/generate-presigned-url
                                   Backend creates MongoDB record (status: UPLOADING)
                                   Returns presigned URL + videoId to client
2.  User uploads directly to S3  → S3 raw bucket (no backend involved in transfer)
3.  S3 fires Event Notification  → SQS queue automatically (upload complete trigger)
4.  Lambda triggered by SQS      → reads videoId + fileSize, launches ECS Fargate task
                                   Spot (70%) if file < 1GB, Regular (30%) otherwise
                                   If Spot unavailable → auto-retry on Regular
5.  ECS container (FFmpeg)       → downloads from S3 raw, transcodes all resolutions
                                   Regular: 1080p/720p/480p/360p | Spot: 720p/480p/360p
6.  ECS uploads chunks + MPD     → S3 processed bucket
7.  ECS sends webhook            → POST /api/webhook/processing-complete
8.  Backend updates MongoDB      → status: READY, stores CloudFront manifest URL
9.  Backend emits Socket.IO      → to videoId room → Frontend receives event
10. Frontend plays video         → DASH.js streams from CloudFront URL
```

---

## 📁 Folder Structure

| Folder | Purpose | Key Tech |
|--------|---------|---------|
| `server/` | Backend API + WebSocket server | Node.js, Express, TypeScript, Socket.IO |
| `client/` | Frontend SPA | React, TypeScript, Vite, DASH.js, Shadcn UI |
| `container/` | Video transcoding worker | FFmpeg, Node.js, AWS SDK v3 |
| `lambda/` | ECS task orchestrator | Node.js, AWS SDK v3 |
| `IaC/` | Cloud infrastructure | Pulumi, TypeScript |
| `ansible/` | Server configuration & deployment | Ansible, Jinja2 |
| `Makefile` | Deployment automation | GNU Make |
| `doc/` | Architecture documentation | Markdown |

---

## ⚙️ Environment Variables (Canonical List)

All from `server/src/config/env.ts`. **Required** vars (app won't start without these):

```bash
# AWS Core
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# S3
S3_BUCKET_RAW=           # Landing zone for user uploads
S3_BUCKET_PROCESSED=     # FFmpeg output: chunks + manifest.mpd

# Messaging
SQS_QUEUE_URL=           # Video processing queue

# Database
MONGODB_URI=             # Replica set URI: mongodb://ip1,ip2,ip3/vision-sync?replicaSet=rs0

# Optional (have defaults)
REDIS_URL=redis://localhost:6379
REDIS_HOST=localhost
REDIS_PORT=6379
CLOUDFRONT_DOMAIN=       # cdn.example.com — serves processed videos
CLOUDFRONT_DISTRIBUTION_ID=
ECS_CLUSTER_NAME=
ECS_TASK_DEFINITION=
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000   # 15 min
RATE_LIMIT_MAX_REQUESTS=100
UPLOAD_RATE_LIMIT_MAX=5       # Max 5 uploads per window

# ECS / Video Processing
ECS_USE_FARGATE_SPOT=true
ECS_SPOT_PERCENTAGE=70        # 70% Spot, 30% Regular
ECS_TASK_CPU=1024             # 1 vCPU
ECS_TASK_MEMORY=2048          # 2 GB
FFMPEG_PRESET=fast            # fast=Regular, medium=Spot
FFMPEG_THREADS=2
```

---

## 🌐 API Endpoints

### Video Routes (`/api/videos`)
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | List all videos |
| `GET` | `/:id` | Get single video by ID |
| `GET` | `/:id/status` | Get video processing status |
| `GET` | `/search?q=` | Search videos by title/description |
| `GET` | `/stats/overview` | Video platform statistics |
| `GET` | `/status/:status` | Filter videos by status |
| `GET` | `/:id/manifest.mpd` | Redirect to DASH manifest on S3 |
| `GET` | `/:id/segments/:segment` | Redirect to video segment on S3 |
| `PUT` | `/:id` | Update video title/description |
| `DELETE` | `/:id` | Delete video |

### Upload Routes (`/api/upload`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/generate-presigned-url` | Get S3 presigned URL + create MongoDB record (status: UPLOADING) |
| `POST` | `/confirm/:id` | Client calls after S3 upload to update status to UPLOADED (UI feedback only — processing is triggered independently by S3 Event Notification) |

### Webhook Routes (`/api/webhook`)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/processing-complete` | ECS container notifies processing done |
| `GET` | `/health` | Service health check |

### Health
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | ALB health check — must return 200 |

---

## 🔌 Socket.IO Events

| Event | Direction | Payload | When |
|-------|---------|---------|------|
| `video:status` | Server → Client | `{ videoId, status, manifestUrl?, error? }` | Any status change |
| `join:video` | Client → Server | `{ videoId }` | Client subscribes to a video |

**Room pattern:** Each video has its own Socket.IO room named by `videoId`.

---

## 🎬 Video Processing Details

| Setting | Value |
|---------|-------|
| Output format | MPEG-DASH (`.mpd` + `.m4s` chunks) |
| Resolutions (Regular Fargate) | 1080p, 720p, 480p, 360p |
| Resolutions (Spot Fargate) | 720p, 480p, 360p |
| Segment duration | 6 seconds |
| Audio codec | AAC, 128k |
| Video codec | H.264 (libx264) |
| Thumbnail | Generated at 1s mark → `thumbnail.jpg` |
| Spot threshold | Files < 1GB → 70% chance Spot |

### Video Status Flow
```
UPLOADING → UPLOADED → PROCESSING → READY
                                  ↘ ERROR
```
- `UPLOADING`  — set when presigned URL is generated (MongoDB record created)
- `UPLOADED`   — set when client calls `POST /confirm/:id` after S3 upload completes (UI feedback)
- `PROCESSING` — set when Lambda launches the ECS task
- `READY`      — set by webhook when ECS processing completes successfully
- `ERROR`      — set by webhook on ECS failure, or on Spot interruption

> **Note:** `UPLOADED` and processing are decoupled. The client calls `/confirm` to update UI status, while S3 Event Notification independently fires the SQS trigger — so processing starts regardless of whether the client confirms.

### Webhook Payload (ECS → Backend)
```json
{
  "videoId": "string",
  "status": "ready | error",
  "manifestUrl": "https://cdn.example.com/<videoId>/manifest.mpd",
  "error": "optional error message"
}
```

---

## 🏢 AWS Infrastructure

### Regions & AZs
- **Region:** `ap-southeast-1` (Singapore)
- **AZs used:** `ap-southeast-1a`, `ap-southeast-1b`, `ap-southeast-1c`

### Network (VPC CIDR: `10.10.0.0/16`)
| Subnet | CIDR | AZ | Contains |
|--------|------|----|---------|
| Public 1 | `10.10.1.0/24` | 1a | ALB, Bastion |
| Public 2 | `10.10.2.0/24` | 1b | ALB |
| Private 1 | `10.10.3.0/24` | 1a | Backend EC2 |
| Private 2 | `10.10.4.0/24` | 1b | Backend EC2 |
| Private 3 | `10.10.5.0/24` | 1c | MongoDB (3 nodes), Redis |

### Compute
| Service | Spec | Count | Purpose |
|---------|------|-------|---------|
| Backend EC2 | t3.micro | 1–5 (ASG) | API server |
| Bastion EC2 | t3.micro | 1 | SSH gateway |
| MongoDB EC2 | t3.micro | 3 | DB replica set |
| Redis EC2 | t3.micro | 1 | Cache + rate limiter |
| ECS Fargate | 2 vCPU / 4GB | dynamic | Video processing |
| Lambda | Node.js 18, 512MB | 1 | ECS launcher |

### Scaling Rules
- **Backend ASG:** CPU < 10% → scale in, CPU > 80% → scale out, min 1 / max 5
- **ECS:** Scales based on SQS queue depth

### S3 Buckets
| Bucket | Purpose | Lifecycle |
|--------|---------|----------|
| `vision-sync-raw` | Uploaded source videos | Delete after 7 days |
| `vision-sync-processed` | DASH chunks + manifests | Move to S3-IA after 30 days, Glacier after 90 days |

### IAM Role Permissions (Least Privilege)
```
Backend EC2:  s3:GetPresignedUrl (generate presigned URL), s3:GetObject (processed),
              cloudfront:CreateInvalidation
              NOTE: Backend no longer needs sqs:SendMessage — S3 triggers SQS directly

S3 Bucket:    s3:SendMessage to SQS (via S3 Event Notification policy on the SQS queue)

ECS Task:     s3:GetObject (raw bucket), s3:PutObject (processed bucket),
              ecr:GetAuthorizationToken

Lambda:       ecs:RunTask, iam:PassRole,
              sqs:ReceiveMessage, sqs:DeleteMessage, sqs:GetQueueAttributes
```

---

## 🔒 Security Model

- All application instances in **private subnets** — no direct internet access
- **Bastion host** is the only SSH entry point (public subnet)
- SSH pattern: `ssh -J ubuntu@<BASTION_IP> ubuntu@<PRIVATE_IP>`
- SSH key: `~/.ssh/vision-sync-backend`
- Default SSH user: `ubuntu` on all instances
- Security groups: least privilege — specific ports between specific SGs only
- S3 buckets: **no public access** — all video delivery via CloudFront only
- Presigned URLs expire in **15 minutes** (900 seconds)

---

## 🐳 Docker & ECR

| Image | ECR Repo | Built from |
|-------|---------|-----------|
| `vision-sync-backend` | ECR | `server/Dockerfile` |
| `vision-sync-frontend` | ECR | `client/Dockerfile` |
| `vision-sync-processor` | ECR | `container/Dockerfile` |

ECR auth expires every **12 hours** — always run ECR login before pushing/pulling:
```bash
aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin <ECR_URL>
```

---

## 🗄️ Database

### MongoDB
- **Type:** Self-managed replica set on EC2
- **Replica set name:** `rs0`
- **Topology:** 1 Primary + 2 Secondary (all in zone 1c)
- **Port:** `27017`
- **Connection URI pattern:** `mongodb://ip1:27017,ip2:27017,ip3:27017/vision-sync?replicaSet=rs0`
- **Read preference:** `secondaryPreferred`

### Redis
- **Type:** Docker container on EC2 (zone 1c)
- **Port:** `6379`
- **Container name:** `vision-sync-redis`
- **Used for:**
  1. **Rate limiting store** — sliding window / token bucket across all backend instances
  2. **Socket.IO adapter** — backplane for multi-instance event broadcasting
  3. **Response caching** — video list, single video, search results, status-filtered lists, stats
- **Cache invalidation:** Video list + related caches are invalidated on any status change
- **Cache keys used by `cacheService`:** video metadata, video list, search results, stats
- **Known SPOF:** Single node — no replica — if Redis fails, caching degrades gracefully but rate limiting and Socket.IO backplane are affected

---

## 🚀 Deployment Order

```bash
make install          # 1. Install all npm dependencies
make deploy           # 2. Provision AWS infra with Pulumi
make create-inventory # 3. Generate Ansible inventory from Pulumi outputs
make update-env       # 4. Populate server/.env with AWS resource values
make setup-all-db     # 5. Init MongoDB replica set + Redis
make push-containers  # 6. Build + push all Docker images to ECR
make deploy-services  # 7. Deploy containers to EC2 via Ansible
make status           # 8. Verify everything is healthy
```

**Fast update (code change only):**
```bash
make deploy-fast      # Rebuilds images + re-deploys backend only
```

---

## 🛠️ Skills Available

Read the relevant skill BEFORE doing any work in that area:

| Skill | When to Use | Path |
|-------|-------------|------|
| `aws-solution-architect` | Architecture decisions, HA, cost, service selection | `.agents/skills/aws-solution-architect/SKILL.md` |
| `pulumi-best-practices` | Writing/reviewing any `IaC/` code | `.agents/skills/pulumi-best-practices/SKILL.md` |
| `ansible-playbooks` | Writing/debugging any `ansible/` playbook | `.agents/skills/ansible-playbooks/SKILL.md` |
| `nodejs-backend` | Working on `server/` code | `.agents/skills/nodejs-backend/SKILL.md` |
| `ffmpeg-video-pipeline` | Working on `container/` or `lambda/` | `.agents/skills/ffmpeg-video-pipeline/SKILL.md` |
| `makefile-automation` | Adding/fixing `Makefile` targets | `.agents/skills/makefile-automation/SKILL.md` |
| `code-reviewer` | Reviewing any code before merge/deploy | `.agents/skills/code-reviewer/SKILL.md` |
| `aws-diagrams` | Generating architecture diagrams | `.agents/skills/aws-diagrams/SKILL.md` |

---

## 🤖 Agent Strategy

Use **3 focused agent contexts** — don't mix concerns in one long session:

| Agent | Scope | Skills to load |
|-------|-------|---------------|
| `infra-agent` | `IaC/`, `ansible/`, `Makefile`, AWS architecture | `pulumi-best-practices`, `ansible-playbooks`, `makefile-automation`, `aws-solution-architect` |
| `app-agent` | `server/`, `container/`, `lambda/`, `client/` | `nodejs-backend`, `ffmpeg-video-pipeline` |
| `review-agent` | Code review, diagrams, architecture proposals | `code-reviewer`, `aws-solution-architect`, `aws-diagrams` |

---

## 📌 Key Known Issues / Gotchas

1. **MongoDB single-AZ:** All 3 nodes are in zone 1c — a zone outage takes down the entire DB
2. **Redis SPOF:** No replica — Redis failure breaks rate limiting AND Socket.IO broadcast
3. **Bastion as SSH gateway:** All private instance access goes through bastion — if it's down, no SSH
4. **ECR auth expires:** 12-hour token — always re-login before pushing containers
5. **Ubuntu AMI naming conflict:** Bastion and Backend EC2 have explicit named exports in `IaC/index.ts` to avoid this — don't use `export * from './compute/bastion'`
6. **trust proxy:** Must be set (`app.set('trust proxy', 1)`) for `req.ip` to work correctly behind ALB
7. **Spot interruption:** ECS tasks must handle `SIGTERM` and notify backend before exiting
8. **SQS Queue policy:** Must allow `s3.amazonaws.com` as a principal to call `sqs:SendMessage` — otherwise S3 Event Notification will silently fail
9. **S3 Event Notification setup:** Configure in IaC (`IaC/src/storage/s3.ts`) to fire on `s3:ObjectCreated:*` events for the `videos/` prefix in the raw bucket
