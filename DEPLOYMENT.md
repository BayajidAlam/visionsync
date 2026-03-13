# VisionSync — Deployment Guide

## Architecture at a glance

```
Browser
  │
  ├─► ALB :80 ─────────────────────────────────────────────────────────┐
  │    │  default → Frontend TG (port 80)                              │
  │    │  /api/*  → Backend  TG (port 5000)                            │
  │    │  /socket.io/* → Backend TG (port 5000)                        │
  │    │                                                                │
  │    ├─► Frontend EC2 (public IP, port 80) — nginx + React SPA       │
  │    │                                                                │
  │    └─► Backend  EC2 (private IP, port 5000) — Node.js/Express      │
  │                                                                     │
  └─► CloudFront → S3 processed videos (DASH streaming)
```

Private resources (Backend EC2, MongoDB × 3, Redis) are in private subnets.
All SSH access goes through the Bastion host.
All IPs are fetched dynamically from `pulumi stack output` — never hardcoded.

---

## Production recovery notes (2026-03-14)

The running environment was stabilized with the following sequence:

1. Confirmed current infrastructure endpoints from Pulumi stack outputs (bastion, backend private IP, frontend public IP, ALB, MongoDB, Redis).
2. Rebuilt and pushed the backend image to ECR.
3. Deployed backend through bastion to private EC2 and validated container startup.
4. Deployed frontend on the frontend EC2 by building with `VITE_API_URL` set to the current ALB URL.
5. Diagnosed backend restart loop (`MongooseServerSelectionError`) and identified that MongoDB and Redis services were not initialized on private nodes.
6. Ran Ansible from bastion to:

- Configure MongoDB on all three nodes and initialize replica set `rs0`.
- Configure Redis on private Redis node.

7. Revalidated service connectivity from backend to MongoDB/Redis.
8. Confirmed final health:

- Backend container status healthy.
- Frontend container running on port 80.
- ALB `/health` returned `{"status":"ok"}`.
- ALB root (`/`) returned HTTP 200.

### Root causes addressed

- Missing root `Makefile` in current workspace snapshot prevented standard deployment targets.
- Several Ansible files were empty, so database/bootstrap workflow was incomplete.
- Stale hardcoded host values in legacy scripts did not match current Pulumi-managed infrastructure.

### Guardrails applied

- Deployment now uses Pulumi outputs as the source of truth for runtime endpoints.
- Bastion-mediated Ansible flow is used for private subnet resources.
- Frontend build is performed with explicit `VITE_API_URL` to avoid localhost regressions.

---

## Prerequisites

| Tool                  | Purpose                                                          |
| --------------------- | ---------------------------------------------------------------- |
| AWS CLI (`aws`)       | ECR auth, stack queries                                          |
| Docker Desktop        | Building server image locally                                    |
| Pulumi CLI (`pulumi`) | Infrastructure as code                                           |
| GNU Make              | Orchestration (`winget install GnuWin32.Make`)                   |
| SSH key               | `~/.ssh/vision-sync-backend` (private key matching AWS key pair) |

```bash
# Verify tools
aws sts get-caller-identity
pulumi version
docker info
```

---

## Full deployment sequence (fresh clone)

```bash
# 1. Install dependencies
make install

# 2. Deploy AWS infrastructure with Pulumi
#    Creates EC2s, VPC, ALB, S3, SQS, ECS, CloudFront, etc.
make deploy

# 3. Bootstrap Ansible on the bastion (run once per deployment)
#    - Copies ansible/ playbooks to bastion
#    - Copies SSH key to bastion
#    - Installs Ansible on bastion
make ansible-bootstrap

# 4. Set up MongoDB replica set (runs Ansible on bastion)
make setup-mongodb

# 5. Set up Redis (runs Ansible on bastion)
make setup-redis

# 6. Build + push server image to ECR, deploy to backend EC2
make deploy-server

# 7. Build + deploy React frontend to frontend EC2
make deploy-client

# 8. Verify everything is running
make status-prod
```

---

## Why Ansible runs on the bastion

MongoDB and Redis EC2 instances are in **private subnets** — they have no internet access
and cannot be reached directly from your laptop. The bastion host (in the public subnet)
can reach them via VPC routing. So:

1. `make ansible-bootstrap` copies playbooks + SSH key to the bastion
2. `make setup-mongodb` / `make setup-redis` SSH to the bastion and run `ansible-playbook` there
3. Ansible then connects from bastion → private MongoDB/Redis hosts directly

---

## Make targets reference

