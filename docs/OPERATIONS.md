# VisionSync — Operations (Security, Testing, Troubleshooting)

---

## Security

### IAM & Access

- [x] Backend EC2 uses **instance profile** (not access keys in env) for S3/SQS/ECS API calls
- [x] Lambda execution role — least-privilege: `ecs:RunTask`, `iam:PassRole`, `logs:PutLogEvents`
- [x] ECS task role — `s3:GetObject` (raw bucket), `s3:PutObject` (processed bucket)
- [x] No wildcard resource ARNs in any IAM policy
- [x] No hardcoded AWS credentials — `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` optional in `env.ts`; instance profile takes precedence

### Network

- [x] Backend EC2 in **private subnet** — only reachable via ALB
- [x] ECS Fargate in private subnets — `assignPublicIp: DISABLED`; outbound via NAT Gateway
- [x] MongoDB and Redis in private subnets — no public IP; accessible from backend security group only
- [x] Bastion is the only SSH entry point — direct SSH to backend/DB blocked at SG level

### Input Validation

- [x] Magic-byte validation — binary header checked before presigned URL issued
- [x] File size limit — 5 GB client-side before network; server validates `fileSize` in body
- [x] `validateVideoId` middleware — rejects non-UUID IDs
- [x] `validateWebhookPayload` — requires `videoId` + `status`
- [x] No SQL injection — Mongoose ODM, parameterised queries only

### CORS

- [x] `FRONTEND_URL` comma-separated; split in `app.ts` cors config and Socket.IO init
- [x] No wildcard `*` origin
- [x] Both frontend EC2 IP and ALB URL must be in `FRONTEND_URL` — ALB routes requests that show up as ALB origin, browser app is served from EC2 IP

### Accepted Risks

| Risk | Acceptance |
|------|-----------|
| Redis password in Docker env var | No KMS at this cost tier; env var acceptable for dev/staging |
| No HTTPS on ALB (dev) | No domain configured; add ACM cert + Route 53 for production |
| MongoDB URI in `server/.env` | File never committed; acceptable for self-managed EC2 tier |

### Runtime Verification

```bash
# S3 public access blocked
aws s3api get-public-access-block --bucket vision-sync-raw-videos-dev
aws s3api get-public-access-block --bucket vision-sync-processed-videos-dev
# All four flags should be true

# Confirm backend/DB have no public IPs
aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=vision-sync" \
  --query "Reservations[*].Instances[*].[Tags[?Key=='Name'].Value|[0],PublicIpAddress]" \
  --output table
# Backend, MongoDB*, Redis → None

# Lambda execution role
aws lambda get-function-configuration \
  --function-name vision-sync-video-processor-dev \
  --query "Role" --output text | xargs aws iam get-role --role-name
```

---

## Testing

### Smoke Tests (run after every deploy)

```bash
ALB="http://vision-sync-alb-dev-480216255.ap-southeast-1.elb.amazonaws.com"

# Health
curl $ALB/api/webhook/health
# {"status":"ok","connections":N}

# Video list
curl $ALB/api/videos
# {"data":[...],"message":"Videos retrieved successfully"}

# Presigned URL generation
curl -X POST $ALB/api/upload/generate-presigned-url \
  -H "Content-Type: application/json" \
  -d '{"fileName":"test.mp4","fileType":"video/mp4","fileSize":1024}'
# {"data":{"presignedUrl":"...","videoId":"...","expiresAt":"..."}}
```

### Scenario 1: End-to-End Upload + Playback

1. Studio → drag MP4 file → observe progress bar + speed
2. Upload completes → app switches to Home → bell shows "Upload completed"
3. Video card status: `UPLOADED` → `PROCESSING` → `READY` (real-time via socket)
4. Click card → player opens → DASH starts → quality selector shows renditions

Expected socket sequence: `UPLOADING → UPLOADED → PROCESSING → READY`

### Scenario 2: File Validation

