# VisionSync — Cost Analysis

## Current Infrastructure (ap-southeast-1)

### EC2 Instances

| Instance | Type | Monthly |
|----------|------|---------|
| Bastion | t3.micro | $8.47 |
| Frontend | t3.small | $15.18 |
| Backend | t3.small | $15.18 |
| MongoDB Primary | t3.small | $15.18 |
| MongoDB Secondary 1 | t3.small | $15.18 |
| MongoDB Secondary 2 | t3.small | $15.18 |
| Redis | t3.micro | $8.47 |
| **Subtotal** | | **$92.84** |

### Compute — ECS Fargate

| Config | Rate | Per task |
|--------|------|---------|
| 1 vCPU, 2 GB, 10 min (on-demand) | $0.04048/vCPU-hr | $0.007 |
| 1 vCPU, 2 GB, 10 min (Spot) | ~70% discount | $0.002 |
| 50 videos/month, 70% Spot mix | 35 Spot + 15 OD | **~$0.18** |

Processing is negligible at low volume. Scales linearly — 1,000 videos/month ≈ $3.60.

### Storage & Networking

| Service | Monthly |
|---------|---------|
| S3 (raw 50 GB + processed 100 GB) | $3.95 |
| ALB (LCU + hourly) | $16.20 |
| NAT Gateway (ECS/Lambda egress) | $8.00 |
| CloudFront (100 GB transfer, 1M req) | $9.00 |
| Lambda + SQS | $0.02 |
| **Subtotal** | **$37.17** |

### Monthly Total

| Category | Monthly |
|----------|---------|
| EC2 | $92.84 |
| ECS Fargate | $0.18 |
| Storage + networking | $37.17 |
| **Total** | **~$130** |

---

## Cost Optimisations Active

### Fargate Spot (70/30 mix)
Files under 1 GB use `FARGATE_SPOT`. On capacity failure, Lambda retries with on-demand in the same invocation. Saves ~70% per processing task.

```typescript
// lambda/src/index.ts
const isUrgent = message.fileSize > 1_073_741_824;
const useSpot = !isUrgent && Math.random() * 100 < 70;
```

### CloudFront PriceClass_100
Restricts CDN edges to North America + Europe. Saves ~30% vs global distribution for an ap-southeast-1 deployment where all origin requests hit the same region anyway.

### MongoDB on EC2 (not Atlas)
Three t3.small nodes vs Atlas M10 × 3 cluster: saves ~$135/month. Managed Atlas M30 (the comparable tier for production replica sets) would cost ~$250/month vs ~$45/month self-managed.

### Redis on EC2 (not ElastiCache)
Single t3.micro instance serves both rate limiting and Socket.IO message buffer. ElastiCache cache.t3.micro costs ~$25/month — saved entirely.

### S3 Lifecycle Policies
Raw videos deleted after 30 days (`S3_RAW_VIDEO_RETENTION_DAYS`). Processed segments retained indefinitely (served on demand from CloudFront).

---

## At-Scale Cost Optimisation

For 1,000+ videos/month and significant traffic, additional optimisations apply:

### S3 Storage

| Optimisation | Savings | Implementation |
|--------------|---------|---------------|
| Intelligent Tiering for processed bucket | ~45% on storage | Auto-moves cold segments to cheaper tier |
| Lifecycle → Glacier after 90 days | ~70% on archived content | For older, rarely-accessed videos |
| Raw video cleanup post-processing | Eliminates raw storage cost | Set lifecycle rule on `videos/` prefix |

### ECS Processing

| Optimisation | Savings | Notes |
|--------------|---------|-------|
| Right-size to 1 vCPU / 2 GB | 50% vs 2 vCPU / 4 GB | Current default; already applied |
| Increase Spot percentage to 90% | Additional 20% | Only viable if retry latency acceptable |
| Batch small videos | Reduce task cold-start overhead | Not yet implemented |

### CloudFront

| Optimisation | Savings | Notes |
|--------------|---------|-------|
| Increase default TTL to 1 year | ~75% fewer origin requests | Segments are immutable |
| Enable Brotli/gzip compression | ~20% transfer reduction | Applied via CF distribution settings |
| Custom cache policy on `manifest.mpd` | Short TTL (5 min) | Manifests can update; segments cannot |

---

## Cost at Scale

| Videos/month | Fargate | S3 | CloudFront | EC2 (fixed) | Total |
|---|---|---|---|---|---|
| 100 | $0.36 | $5 | $9 | $93 | **~$107** |
| 1,000 | $3.60 | $15 | $20 | $93 | **~$132** |
| 10,000 | $36 | $80 | $120 | $93 | **~$329** |

At 10k+ videos/month, migrate MongoDB to Atlas and replace EC2 backend with ECS/Fargate services to reduce operational overhead while keeping costs proportional to usage.

---

## Teardown Cost Risk

`make destroy` deletes all infrastructure. CloudFront distribution, S3 buckets, and EC2 instances are ephemeral. Re-deploying from scratch takes ~15 minutes but assigns new IPs and a new CF domain — run `make save-outputs` immediately after and `make deploy-client` to bake the new `VITE_CLOUDFRONT_URL` into the frontend build.
