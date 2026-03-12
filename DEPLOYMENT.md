# VisionSync — Deployment Guide

## Architecture at a glance

```
Browser
  │
  ├─► ALB :80 ──────────────────────────────────────────────────────┐
  │    │  default → Frontend TG (port 80)                           │
  │    │  /api/*  → Backend  TG (port 5000)                         │
  │    │  /socket.io/* → Backend TG (port 5000)                     │
  │    │                                                             │
  │    ├─► Frontend EC2 (54.254.240.227)                            │
  │    │    └─ vision-sync-client  container :80   (nginx + React)  │
  │    │                                                             │
  │    └─► Backend  EC2 (10.0.42.158 private)                       │
  │         └─ vision-sync-server  container :5000 (Node/Express)   │
  │                                                                  │
  └─► CloudFront d11zonfo5y8dyu.cloudfront.net → S3 processed videos
```

| Component | Host | Port | Access |
|-----------|------|------|--------|
| Frontend EC2 | 54.254.240.227 | 80 | Direct SSH |
| Backend EC2 | 10.0.42.158 (private) | 5000 | Via bastion 52.77.164.183 |
| Bastion | 52.77.164.183 | 22 | Direct SSH |
| ALB | vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com | 80 | Public |
| CloudFront | d11zonfo5y8dyu.cloudfront.net | 443 | Public (video CDN) |

---

## Prerequisites

```bash
# Tools needed locally
docker          # Docker Desktop (for building server image)
aws             # AWS CLI, configured with ap-southeast-1
ssh key         # ~/.ssh/vision-sync-backend

# Verify AWS access
aws sts get-caller-identity
```

---

## One-command deployment

```bash
make deploy-prod          # deploys both server + client
```

Or separately:

```bash
make deploy-server        # Node.js API only
make deploy-client        # React frontend only
```

---

## Step-by-step breakdown

### 1. Deploy the server (Node.js API)

`make deploy-server` does the following automatically:

1. Builds `server/` as a Docker image locally  
2. Pushes to ECR (`vision-sync-server-dev`)  
3. SSHes via bastion → backend EC2, pulls the new image  
4. Stops the old container, starts a new one with all env vars injected

The environment variables injected at runtime (in the Makefile):

| Variable | Value |
|----------|-------|
| `PORT` | 5000 |
| `NODE_ENV` | production |
| `AWS_REGION` | ap-southeast-1 |
| `S3_BUCKET_RAW` | vision-sync-raw-videos-dev |
| `S3_BUCKET_PROCESSED` | vision-sync-processed-videos-dev |
| `SQS_QUEUE_URL` | https://sqs.ap-southeast-1.amazonaws.com/366451245016/vision-sync-video-processing-dev |
| `MONGODB_URI` | mongodb://10.0.1.15:27017,10.0.174.69:27017,10.0.22.130:27017/vision-sync?replicaSet=rs0 |
| `REDIS_URL` | redis://:VisionSyncRedis2024!@10.0.35.200:6379 |
| `CLOUDFRONT_DOMAIN` | d11zonfo5y8dyu.cloudfront.net |
| `FRONTEND_URL` | http://vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com |

### 2. Deploy the client (React frontend)

`make deploy-client` does the following automatically:

1. Tarballs `client/` (excluding `node_modules` and `dist`)
2. SCPs the tarball to the frontend EC2
3. SSHes into the frontend EC2, runs `docker build` there with `VITE_API_URL` set to the ALB URL
4. Stops the old container, starts the new one on port 80

> **Why build on the frontend EC2?**  
> `VITE_API_URL` is baked into the React bundle at build time (Vite replaces it statically).  
> Building on the frontend EC2 avoids pushing a 1GB+ image through ECR and works regardless  
> of Docker Desktop state on your local machine. The frontend EC2 IAM role cannot push to  
> ECR anyway, so this is the correct approach.

---

## Useful make targets

```bash
# Deployment
make deploy-prod          # deploy server + client
make deploy-server        # server only
make deploy-client        # client only

# Monitoring
make status-prod          # docker ps on both EC2s + ALB health
make logs-frontend        # tail nginx/client logs (Ctrl+C to stop)
make logs-server-prod     # tail Node.js server logs (Ctrl+C to stop)

# SSH access
make ssh-frontend         # SSH into frontend EC2
make ssh-backend-prod     # SSH into backend EC2 via bastion
```

---

## Manual commands (if Make is unavailable)

### Deploy client manually