| Input | Expected |
|-------|----------|
| Text file renamed `.mp4` | "File is not a valid video (magic bytes mismatch)" — no network call |
| File > 5 GB | "Some files are too large" — client-side rejection |
| Valid MP4/AVI/WebM/OGG | Proceeds to presigned URL request |

### Scenario 3: Reconnect + Replay

1. Upload video → during PROCESSING, disconnect network (DevTools → Offline)
2. Wait 10–15 s → reconnect
3. Socket reconnects → if video reached READY while offline, buffered message replayed immediately

**Verify Redis buffer:**
```bash
redis-cli -u redis://:$REDIS_PASSWORD@$REDIS_IP:6379 LRANGE "video:msgbuf:<videoId>" 0 -1
```

### Scenario 4: Idempotent Webhook

```bash
# First webhook (normal)
curl -X POST $ALB/api/webhook/processing-complete \
  -H "Content-Type: application/json" \
  -d '{"videoId":"<id>","status":"ready","manifestUrl":"https://xxx/<id>/manifest.mpd"}'

# Duplicate (should be ignored)
curl -X POST $ALB/api/webhook/processing-complete \
  -H "Content-Type: application/json" \
  -d '{"videoId":"<id>","status":"error","error":"Simulated duplicate"}'
# Expected: {"message":"Ignored: video already ready or not found"}
# Video status in UI must remain READY
```

### Scenario 5: Rate Limit

```bash
for i in $(seq 1 105); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" $ALB/api/videos)
  echo "Request $i: $STATUS"
done
# First 100: 200, then 429 with Retry-After header
```

### Performance Benchmarks

| Metric | Measured |
|--------|----------|
| Presigned URL generation | ~50 ms |
| Video list (50 videos) | ~40–80 ms |
| Socket connection | ~200 ms |
| Processing 30 MB 720p | ~90 s (Fargate Spot) |
| Processing 200 MB 1080p | ~5–8 min (Fargate Spot) |
| First segment from CloudFront (cached) | ~80–150 ms |
| Rate limit check (Redis pipeline) | < 5 ms |

---

## Troubleshooting

### Quick Diagnostics
```bash
make status-prod
make logs-server-prod
make check-mongodb
make check-redis
curl $ALB/api/webhook/health
```

---

### 1. `make deploy-server` fails — "BASTION_IP empty"

**Cause:** `.env.infra` missing or stale.

```bash
# Option A — have passphrase
PULUMI_CONFIG_PASSPHRASE=<pass> make save-outputs

# Option B — query AWS directly
aws ec2 describe-instances \
  --filters "Name=tag:Project,Values=vision-sync" \
  --query "Reservations[*].Instances[*].[Tags[?Key=='Name'].Value|[0],PublicIpAddress,PrivateIpAddress]" \
  --output table
# Populate .env.infra manually
```

---

### 2. CORS blocked — `Origin http://x.x.x.x not allowed`

**Cause:** `FRONTEND_URL` has only the ALB URL; client served from frontend EC2 IP is a different origin.

**Fix:** Redeploy server with both origins in `FRONTEND_URL`:
```makefile
-e FRONTEND_URL="http://$(FRONTEND_EC2_IP),$(ALB_URL)"
```

---

### 3. `manifest.mpd` fails — `ERR_NAME_NOT_RESOLVED`

**Cause:** CloudFront distribution replaced (destroy + redeploy); `.env.infra` has stale domain. Or `VITE_CLOUDFRONT_URL` built without `https://`.

```bash
# Get live CF domain
aws cloudfront list-distributions \
  --query "DistributionList.Items[*].[DomainName,Status]" \
  --output table

# Update .env.infra: CLOUDFRONT_DOMAIN=dyjvnlwnnzqhd.cloudfront.net
# Makefile must pass scheme: --build-arg VITE_CLOUDFRONT_URL=https://$(CLOUDFRONT_DOMAIN)
make deploy-client
```

---

### 4. Video stuck at PROCESSING — never becomes READY