```bash
# Infrastructure
make deploy             # pulumi up + update server/.env
make update-env         # sync server/.env from Pulumi outputs (no infra changes)
make outputs            # show all Pulumi stack outputs + quick IP reference
make destroy            # destroy all AWS resources (prompts for confirmation)

# Ansible / databases
make ansible-bootstrap  # first-time bastion setup (run after each pulumi up)
make ansible-sync       # re-sync ansible/ to bastion after local edits
make setup-mongodb      # create MongoDB replica set via Ansible
make check-mongodb      # verify replica set health
make setup-redis        # deploy Redis container via Ansible
make check-redis        # verify Redis is responding

# Application deployment
make deploy-server      # build Docker image → ECR → restart on backend EC2
make deploy-client      # package client → frontend EC2 → docker build + run
make deploy-prod        # deploy-server + deploy-client + status check

# Operations
make status-prod        # docker ps on both EC2s + ALB health
make logs-server-prod   # tail backend container logs (Ctrl+C)
make logs-frontend      # tail frontend container logs (Ctrl+C)
make ssh-frontend       # SSH into frontend EC2
make ssh-backend-prod   # SSH into backend EC2 via bastion
make logs-lambda        # tail Lambda logs (SQS video trigger)
make logs-ecs           # tail ECS task logs (FFmpeg transcoding)

# Local dev
make install            # npm install across all packages
make build              # build all packages
make dev                # run server + client locally
make clean              # remove dist/ and caches
```

---

## How IPs are resolved (important for re-deployments)

All IPs are fetched **at make time** from `pulumi stack output`:

```makefile
BASTION_IP       := $(shell cd IaC && pulumi stack output bastionPublicIp)
BACKEND_EC2_IP   := $(shell cd IaC && pulumi stack output backendPrivateIp)
MONGO_PRIMARY    := $(shell cd IaC && pulumi stack output mongodbPrimaryIp)
MONGO_SECONDARY1 := $(shell cd IaC && pulumi stack output mongodbSecondary1Ip)
MONGO_SECONDARY2 := $(shell cd IaC && pulumi stack output mongodbSecondary2Ip)
REDIS_IP         := $(shell cd IaC && pulumi stack output redisIp)
```

After `pulumi up` (which may assign new private IPs to EC2 instances), run:

```bash
make deploy          # re-runs pulumi up and refreshes all outputs
make ansible-bootstrap  # re-sync to bastion with updated IPs
make setup-mongodb
make setup-redis
```

---

## Step-by-step breakdown

### `make deploy-server`

1. `docker build` server image locally
2. Push to ECR (`vision-sync-server-dev`)
3. SSH bastion → backend EC2: ECR login, `docker pull`, stop old container, start new one
4. All env vars injected at runtime (MONGODB_URI, REDIS_URL, etc. from Pulumi outputs)

### `make deploy-client`

1. Tarballs `client/` (no `node_modules`, no `dist`)
2. `scp` to frontend EC2
3. SSH to frontend EC2: `docker build` with `VITE_API_URL=$(ALB_URL)` baked in
4. Stops old container, starts new one on port 80

> **Why build on the frontend EC2?**  
> `VITE_API_URL` is replaced statically at build time. Building on the EC2 avoids pushing
> a large image through ECR and correctly captures the ALB URL at the time of deployment.

---

## Verify the deployment

```bash
# ALB health check
make status-prod

# Or manually:
ALB=<ALB DNS from 'make outputs'>
curl http://$ALB/health              # {"status":"ok",...}
curl http://$ALB/                    # React app HTML
```

---

## Key lessons learned

| Mistake                                               | Correct approach                                 |
| ----------------------------------------------------- | ------------------------------------------------ |
| Hardcoded IPs in Makefile                             | All IPs from `pulumi stack output` (dynamic)     |
| Running Ansible on Windows                            | Ansible runs on the Linux bastion via SSH        |
| ProxyJump for Ansible                                 | Not needed — Ansible control node IS the bastion |
| `docker build` without `--build-arg VITE_API_URL=...` | Always pass ALB URL as build arg                 |
| Missing `app.set('trust proxy', 1)` in Express        | Required behind ALB for rate limiting            |
| `REDIS_URL` without password                          | `redis://:VisionSyncRedis2024!@<REDIS_IP>:6379`  |
| Using `$(HOME)` in Makefile on Windows                | Use `$(shell echo ~/.ssh/...)` instead           |
| Make without `SHELL := /path/to/bash` on Windows      | Git Bash path needed for aws/ssh/scp             |

---

## Infrastructure (Pulumi)

All infrastructure is in `IaC/` (TypeScript + Pulumi).

```bash
cd IaC && npm install
pulumi login          # first time
pulumi stack select dev
pulumi up             # deploy
pulumi stack output   # see all outputs
pulumi destroy --yes  # tear down everything
```