```bash
# Pack and SCP
tar --exclude='client/node_modules' --exclude='client/dist' \
    -czf /tmp/vsync-client.tar.gz client/

scp -i ~/.ssh/vision-sync-backend /tmp/vsync-client.tar.gz \
    ubuntu@54.254.240.227:~/client-src.tar.gz

# Build and run on frontend EC2
ssh -i ~/.ssh/vision-sync-backend ubuntu@54.254.240.227
  rm -rf ~/client-build && mkdir ~/client-build
  tar -xzf ~/client-src.tar.gz -C ~/client-build --strip-components=1
  cd ~/client-build
  docker build \
    --build-arg VITE_API_URL=http://vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com \
    -t vision-sync-client:latest .
  docker stop vision-sync-client 2>/dev/null; docker rm vision-sync-client 2>/dev/null
  docker run -d --name vision-sync-client --restart unless-stopped \
    -p 80:80 vision-sync-client:latest
```

### Deploy server manually

```bash
# Build and push from local machine
cd server
docker build -t vision-sync-server:latest .
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin \
  366451245016.dkr.ecr.ap-southeast-1.amazonaws.com
docker tag vision-sync-server:latest \
  366451245016.dkr.ecr.ap-southeast-1.amazonaws.com/vision-sync-server-dev:latest
docker push 366451245016.dkr.ecr.ap-southeast-1.amazonaws.com/vision-sync-server-dev:latest

# Pull and restart on backend EC2 (via bastion)
ssh -i ~/.ssh/vision-sync-backend ubuntu@52.77.164.183
  ssh -i ~/.ssh/vision-sync-backend ubuntu@10.0.42.158
    ECR="366451245016.dkr.ecr.ap-southeast-1.amazonaws.com"
    aws ecr get-login-password --region ap-southeast-1 | \
      docker login --username AWS --password-stdin $ECR
    docker pull $ECR/vision-sync-server-dev:latest
    docker stop vision-sync-server; docker rm vision-sync-server
    docker run -d --name vision-sync-server --restart unless-stopped \
      -p 5000:5000 \
      -e PORT=5000 -e NODE_ENV=production -e AWS_REGION=ap-southeast-1 \
      -e S3_BUCKET_RAW=vision-sync-raw-videos-dev \
      -e S3_BUCKET_PROCESSED=vision-sync-processed-videos-dev \
      -e SQS_QUEUE_URL="https://sqs.ap-southeast-1.amazonaws.com/366451245016/vision-sync-video-processing-dev" \
      -e MONGODB_URI="mongodb://10.0.1.15:27017,10.0.174.69:27017,10.0.22.130:27017/vision-sync?replicaSet=rs0" \
      -e "REDIS_URL=redis://:VisionSyncRedis2024!@10.0.35.200:6379" \
      -e CLOUDFRONT_DOMAIN=d11zonfo5y8dyu.cloudfront.net \
      -e FRONTEND_URL=http://vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com \
      $ECR/vision-sync-server-dev:latest
```

---

## Verify the deployment

```bash
# 1. ALB serves the React app
curl -s http://vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com/ | grep 'dashjs\|index-'

# 2. API health check
curl http://vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com/health

# 3. API URL baked into the bundle (should NOT say localhost)
curl -s http://vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com/ \
  | grep -o 'src=.*js' \
  | xargs -I{} curl -s "http://vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com/{}" \
  | grep -o 'vision-sync-alb\|localhost:5000'
```

---

## Key lessons learned (things to avoid)

| Mistake | Correct approach |
|---------|-----------------|
| `docker build` without `--build-arg VITE_API_URL=...` | Always pass the ALB URL as build arg |
| Deploying client to backend EC2 (port 3000) | ALB routes port 80 to **frontend EC2** |
| `import dashjs from 'dashjs'` via bundler | Load dashjs via `<script src="/dashjs.min.js">` UMD |
| Missing `REDIS_URL` password | `redis://:VisionSyncRedis2024!@10.0.35.200:6379` |
| Missing `app.set('trust proxy', 1)` in Express | Required for correct rate-limiting behind ALB |
| No `Cache-Control` on `index.html` | nginx must return `no-store` for `index.html` |

---

## Infrastructure (Pulumi)

All infrastructure is defined in `IaC/` using Pulumi (TypeScript).

```bash
# First time setup
cd IaC
npm install
pulumi login
pulumi stack select dev

# Deploy infrastructure
pulumi up

# Tear down everything
pulumi destroy --yes
```

After `pulumi up`, update the variables at the top of the `Makefile` if any IPs or URLs changed.