```bash
# Check ECS task ran
aws ecs list-tasks --cluster vision-sync-cluster-dev

# Check container logs
aws logs tail /ecs/vision-sync-video-processor --since 1h

# Check webhook reached server
make logs-server-prod | grep "Webhook received"

# Check WEBHOOK_URL in task definition
aws ecs describe-task-definition \
  --task-definition vision-sync-video-processor-dev \
  --query "taskDefinition.containerDefinitions[0].environment"
```

**Common causes:** `WEBHOOK_URL` empty (Lambda override bug), ECS SG blocks outbound 80, MongoDB write failed.

---

### 5. Double PROCESSING socket event

**Cause:** `webhook.ts` else-branch calling `socketService.emitVideoStatus()` AND `updateVideoStatus()` emitting internally.

```typescript
// Correct — no direct emit in else branch:
} else {
  updatedVideo = await videoService.updateVideoStatus(videoId, status.toUpperCase());
  // updateVideoStatus already emits the socket event — no duplicate here
```

---

### 6. `GET /api/videos` returns 429

**Quick recovery:**
```bash
redis-cli -u redis://:$REDIS_PASSWORD@$REDIS_IP:6379 DEL "rate_limit:default:<your-ip>"
```

**Permanent fix:** Ensure `RateLimiters.search` is only applied to the `/search` endpoint, not `GET /api/videos` (which uses `RateLimiters.general`).

---

### 7. Thumbnail shows placeholder for READY videos

**Check S3:**
```bash
aws s3 ls s3://vision-sync-processed-videos-dev/<videoId>/
# Should include thumbnail.jpg
```

**Fix:** If CF domain wrong → `make deploy-client`. If thumbnail missing → delete + re-upload video.

---

### 8. Upload returns 429 immediately

**Cause:** Stale Redis rate limit key from previous session within 15-min window.

```bash
redis-cli -u redis://:$REDIS_PASSWORD@$REDIS_IP:6379 DEL "upload:<your-ip>"
```

---

### 9. Backend container exits on start

```bash
make logs-server-prod
```

| Error | Fix |
|-------|-----|
| `Missing required environment variables: MONGODB_URI` | `server/.env` not mounted; check deploy-server env flags |
| `MongoServerSelectionError` | MongoDB down; `make check-mongodb` |
| `Redis connection failed` | Redis down; `make check-redis` |
| `EADDRINUSE: port 5000` | Old container still running; `docker rm -f vision-sync-server` |

---

### 10. Socket.IO not connecting

**Check ALB sticky sessions (required for WebSocket):**
```bash
aws elbv2 describe-target-groups \
  --query "TargetGroups[*].[TargetGroupName,StickinessConfig]"
```

**Check Socket.IO CORS** — must use same `FRONTEND_URL` value as Express cors middleware.

---

### 11. Pulumi state drift / locked

```bash
cd IaC
PULUMI_CONFIG_PASSPHRASE=<pass> pulumi stack export > stack-backup.json
PULUMI_CONFIG_PASSPHRASE=<pass> pulumi refresh    # sync state with actual AWS
PULUMI_CONFIG_PASSPHRASE=<pass> pulumi cancel     # if lock stuck
PULUMI_CONFIG_PASSPHRASE=<pass> pulumi up
```

---

### Common Log Patterns

| Log message | Meaning |
|-------------|---------|
| `Webhook received { status: "ready" }` | ECS task completed successfully |
| `Ready webhook ignored — video already READY` | Duplicate webhook — expected on retries |
| `Redis rate limit error — falling back to memory` | Redis connection dropped; limiter still works |
| `Cleaned inactive rooms { count: N }` | Normal Socket.IO room cleanup |
| `Replayed buffered messages { videoId, count }` | Late-joining client got missed events |
| `Per-IP connection limit exceeded` | Too many tabs open from same IP |
| `Circuit breaker opened` | External dependency failing; requests fast-failing |
