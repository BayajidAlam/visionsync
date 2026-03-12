# VisionSync: A Scalable Cloud-Native Video Streaming Platform

## Table of Contents

- [Problem Statement](#problem-statement)
- [Project Overview](#project-overview)
- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Technology Stack](#technology-stack)
- [Folder Structure](#folder-structure)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Deployment Commands](#deployment-commands)
- [Application URLs](#application-urls)
- [Video Processing Pipeline](#video-processing-pipeline)
- [Auto Scaling Across Multiple AZs](#auto-scaling-across-multiple-azs)
- [Troubleshooting](#troubleshooting)
- [API Documentation](#api-documentation)
- [Scaling for High Load](#scaling-for-high-load)

## Problem Statement

Build a production-ready video streaming platform that can handle video uploads, process them into adaptive streaming formats (DASH/HLS), and deliver content efficiently through a CDN. The platform must handle concurrent video processing, provide real-time status updates, implement rate limiting, and scale automatically based on demand while optimizing costs using spot instances.

## Project Overview

VisionSync is a comprehensive cloud-native video streaming platform built with modern AWS services and containerization technologies. The platform enables users to upload videos through presigned URLs, automatically processes them into adaptive streaming formats, and delivers content via CloudFront CDN with real-time status updates through WebSocket connections.

The architecture leverages AWS ECS Fargate with intelligent spot/regular instance selection (70% spot, 30% regular) for cost-optimized video processing. Videos are transcoded into multiple resolutions (1080p, 720p, 480p, 360p) using FFmpeg and packaged as DASH-compliant streaming format with adaptive bitrate switching.

The backend is deployed across multiple AWS EC2 instances in an autoscaling group, connected to a MongoDB replica set (1 primary + 2 secondary nodes) for data persistence and Redis for caching. An Application Load Balancer distributes traffic across backend instances, while Lambda functions orchestrate the video processing workflow triggered by SQS messages. All infrastructure is managed through Pulumi IaC, with Ansible handling automated deployment and configuration management across multiple availability zones.

## Architecture Overview

VisionSync consists of five main components working together to deliver a scalable video streaming platform:

**1. Frontend (React + TypeScript):**
- Modern React application with Shadcn UI components for video upload and streaming interface
- Real-time progress tracking using Socket.IO for video processing status updates
- DASH.js integration for adaptive streaming with automatic quality switching
- Containerized with Docker and deployed on EC2 in public subnet
- Optimized build served through CloudFront for global low-latency access

**2. Backend (Node.js + Express + TypeScript):**
- RESTful API with Express handling video upload via presigned S3 URLs
- Socket.IO for real-time WebSocket connections broadcasting processing status
- Advanced rate limiting with multiple algorithms (token bucket, sliding window)
- Deployed in private subnet across auto-scaling EC2 instances (min: 1, max: 5)
- Connected to ALB for traffic distribution and health monitoring
- Integration with AWS services: S3, SQS, Lambda, CloudFront

**3. Video Processing (ECS Fargate + FFmpeg):**
- Containerized FFmpeg processor running on AWS ECS Fargate
- Intelligent instance selection: 70% Spot (cost-optimized), 30% Regular (reliability)
- Downloads videos from S3 raw bucket, transcodes to multiple resolutions
- Generates DASH manifests with adaptive bitrate streaming
- Uploads processed chunks and manifests to S3 processed bucket
- Sends webhook to backend upon completion

**4. Database Layer:**
- **MongoDB Replica Set**: 1 primary + 2 secondary nodes in private subnet (zone 1c)
- **Redis Cache**: Single instance for session management and caching
- Deployed and configured using Ansible automation
- High availability with automatic failover

**5. Infrastructure (AWS + Pulumi IaC):**
- **VPC**: Multi-AZ deployment across 3 availability zones (ap-southeast-1a, 1b, 1c)
- **Subnets**: Public (2 AZs for ALB/bastion), Private (3 AZs for apps/databases)
- **Application Load Balancer**: Cross-AZ traffic distribution with health checks
- **Auto Scaling Group**: Dynamic scaling for backend EC2 (CPU-based: 10%-80%)
- **ECS Cluster**: Fargate tasks for video processing with auto-scaling based on SQS depth
- **Lambda Function**: Orchestrates ECS task launches from SQS triggers
- **S3 Buckets**: Separate buckets for raw and processed videos
- **CloudFront CDN**: Global content delivery with cache optimization
- **SQS Queue**: Message queue for video processing jobs with dead letter queue
- **ECR Repositories**: Docker image storage for backend, frontend, and video processor
- **IAM Roles**: Least privilege access control for all services
- **CloudWatch**: Logs, metrics, and alarms for monitoring
- **Bastion Host**: Secure SSH access to private subnet resources

The architecture flow:
1. User uploads video → **Frontend** generates presigned S3 URL
2. Video uploaded to **S3 raw bucket** → triggers **Lambda** via **SQS** message
3. **Lambda** launches **ECS Fargate** task (Spot or Regular based on file size)
4. **ECS container** downloads, processes, and uploads to **S3 processed bucket**
5. **Webhook** notifies **Backend** → updates **MongoDB** → emits **Socket.IO** event
6. **Frontend** receives status update → displays video with **CloudFront** URL
7. User streams video via **DASH player** with adaptive quality switching

## Features

### Video Processing & Streaming
- **Adaptive Bitrate Streaming**: DASH-compliant streaming with automatic quality switching based on network conditions
- **Multi-Resolution Support**: Videos transcoded to 1080p, 720p, 480p, 360p for optimal device compatibility
- **FFmpeg Processing**: Professional-grade video compression and chunking (4-6 second segments)
- **Real-Time Progress**: Socket.IO powered live updates for upload and processing status
- **Presigned URL Upload**: Secure direct-to-S3 uploads without server overhead
- **Automatic Thumbnail Generation**: Creates thumbnails during video processing

### Cost Optimization & Scalability
- **Smart ECS Instance Selection**: 70% Spot instances (70% cost savings), 30% Regular Fargate for reliability
- **Intelligent Fallback**: Automatic retry on Regular instances if Spot unavailable
- **File Size-Based Strategy**: Files >1GB automatically use Regular Fargate for stability
- **Batch Processing Mode**: Lightweight jobs processed efficiently with batch mode enabled
- **S3 Lifecycle Policies**: Automatic storage class transitions for cost management
- **CloudFront CDN**: Global content delivery with intelligent caching for hot data

### Auto Scaling & High Availability
- **Multi-AZ Deployment**: Infrastructure spans 3 availability zones (ap-southeast-1a, 1b, 1c)
- **Backend Auto Scaling**: CPU-based scaling (10%-80% thresholds), 1-5 instances
- **ECS Task Auto Scaling**: SQS depth-based scaling for video processing workload
- **MongoDB Replica Set**: 1 Primary + 2 Secondary nodes with automatic failover
- **ALB Health Checks**: Continuous monitoring with automatic traffic rerouting
- **Zero-Downtime Deployments**: Rolling updates with health verification

### Advanced Features
- **Multiple Rate Limiting Algorithms**: Token bucket, sliding window, fixed window implementations
- **Redis Caching**: Session management, rate limiting, and Socket.IO backplane
- **Dead Letter Queue**: Failed processing jobs captured for debugging and retry
- **Comprehensive Monitoring**: CloudWatch logs, metrics, and alarms
- **Security Best Practices**: Private subnets, IAM least privilege, security groups
- **WebSocket Real-Time Updates**: Live status broadcasts for all connected clients

### DevOps & Automation
- **Infrastructure as Code**: Complete Pulumi-based IaC for reproducible infrastructure
- **Ansible Automation**: Automated deployment, configuration, and database setup
- **One-Command Deployment**: `make deploy-all` deploys entire platform
- **Fast Update Deployments**: `make deploy-fast` for quick code updates
- **ECR Integration**: Private Docker registry for all container images
- **Automated Environment Configuration**: Dynamic .env generation from Pulumi outputs
- **SSH Bastion Access**: Secure gateway to private subnet resources

## Technology Stack

- **Frontend**:
  - React with TypeScript for type-safe development
  - Vite for lightning-fast build tooling
  - Tailwind CSS for utility-first responsive styling
  - Shadcn/ui for modern, accessible component library
  - DASH.js for adaptive streaming video playback
  - Socket.IO Client for real-time WebSocket connections
  - Lucide React for beautiful, consistent icons
  - Nginx for reverse proxy and optimized static file serving
  - Docker multi-stage builds for production deployment

- **Backend**:
  - Node.js 18+ with Express and TypeScript
  - Socket.IO for real-time bidirectional communication
  - Express Rate Limit with multiple algorithms (token bucket, sliding window)
  - Express Validator for input validation and sanitization
  - Helmet for security headers
  - Mongoose for MongoDB object modeling
  - AWS SDK v3 for S3, SQS, CloudFront integration
  - Multer for multipart/form-data handling
  - UUID for unique identifier generation
  - Docker multi-stage builds with optimized layers

- **Video Processing Container**:
  - FFmpeg for video transcoding, compression, and chunking
  - Node.js runtime for orchestration logic
  - AWS SDK for S3 download/upload operations
  - Adaptive quality settings based on instance type
  - Custom webhook notification system
  - Docker containerized for ECS Fargate deployment

- **Database & Cache**:
  - **MongoDB**: Replica set with 1 Primary + 2 Secondary nodes for HA
  - **Redis**: In-memory cache for sessions, rate limiting, Socket.IO adapter
  - Mongoose schema validation and middleware
  - Connection pooling and retry logic

- **AWS Services**:
  - **Compute**: EC2 (t3.micro), ECS Fargate (2 vCPU, 4GB RAM), Lambda (Node.js 18)
  - **Storage**: S3 (raw/processed buckets), ECR (container registry)
  - **Networking**: VPC, ALB, NAT Gateway, Internet Gateway, Security Groups
  - **Messaging**: SQS with dead letter queue
  - **CDN**: CloudFront for global content delivery
  - **Monitoring**: CloudWatch Logs, Metrics, Alarms
  - **IAM**: Role-based access control with least privilege

- **Infrastructure Architecture**:
  - **VPC**: Multi-AZ across ap-southeast-1a, 1b, 1c
  - **Public Subnets**: 2 AZs for ALB, Bastion, Frontend (10.10.1.0/24, 10.10.2.0/24)
  - **Private Subnets**: 3 AZs for Backend, MongoDB, Redis (10.10.3-5.0/24)
  - **Auto Scaling Groups**: CPU-based scaling for backend (10%-80%)
  - **ECS Cluster**: SQS-based auto-scaling for video processing
  - **Bastion Host**: Secure SSH gateway to private resources

- **DevOps & Automation**:
  - **IaC**: Pulumi with TypeScript for infrastructure provisioning
  - **Configuration Management**: Ansible playbooks for automated setup
  - **CI/CD**: Makefile-based deployment pipeline
  - **Container Registry**: AWS ECR for private image storage
  - **Version Control**: Git with modular IaC structure
  - **SSH Key Management**: Automated key generation and distribution
  - **Environment Management**: Dynamic .env generation from IaC outputs

## Folder Structure

- `/client`: **Frontend Application**
  - `/src`: React application source code with TypeScript
    - `/components`: Reusable UI components (Button, Card, Progress, etc.)
    - `/lib`: Utility functions and configurations
  - `Dockerfile`: Multi-stage build for optimized production image
  - `nginx.conf`: Nginx configuration for serving static files
  - `vite.config.ts`: Vite build configuration
  - `tailwind.config.js`: Tailwind CSS customization
  - `package.json`: Dependencies (React, TypeScript, DASH.js, Socket.IO)

- `/server`: **Backend API**
  - `/src`: Node.js/Express backend source
    - `/config`: Database and AWS service configurations
    - `/models`: Mongoose schemas for MongoDB
    - `/routes`: API endpoint definitions
    - `/services`: Business logic (video, S3, SQS services)
    - `/middleware`: Authentication, rate limiting, validation
    - `server.ts`: Express server with Socket.IO setup
  - `Dockerfile`: Multi-stage build with security best practices
  - `package.json`: Dependencies (Express, Mongoose, Socket.IO, AWS SDK)
  - `.env`: Environment variables (S3, SQS, MongoDB, Redis config)

- `/container`: **Video Processing Worker**
  - `/src`: FFmpeg video processing logic
    - `process-video.ts`: Main processing orchestrator
    - `ffmpeg-service.ts`: FFmpeg wrapper for transcoding
    - `s3-service.ts`: S3 upload/download operations
    - `webhook-service.ts`: Completion notification
  - `Dockerfile`: FFmpeg + Node.js container
  - `package.json`: Dependencies (AWS SDK, FFmpeg)

- `/lambda`: **ECS Task Orchestrator**
  - `/src` or `/dist`: Lambda function code
  - `index.js`: SQS trigger handler, ECS task launcher
  - Configuration for Spot/Regular instance selection
  - Package dependencies for AWS SDK

- `/IaC`: **Infrastructure as Code (Pulumi)**
  - `/src`: Modular infrastructure components
    - `/networking`: VPC, subnets, ALB, security groups
    - `/compute`: EC2, ECS, Lambda, ECR, Autoscaling
    - `/storage`: S3 buckets with lifecycle policies
    - `/database`: MongoDB and Redis instance configs
    - `/messaging`: SQS queue and dead letter queue
    - `/monitoring`: CloudWatch logs, metrics, alarms
    - `/security`: IAM roles and policies
    - `/config`: Centralized configuration
  - `/bin`: Pulumi app entry point
  - `index.ts`: Main infrastructure export file
  - `Pulumi.yaml`: Pulumi project configuration
  - `tsconfig.json`: TypeScript configuration

- `/ansible`: **Configuration Management**
  - `site.yml`: Main playbook for full deployment
  - `deploy-backend.yml`: Backend deployment playbook
  - `deploy-client.yml`: Frontend deployment playbook
  - `setup-mongodb-replica-set.yml`: MongoDB cluster setup
  - `redis-docker-setup.yml`: Redis installation
  - `hosts.ini` / `inventory.j2`: Dynamic inventory templates
  - `production-env.j2`: Environment variable templates

- `/doc`: **Documentation**
  - Architecture diagrams and detailed explanations
  - Video processing pipeline documentation
  - Critical implementation examples

- `Makefile`: **Deployment Automation**
  - `deploy-all`: One-command full deployment
  - `deploy-fast`: Quick code update deployment
  - `setup-mongodb`: MongoDB replica set setup
  - `setup-redis`: Redis cache setup
  - Database management and status check commands
  - Container build and push commands
  - Infrastructure provisioning commands

- `docker-compose.yml`: Local development environment (optional)
- `README.md`: Project documentation
- `Project-details.md`: Technical implementation details

## Prerequisites

Before deploying the application, ensure you have the following:

**Required:**
- **AWS Account** with permissions for EC2, ECS, S3, Lambda, CloudFront, IAM, VPC, ALB
- **AWS CLI** installed and configured (`aws configure` with access keys)
- **Docker** installed (version 20.10+) for building and pushing containers
- **Node.js** (version 18 or above) and **npm** installed
- **Pulumi** installed for infrastructure as code (`curl -fsSL https://get.pulumi.com | sh`)
- **Pulumi Account** (free tier works) - sign up at pulumi.com
- **Ansible** installed for configuration management (`pip install ansible`)
- **TypeScript** (version 5 or above) installed globally (`npm install -g typescript`)
- **Make** utility (pre-installed on Linux/Mac, Windows users can use WSL)
- **SSH key** for AWS EC2 access (will be auto-generated if not exists)

**Optional:**
- **MongoDB Atlas** account (for development, production uses local replica set)
- **Redis** (for local development, production uses AWS-deployed Redis)
- **FFmpeg** (for local video processing testing)

**AWS Service Limits to Check:**
- ECS Fargate: At least 10 concurrent tasks
- EC2: At least 5 t3.micro instances in your region
- S3: Unlimited (default)
- VPC: At least 1 VPC available
- Elastic IPs: At least 3 available

## Getting Started

### Quick Start (One Command Deployment)

```bash
# Clone the repository
git clone https://github.com/yourusername/vision-sync.git
cd vision-sync

# Deploy everything (infrastructure + backend + databases)
make deploy-all
```

This single command will:
1. Install all dependencies (frontend, backend, lambda, container, IaC)
2. Build all components
3. Deploy AWS infrastructure (VPC, EC2, ECS, S3, Lambda, ALB, etc.)
4. Build and push Docker images to ECR
5. Configure databases (MongoDB replica set + Redis)
6. Deploy backend services
7. Show deployment URLs

### Step-by-Step Setup (Detailed)

**1. Clone and Install**

```bash
git clone https://github.com/yourusername/vision-sync.git
cd vision-sync

# Install all dependencies
make install
```

**2. Configure AWS**

```bash
# Set your AWS credentials
aws configure
# Enter: AWS Access Key ID, Secret Access Key, Region (ap-southeast-1), Output format (json)

# Verify configuration
aws sts get-caller-identity
```

**3. Configure Pulumi**

```bash
cd IaC
pulumi login
pulumi stack init dev  # or your preferred stack name
pulumi config set aws:region ap-southeast-1
cd ..
```

**4. Set Up Environment Variables**

Create a `.env` file in `/server` directory:

```bash
# AWS Configuration
AWS_REGION=ap-southeast-1
S3_BUCKET_RAW=<will be auto-filled by make update-env>
S3_BUCKET_PROCESSED=<will be auto-filled by make update-env>
SQS_QUEUE_URL=<will be auto-filled by make update-env>
CLOUDFRONT_DOMAIN=<will be auto-filled by make update-env>

# Database (for development, use MongoDB Atlas)
MONGODB_URI=mongodb://localhost:27017/vision-sync
REDIS_URL=redis://localhost:6379

# Server Configuration
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
CORS_ORIGIN=*

# Socket.IO
SOCKET_IO_CORS_ORIGIN=http://localhost:3000

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

Create a `.env` file in `/client` directory:

```bash
# Backend API URL
VITE_API_URL=http://localhost:5000

# Socket.IO URL
VITE_SOCKET_URL=http://localhost:5000
```

**Note**: After running `make deploy`, use `make update-env` to automatically populate AWS resource values in `server/.env`.

**5. Build All Components**

```bash
make build
```

**6. Deploy Infrastructure**

```bash
# Deploy AWS infrastructure
make deploy

# This will:
# - Create VPC, subnets, security groups
# - Launch EC2 instances (bastion, backend, MongoDB, Redis)
# - Set up ECS cluster and task definitions
# - Create S3 buckets, SQS queue, Lambda function
# - Configure ALB, CloudFront distribution
# - Automatically update server/.env with resource URLs
```

**7. Setup Databases**

```bash
# Setup MongoDB replica set (1 Primary + 2 Secondary)
make setup-mongodb

# Setup Redis cache
make setup-redis

# Or setup both at once
make setup-all-db
```

**8. Build and Push Docker Images**

```bash
# Build and push all containers to ECR
make push-containers
```

**9. Deploy Backend Services**

```bash
make deploy-services
```

**10. Verify Deployment**

```bash
# Check deployment status
make status

# View all resource URLs
make outputs

# Test backend health
curl http://<BACKEND_IP>:5000/health
```

### Local Development Setup

For local development without AWS:

```bash
# Terminal 1: Start backend
cd server
npm run dev

# Terminal 2: Start frontend
cd client
npm run dev

# Terminal 3: Start MongoDB (if local)
mongod --replSet rs0

# Terminal 4: Start Redis (if local)
redis-server
```

Access the application:
- Frontend: http://localhost:3000
- Backend: http://localhost:5000
- API Health: http://localhost:5000/health

## Deployment Commands

The application provides comprehensive automation through Makefile:

### Main Deployment Commands

**🚀 Complete Deployment**
```bash
make deploy-all        # Deploy everything: infra + backend + databases + services
make deploy-fast       # Quick update for code changes only
```

### Infrastructure Management

```bash
make deploy            # Deploy AWS infrastructure with Pulumi
make destroy           # Destroy all AWS resources (with confirmation)
make status            # Check deployment status and resource summary
make outputs           # Show all Pulumi outputs (S3, SQS, CloudFront, etc.)
```

### Container Management

```bash
make push-containers   # Build and push all images (backend, frontend, video processor)
make container         # Build and push video processor container to ECR
make docker-clean      # Clean Docker resources and free up space
```

### Database Setup

```bash
make setup-mongodb     # Setup MongoDB replica set (1 Primary + 2 Secondary)
make setup-redis       # Setup Redis cache with Docker
make setup-all-db      # Setup both MongoDB and Redis
make check-mongodb     # Verify MongoDB replica set status
make check-redis       # Verify Redis server status
```

### Backend Operations

```bash
make deploy-backend    # Full backend deployment to EC2
make update-backend    # Update backend container only
make status-backend    # Check backend health and status
make logs-backend      # View backend container logs
make ssh-backend       # SSH into backend EC2 instance
```

### Development Commands

```bash
make install           # Install all dependencies (server, client, lambda, container, IaC)
make build             # Build all components
make dev               # Start local development servers (backend + frontend)
make clean             # Clean build artifacts
make reset             # Clean everything and reinstall
```

### Environment & Configuration

```bash
make update-env        # Auto-update server/.env with AWS resource values
make env               # Show basic environment variables
make create-inventory  # Create Ansible inventory from Pulumi outputs
make check-ansible     # Validate Ansible configuration
```

### Monitoring & Logs

```bash
make logs-lambda       # View Lambda function logs
make logs-ecs          # View ECS container logs
make logs-server       # View local server logs
```

### Utility Commands

```bash
make help              # Show all available commands
make troubleshoot      # Show common issues and solutions
make post-deploy       # Show configuration after deployment
```

### Example Workflows

**First-Time Deployment:**
```bash
make install           # Install dependencies
make deploy-all        # Deploy everything
```

**Code Update:**
```bash
make deploy-fast       # Quick update
```

**Database Issues:**
```bash
make check-mongodb     # Check MongoDB status
make check-redis       # Check Redis status
make setup-all-db      # Recreate databases
```

**Debugging:**
```bash
make status            # Overall status
make logs-backend      # Backend logs
make logs-ecs          # Video processing logs
make troubleshoot      # Common solutions
```

## Application URLs

After successful deployment, access your services at:

```bash
# Get all URLs
make outputs
```

**Main Application:**
- **Frontend**: `http://<FRONTEND_PUBLIC_IP>` or `https://<CLOUDFRONT_DOMAIN>`
- **Backend API**: `http://<ALB_DNS_NAME>` or `http://<BACKEND_IP>:5000`
- **Health Check**: `http://<BACKEND_IP>:5000/health`
- **Socket.IO**: `ws://<BACKEND_IP>:5000`

**AWS Resources:**
- **S3 Raw Bucket**: `s3://<RAW_BUCKET_NAME>`
- **S3 Processed Bucket**: `s3://<PROCESSED_BUCKET_NAME>`
- **CloudFront Distribution**: `https://<CLOUDFRONT_DOMAIN>`
- **SQS Queue**: `<SQS_QUEUE_URL>`
- **ECR Repository**: `<ECR_REPOSITORY_URL>`

**Example URLs:**
```
Frontend:     http://54.251.192.45
Backend:      http://alb-vision-1234567890.ap-southeast-1.elb.amazonaws.com
Health:       http://54.251.192.45:5000/health
CloudFront:   https://d3abc123xyz.cloudfront.net
```

**Direct Access:**
```bash
# SSH to backend
ssh -i ~/.ssh/vision-sync-backend ubuntu@<BACKEND_IP>

# SSH to bastion (for accessing private resources)
ssh -i ~/.ssh/vision-sync-backend ubuntu@<BASTION_IP>

# From bastion, access MongoDB primary
ssh ubuntu@<MONGODB_PRIMARY_IP>

# From bastion, access Redis
ssh ubuntu@<REDIS_IP>
```

## Video Processing Pipeline

VisionSync implements a sophisticated serverless video processing pipeline optimized for cost and performance:

### Complete Processing Flow

```
User Upload → Backend → S3 Raw → SQS → Lambda → ECS Fargate → FFmpeg Processing → S3 Processed → Webhook → Backend → Socket.IO → User
```

### Step-by-Step Breakdown

**1. Video Upload Initiation**
```typescript
// User requests presigned URL from backend
POST /api/videos/upload-url
Body: { filename, fileSize, contentType }

// Backend generates presigned S3 URL (valid for 15 minutes)
Response: { uploadUrl, videoId, expiresIn }

// User uploads directly to S3 using presigned URL
PUT <uploadUrl>
Body: <video file>
```

**2. SQS Message Trigger**
```javascript
// Backend sends processing message to SQS
await sqsService.sendVideoProcessingMessage(
  config.S3_BUCKET_RAW,
  `videos/${videoId}/${filename}`,
  videoId
);

// Updates video status in MongoDB
status: "PROCESSING"

// Emits Socket.IO event
socket.emit('video:status', { videoId, status: 'processing' })
```

**3. Lambda Orchestration**
```javascript
// Lambda triggered by SQS message
// Determines processing strategy based on file size
const useSpot = fileSize < 1_000_000_000 && Math.random() < 0.7; // 70% Spot

// Launches ECS Fargate task
await ecs.runTask({
  cluster: ECS_CLUSTER,
  taskDefinition: TASK_DEFINITION,
  capacityProviderStrategy: useSpot ?
    [{ capacityProvider: 'FARGATE_SPOT', weight: 1 }] :
    [{ capacityProvider: 'FARGATE', weight: 1 }],
  overrides: {
    containerOverrides: [{
      environment: [
        { name: 'VIDEO_ID', value: videoId },
        { name: 'S3_KEY', value: s3Key },
        { name: 'WEBHOOK_URL', value: webhookUrl },
        { name: 'FFMPEG_PRESET', value: useSpot ? 'medium' : 'fast' }
      ]
    }]
  }
});
```

**4. ECS Container Processing**

The container performs these steps:

```typescript
// Download video from S3
await downloadFromS3(bucket, key, localPath);

// Process with FFmpeg
const resolutions = useSpot ?
  ['720p', '480p', '360p'] :  // Cost-optimized
  ['1080p', '720p', '480p', '360p'];  // Quality-optimized

// For each resolution
for (const resolution of resolutions) {
  // Transcode video
  await ffmpeg
    .input(inputPath)
    .size(resolution)
    .videoBitrate(bitrate)
    .audioBitrate('128k')
    .outputOptions([
      '-f dash',                    // DASH format
      `-seg_duration ${segmentDuration}`,  // 4-6 second segments
      '-use_timeline 1',
      '-use_template 1',
      '-adaptation_sets "id=0,streams=v id=1,streams=a"'
    ])
    .save(outputPath);
}

// Generate manifest.mpd
await generateDashManifest(outputDir);

// Upload all chunks and manifest to S3
await uploadDirectory(outputDir, processedBucket, videoId);

// Generate thumbnail
await generateThumbnail(inputPath, thumbnailPath);
await uploadToS3(thumbnailPath, processedBucket, `${videoId}/thumbnail.jpg`);
```

**5. Webhook Notification**
```typescript
// Container sends webhook to backend
POST <WEBHOOK_URL>/api/webhook/processing-complete
Body: {
  videoId,
  status: 'ready',
  manifestUrl: `${cloudfrontDomain}/${videoId}/manifest.mpd`,
  thumbnailUrl: `${cloudfrontDomain}/${videoId}/thumbnail.jpg`,
  resolutions: ['1080p', '720p', '480p', '360p'],
  duration: 600,
  processingTime: 180
}

// Backend updates MongoDB
await Video.findByIdAndUpdate(videoId, {
  status: 'ready',
  manifestUrl,
  thumbnailUrl,
  resolutions,
  processedAt: new Date()
});

// Emits Socket.IO event
io.to(videoId).emit('video:ready', {
  videoId,
  manifestUrl,
  thumbnailUrl
});
```

**6. Client Playback**
```typescript
// Frontend receives Socket.IO event
socket.on('video:ready', ({ videoId, manifestUrl }) => {
  // Initialize DASH player
  const player = dashjs.MediaPlayer().create();
  player.initialize(videoElement, manifestUrl, autoPlay);

  // Player automatically selects quality based on bandwidth
  player.updateSettings({
    streaming: {
      abr: {
        autoSwitchBitrate: { video: true }
      }
    }
  });
});
```

### Cost Optimization Strategy

**Spot vs Regular Instance Selection:**

| Condition | Instance Type | Cost Savings | Trade-off |
|-----------|--------------|--------------|-----------|
| File < 1GB AND 70% probability | Spot | 70% cheaper | May be interrupted |
| File ≥ 1GB OR Spot unavailable | Regular | Standard cost | Guaranteed completion |

**Processing Settings by Instance:**

| Setting | Spot Instance | Regular Instance |
|---------|--------------|------------------|
| Resolutions | 720p, 480p, 360p | 1080p, 720p, 480p, 360p |
| FFmpeg Preset | medium | fast |
| CRF | 25 | 23 |
| Segment Duration | 6 seconds | 4 seconds |
| Threads | 1 | 2 |
| Max Processing Time | 60 minutes | 30 minutes |

**Additional Optimizations:**
- S3 Lifecycle: Move old videos to Glacier after 90 days
- CloudFront: Cache popular videos at edge locations
- Batch Mode: Process multiple small jobs together
- Dead Letter Queue: Retry failed jobs up to 3 times

### Real-Time Status Updates

Users receive live updates throughout the process:

```typescript
// Upload progress
socket.emit('video:uploading', { videoId, progress: 45 });

// Processing started
socket.emit('video:processing', { videoId, stage: 'transcoding' });

// Processing progress (from container webhooks)
socket.emit('video:processing', { videoId, stage: 'encoding-720p', progress: 60 });

// Processing complete
socket.emit('video:ready', { videoId, manifestUrl, thumbnailUrl });

// Error handling
socket.emit('video:error', { videoId, error: 'Processing failed', retryable: true });
```

This pipeline ensures efficient, cost-effective video processing with high reliability and excellent user experience.

## Auto Scaling Across Multiple AZs

Our autoscaling setup distributes backend instances across multiple availability zones for maximum fault tolerance and performance.

### Multi-AZ Configuration

**Availability Zones:**
- **AZ-A (ap-southeast-1a)**: Public subnet (frontend, ALB) + Private subnet (backend)
- **AZ-B (ap-southeast-1b)**: Public subnet (ALB) + Private subnet (backend, ECS tasks)
- **AZ-C (ap-southeast-1c)**: Private subnet (MongoDB replica set, Redis)

**Subnet Layout:**
```
Public Subnets:
├── AZ-A: 10.10.1.0/24 (Frontend EC2, ALB, Bastion)
└── AZ-B: 10.10.2.0/24 (ALB)

Private Subnets:
├── AZ-A: 10.10.3.0/24 (Backend EC2)
├── AZ-B: 10.10.4.0/24 (Backend EC2, ECS Tasks)
└── AZ-C: 10.10.5.0/24 (MongoDB Primary + Secondary, Redis)
```

**Backend Auto Scaling Group Configuration:**
```yaml
Desired Capacity: 2 instances
Minimum Size: 1 instance
Maximum Size: 5 instances
Instance Type: t3.micro
Health Check: ALB with 300 seconds grace period
Evaluation Period: 2 minutes
```

**ECS Auto Scaling Configuration:**
```yaml
Service: Video Processing
Desired Tasks: 0 (scales based on SQS)
Minimum Tasks: 0
Maximum Tasks: 10
Scaling Metric: SQS Queue Depth
Target: 1 message per task
Scale-out Cooldown: 60 seconds
Scale-in Cooldown: 300 seconds
```

### Instance Distribution

**Initial Backend Deployment:**
```
2 instances:
├── AZ-A: 1 backend instance (private subnet)
└── AZ-B: 1 backend instance (private subnet)
```

**Scale-Up Scenarios:**
```
3 instances: AZ-A (2), AZ-B (1)
4 instances: AZ-A (2), AZ-B (2)
5 instances: AZ-A (3), AZ-B (2) or AZ-A (2), AZ-B (3)
```

**ECS Task Distribution:**
```
Video processing tasks distribute across:
├── Private Subnet AZ-A (10.10.3.0/24)
└── Private Subnet AZ-B (10.10.4.0/24)

Tasks are assigned based on:
- Available resources in each AZ
- Current task count per AZ
- Spot vs Regular capacity provider selection
```

### Scaling Triggers

**Backend EC2 Auto Scaling:**

| Policy | Metric | Threshold | Duration | Action | Cooldown |
|--------|--------|-----------|----------|--------|----------|
| Scale Out | CPU Utilization | > 80% | 2 minutes | +1 instance | 300s |
| Scale In | CPU Utilization | < 10% | 5 minutes | -1 instance | 300s |

**ECS Task Auto Scaling:**

| Policy | Metric | Threshold | Action | Cooldown |
|--------|--------|-----------|--------|----------|
| Scale Out | SQS Messages | > 1 per task | +1 task | 60s |
| Scale In | SQS Messages | 0 messages | -1 task | 300s |

**Additional Triggers:**
- **Network Throttling**: Scale out if NetworkIn > 10MB/s sustained
- **Memory Pressure**: Scale out if MemoryUtilization > 85%
- **Socket Connections**: Scale out if concurrent Socket.IO connections > 1000

### Fault Tolerance Benefits

**Single AZ Failure Scenario:**
1. **Detection** (< 30 seconds):
   - ALB health checks detect unhealthy instances
   - CloudWatch alarms trigger
   - Auto Scaling marks instances as unhealthy

2. **Traffic Rerouting** (immediate):
   - ALB stops routing to failed AZ
   - All traffic goes to healthy AZ instances
   - Socket.IO connections reconnect automatically

3. **Recovery** (5-10 minutes):
   - Auto Scaling launches replacement instances
   - New instances register with ALB
   - Health checks pass, traffic resumes

4. **Data Consistency**:
   - MongoDB replica set maintains data integrity
   - Redis persists session data
   - Video processing jobs retry from SQS

**Database Resilience:**
- MongoDB: Automatic failover from Primary to Secondary (< 10 seconds)
- Redis: Persistence enabled, AOF every second
- Backup: Automated daily snapshots

**Load Balancer Integration:**
- ALB spans public subnets in AZ-A and AZ-B
- Cross-zone load balancing enabled
- Health checks every 30 seconds (3 unhealthy = remove)
- Deregistration delay: 30 seconds (for graceful shutdown)
- Sticky sessions: Enabled (for Socket.IO)

**Zero-Downtime Deployments:**
```bash
# Rolling update strategy
1. Deploy new version to 1 instance
2. Wait for health checks to pass
3. Deploy to next instance
4. Repeat until all updated
5. Keep minimum 50% capacity during update
```

## Troubleshooting

### Common Issues & Solutions

**1. Video Upload Fails**
```bash
# Check S3 bucket permissions
aws s3 ls s3://<RAW_BUCKET_NAME>

# Verify backend can generate presigned URLs
curl http://<BACKEND_IP>:5000/health

# Check backend logs
make logs-backend

# Solution: Verify IAM role has S3 PutObject permission
```

**2. Video Processing Stuck**
```bash
# Check SQS queue for messages
aws sqs get-queue-attributes \
  --queue-url <SQS_QUEUE_URL> \
  --attribute-names ApproximateNumberOfMessages

# Check Lambda logs
make logs-lambda

# Check ECS tasks
aws ecs list-tasks --cluster vision-sync-cluster

# Check dead letter queue
aws sqs receive-message --queue-url <DLQ_URL>

# Solution: Check Lambda has permission to launch ECS tasks
```

**3. Socket.IO Not Connecting**
```bash
# Test Socket.IO endpoint
curl http://<BACKEND_IP>:5000/socket.io/

# Check CORS configuration
# server/.env should have: CORS_ORIGIN=*

# Check Redis connection
ssh -i ~/.ssh/vision-sync-backend ubuntu@<REDIS_IP>
docker exec redis-server redis-cli ping

# Solution: Ensure Socket.IO CORS allows frontend domain
```

**4. MongoDB Connection Errors**
```bash
# Check replica set status
make check-mongodb

# Connect to primary
ssh -i ~/.ssh/vision-sync-backend ubuntu@<MONGODB_PRIMARY_IP>
mongosh --eval "rs.status()"

# Check if replica set is initialized
mongosh --eval "rs.isMaster()"

# Solution: Re-run MongoDB setup
make setup-mongodb
```

**5. Redis Connection Issues**
```bash
# Check Redis status
make check-redis

# Test Redis connection
ssh -i ~/.ssh/vision-sync-backend ubuntu@<REDIS_IP>
docker ps | grep redis
docker logs redis-server

# Solution: Restart Redis container
ssh ubuntu@<REDIS_IP> "docker restart redis-server"
```

**6. Backend 502/503 Errors**
```bash
# Check ALB target health
aws elbv2 describe-target-health \
  --target-group-arn <TARGET_GROUP_ARN>

# Check backend health
curl http://<BACKEND_IP>:5000/health

# Check backend logs
make logs-backend

# Solution: Verify security groups allow ALB → Backend traffic
```

**7. ECS Tasks Failing**
```bash
# View ECS task logs
make logs-ecs

# Check task definition
aws ecs describe-task-definition \
  --task-definition vision-sync-video-processor

# Check ECR image exists
aws ecr describe-images \
  --repository-name vision-sync-video-processor

# Solution: Rebuild and push container
make container
```

**8. CloudFront Not Serving Videos**
```bash
# Check S3 processed bucket
aws s3 ls s3://<PROCESSED_BUCKET_NAME>/ --recursive

# Test CloudFront URL
curl -I https://<CLOUDFRONT_DOMAIN>/test-video/manifest.mpd

# Check CloudFront distribution status
aws cloudfront get-distribution --id <DISTRIBUTION_ID>

# Solution: Verify CloudFront OAI has S3 read permission
```

**9. High AWS Costs**
```bash
# Check running ECS tasks
aws ecs list-tasks --cluster vision-sync-cluster

# Check EC2 instances
aws ec2 describe-instances --filters "Name=instance-state-name,Values=running"

# Check S3 storage
aws s3 ls s3://<BUCKET_NAME> --recursive --summarize

# Solution:
# - Implement S3 lifecycle policies
# - Reduce ECS max tasks
# - Use more Spot instances
# - Scale down EC2 auto scaling group
```

**10. Pulumi State Conflicts**
```bash
# Check current stack
cd IaC && pulumi stack

# Export state
pulumi stack export > backup.json

# Cancel pending operations
pulumi cancel

# Solution: Refresh state
pulumi refresh
```

### Debug Commands

**System Overview:**
```bash
make status                 # Overall deployment status
make outputs                # All resource URLs
make troubleshoot           # Common issues guide
```

**Backend Debugging:**
```bash
make logs-backend           # View backend logs
make ssh-backend            # SSH into backend
make status-backend         # Backend health check

# Inside backend instance
docker ps
docker logs vision-sync-backend
docker exec -it vision-sync-backend sh
```

**Database Debugging:**
```bash
make check-mongodb          # MongoDB status
make check-redis            # Redis status

# MongoDB replica set info
ssh ubuntu@<MONGODB_IP>
mongosh --eval "rs.status()" | grep -E "(stateStr|name)"

# Redis info
ssh ubuntu@<REDIS_IP>
docker exec redis-server redis-cli info | grep connected
```

**Video Processing Debugging:**
```bash
make logs-ecs               # ECS container logs
make logs-lambda            # Lambda orchestration logs

# Check SQS queue
aws sqs get-queue-attributes \
  --queue-url <SQS_URL> \
  --attribute-names All

# Check specific ECS task
aws ecs describe-tasks \
  --cluster vision-sync-cluster \
  --tasks <TASK_ARN>
```

**Network Debugging:**
```bash
# Test connectivity from bastion
ssh -i ~/.ssh/vision-sync-backend ubuntu@<BASTION_IP>

# From bastion, test backend
curl http://<BACKEND_PRIVATE_IP>:5000/health

# From bastion, test MongoDB
telnet <MONGODB_IP> 27017

# From bastion, test Redis
telnet <REDIS_IP> 6379
```

**Performance Issues:**
```bash
# Check CloudWatch metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=AutoScalingGroupName,Value=<ASG_NAME> \
  --start-time 2025-01-01T00:00:00Z \
  --end-time 2025-01-09T00:00:00Z \
  --period 3600 \
  --statistics Average

# Check ALB metrics
aws cloudwatch get-metric-statistics \
  --namespace AWS/ApplicationELB \
  --metric-name TargetResponseTime
```

### Emergency Procedures

**Complete Restart:**
```bash
# 1. Stop all services
make destroy

# 2. Clean local state
make reset

# 3. Redeploy everything
make deploy-all
```

**Backend Only Restart:**
```bash
make update-backend
```

**Database Reset:**
```bash
# WARNING: This deletes all data
ssh ubuntu@<MONGODB_IP> "docker rm -f mongodb"
make setup-mongodb
```

## API Documentation

VisionSync provides a comprehensive RESTful API for video management, upload, and streaming operations.

### Base URLs

**Production**: `http://<ALB_DNS_NAME>` or `http://<BACKEND_IP>:5000`
**Development**: `http://localhost:5000`
**CloudFront CDN**: `https://<CLOUDFRONT_DOMAIN>`

### Authentication

Currently, the API uses session-based authentication. Future versions will implement JWT tokens.

### Rate Limiting

Multiple rate limiting algorithms are implemented:
- **Default**: 100 requests per 15 minutes per IP
- **Upload endpoint**: 10 requests per 15 minutes per IP
- **Streaming**: Unlimited (handled by CloudFront)

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1736524800
```

### Endpoints

#### Health Check
```http
GET /health
```

**Description**: Check server health and status

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-09T10:30:00.000Z",
  "uptime": 3600,
  "mongodb": "connected",
  "redis": "connected",
  "services": {
    "s3": "available",
    "sqs": "available",
    "ecs": "available"
  }
}
```

**Status Codes:**
- `200 OK` - Server is healthy
- `503 Service Unavailable` - Server or dependencies are down

### Video Management

#### Get Presigned Upload URL
```http
POST /api/videos/upload-url
Content-Type: application/json
```

**Description**: Request a presigned S3 URL for direct video upload

**Request Body:**
```json
{
  "filename": "my-video.mp4",
  "fileSize": 52428800,
  "contentType": "video/mp4"
}
```

**Validation:**
- `filename`: Required, string, max 255 chars
- `fileSize`: Required, number, max 5GB (5368709120 bytes)
- `contentType`: Required, must be video/* MIME type

**Response:**
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://vision-sync-raw-bucket.s3.amazonaws.com/videos/...",
    "videoId": "677f3a5c9e8f1b2c3d4e5f6a",
    "expiresIn": 900,
    "key": "videos/677f3a5c9e8f1b2c3d4e5f6a/my-video.mp4"
  }
}
```

**Status Codes:**
- `200 OK` - Upload URL generated successfully
- `400 Bad Request` - Invalid request parameters
- `413 Payload Too Large` - File size exceeds limit
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - S3 service error

**Usage Example:**
```javascript
// Step 1: Get presigned URL
const response = await fetch('/api/videos/upload-url', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filename: file.name,
    fileSize: file.size,
    contentType: file.type
  })
});
const { uploadUrl, videoId } = await response.json();

// Step 2: Upload directly to S3
await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: { 'Content-Type': file.type }
});

// Step 3: Confirm upload
await fetch(`/api/videos/${videoId}/confirm`, { method: 'POST' });
```

#### Confirm Video Upload
```http
POST /api/videos/:videoId/confirm
```

**Description**: Trigger video processing after successful S3 upload

**Path Parameters:**
- `videoId`: UUID of the video

**Response:**
```json
{
  "success": true,
  "message": "Video processing started",
  "data": {
    "videoId": "677f3a5c9e8f1b2c3d4e5f6a",
    "status": "processing",
    "estimatedTime": 300
  }
}
```

**Status Codes:**
- `200 OK` - Processing initiated
- `404 Not Found` - Video not found
- `409 Conflict` - Video already processing

#### Get All Videos
```http
GET /api/videos
```

**Description**: Retrieve list of all uploaded videos

**Query Parameters:**
- `status` (optional): Filter by status (uploading, processing, ready, failed)
- `limit` (optional): Number of videos per page (default: 20, max: 100)
- `skip` (optional): Number of videos to skip (pagination)
- `sort` (optional): Sort field (createdAt, filename, duration)
- `order` (optional): Sort order (asc, desc)

**Response:**
```json
{
  "success": true,
  "data": {
    "videos": [
      {
        "_id": "677f3a5c9e8f1b2c3d4e5f6a",
        "filename": "my-video.mp4",
        "fileSize": 52428800,
        "status": "ready",
        "manifestUrl": "https://d3abc123xyz.cloudfront.net/677f3a5c.../manifest.mpd",
        "thumbnailUrl": "https://d3abc123xyz.cloudfront.net/677f3a5c.../thumbnail.jpg",
        "duration": 120,
        "resolutions": ["1080p", "720p", "480p", "360p"],
        "uploadedAt": "2025-01-09T10:00:00.000Z",
        "processedAt": "2025-01-09T10:03:45.000Z",
        "processingTime": 225
      }
    ],
    "total": 45,
    "limit": 20,
    "skip": 0
  }
}
```

**Status Codes:**
- `200 OK` - Videos retrieved successfully
- `400 Bad Request` - Invalid query parameters

#### Get Single Video
```http
GET /api/videos/:videoId
```

**Description**: Retrieve detailed information about a specific video

**Path Parameters:**
- `videoId`: UUID of the video

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "677f3a5c9e8f1b2c3d4e5f6a",
    "filename": "my-video.mp4",
    "originalFilename": "my-video.mp4",
    "fileSize": 52428800,
    "contentType": "video/mp4",
    "status": "ready",
    "manifestUrl": "https://d3abc123xyz.cloudfront.net/677f3a5c.../manifest.mpd",
    "thumbnailUrl": "https://d3abc123xyz.cloudfront.net/677f3a5c.../thumbnail.jpg",
    "duration": 120,
    "resolutions": ["1080p", "720p", "480p", "360p"],
    "s3Keys": {
      "raw": "videos/677f3a5c.../my-video.mp4",
      "processed": "processed/677f3a5c.../"
    },
    "metadata": {
      "codec": "h264",
      "width": 1920,
      "height": 1080,
      "fps": 30,
      "bitrate": 5000000
    },
    "uploadedAt": "2025-01-09T10:00:00.000Z",
    "processedAt": "2025-01-09T10:03:45.000Z",
    "processingTime": 225,
    "processingDetails": {
      "instanceType": "fargate_spot",
      "preset": "medium",
      "compressionRatio": 0.65
    }
  }
}
```

**Status Codes:**
- `200 OK` - Video found
- `404 Not Found` - Video does not exist

#### Delete Video
```http
DELETE /api/videos/:videoId
```

**Description**: Delete video and all associated files from S3

**Path Parameters:**
- `videoId`: UUID of the video

**Query Parameters:**
- `deleteFiles` (optional): Whether to delete S3 files (default: true)

**Response:**
```json
{
  "success": true,
  "message": "Video deleted successfully",
  "data": {
    "deletedFiles": {
      "raw": true,
      "processed": true
    }
  }
}
```

**Status Codes:**
- `200 OK` - Video deleted successfully
- `404 Not Found` - Video not found
- `500 Internal Server Error` - Failed to delete S3 files

#### Get Video Processing Status
```http
GET /api/videos/:videoId/status
```

**Description**: Get real-time processing status (also available via Socket.IO)

**Path Parameters:**
- `videoId`: UUID of the video

**Response:**
```json
{
  "success": true,
  "data": {
    "videoId": "677f3a5c9e8f1b2c3d4e5f6a",
    "status": "processing",
    "stage": "encoding-720p",
    "progress": 65,
    "estimatedTimeRemaining": 120,
    "currentResolution": "720p",
    "completedResolutions": ["1080p"],
    "message": "Encoding 720p resolution..."
  }
}
```

**Video Status Values:**
- `uploading` - File being uploaded to S3
- `processing` - Video being transcoded
- `ready` - Video processed and available for streaming
- `failed` - Processing failed

**Processing Stages:**
- `queued` - Waiting in SQS queue
- `downloading` - Downloading from S3 raw bucket
- `analyzing` - Analyzing video metadata
- `encoding-1080p/720p/480p/360p` - Encoding specific resolution
- `generating-manifest` - Creating DASH manifest
- `uploading-chunks` - Uploading to S3 processed bucket
- `finalizing` - Cleaning up and notifying backend

### Webhook Endpoints (Internal)

#### Video Processing Complete
```http
POST /api/webhook/processing-complete
Content-Type: application/json
X-Webhook-Secret: <shared_secret>
```

**Description**: Called by ECS container when video processing completes

**Request Body:**
```json
{
  "videoId": "677f3a5c9e8f1b2c3d4e5f6a",
  "status": "ready",
  "manifestUrl": "https://d3abc123xyz.cloudfront.net/677f3a5c.../manifest.mpd",
  "thumbnailUrl": "https://d3abc123xyz.cloudfront.net/677f3a5c.../thumbnail.jpg",
  "resolutions": ["1080p", "720p", "480p", "360p"],
  "duration": 120,
  "processingTime": 225,
  "metadata": {
    "codec": "h264",
    "fps": 30
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Webhook processed successfully"
}
```

### Socket.IO Events

VisionSync uses Socket.IO for real-time bidirectional communication.

**Connection:**
```javascript
import io from 'socket.io-client';

const socket = io('http://<BACKEND_IP>:5000', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});
```

#### Client → Server Events

**Join Video Room:**
```javascript
socket.emit('video:join', { videoId: '677f3a5c9e8f1b2c3d4e5f6a' });
```

**Leave Video Room:**
```javascript
socket.emit('video:leave', { videoId: '677f3a5c9e8f1b2c3d4e5f6a' });
```

#### Server → Client Events

**Video Upload Progress:**
```javascript
socket.on('video:upload-progress', (data) => {
  // data: { videoId, progress: 45, bytesUploaded: 23592960, totalBytes: 52428800 }
  console.log(`Upload progress: ${data.progress}%`);
});
```

**Video Processing Started:**
```javascript
socket.on('video:processing-started', (data) => {
  // data: { videoId, status: 'processing', estimatedTime: 300 }
  console.log('Processing started');
});
```

**Video Processing Progress:**
```javascript
socket.on('video:processing-progress', (data) => {
  // data: {
  //   videoId,
  //   stage: 'encoding-720p',
  //   progress: 65,
  //   currentResolution: '720p',
  //   completedResolutions: ['1080p']
  // }
  console.log(`${data.stage}: ${data.progress}%`);
});
```

**Video Ready:**
```javascript
socket.on('video:ready', (data) => {
  // data: {
  //   videoId,
  //   manifestUrl,
  //   thumbnailUrl,
  //   resolutions: ['1080p', '720p', '480p', '360p'],
  //   duration: 120
  // }
  console.log('Video ready for streaming!');
  initializePlayer(data.manifestUrl);
});
```

**Video Processing Failed:**
```javascript
socket.on('video:error', (data) => {
  // data: {
  //   videoId,
  //   error: 'Processing failed: Invalid codec',
  //   retryable: true,
  //   stage: 'encoding-1080p'
  // }
  console.error('Video processing error:', data.error);
});
```

**Connection Status:**
```javascript
socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', (reason) => {
  console.log('Disconnected:', reason);
});

socket.on('reconnect', (attemptNumber) => {
  console.log('Reconnected after', attemptNumber, 'attempts');
});
```

### Error Responses

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": {
    "code": "VIDEO_NOT_FOUND",
    "message": "Video with ID 677f3a5c9e8f1b2c3d4e5f6a not found",
    "details": {
      "videoId": "677f3a5c9e8f1b2c3d4e5f6a"
    }
  }
}
```

**Common HTTP Status Codes:**
- `200 OK` - Request successful
- `201 Created` - Resource created successfully
- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `409 Conflict` - Resource conflict (e.g., video already processing)
- `413 Payload Too Large` - File size exceeds limit
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Service temporarily unavailable

**Common Error Codes:**
- `VIDEO_NOT_FOUND` - Video does not exist
- `VIDEO_ALREADY_PROCESSING` - Video is already being processed
- `INVALID_FILE_TYPE` - Unsupported video format
- `FILE_TOO_LARGE` - File exceeds 5GB limit
- `UPLOAD_FAILED` - S3 upload failed
- `PROCESSING_FAILED` - Video processing encountered an error
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `S3_ERROR` - S3 service error
- `SQS_ERROR` - SQS service error
- `MONGODB_ERROR` - Database error
- `REDIS_ERROR` - Cache error

### CORS Configuration

**Allowed Origins:**
- Development: `http://localhost:3000`, `http://localhost:5173`
- Production: Configured via `CORS_ORIGIN` environment variable

**Allowed Methods:**
- `GET`, `POST`, `PUT`, `DELETE`, `OPTIONS`

**Allowed Headers:**
- `Content-Type`, `Authorization`, `X-Requested-With`

**Exposed Headers:**
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

## Scaling for High Load

### Current Production Features

**Multi-AZ High Availability:**
- **3 Availability Zones**: Distributed across ap-southeast-1a, 1b, 1c
- **Cross-AZ Load Balancing**: ALB distributes traffic across all healthy instances
- **Zone-Level Fault Tolerance**: Automatic failover if entire AZ fails
- **Database Replication**: MongoDB replica set with automatic failover

**Current Capacity:**
- Backend: 1-5 EC2 instances (t3.micro, auto-scaling)
- Video Processing: 0-10 ECS Fargate tasks (2 vCPU, 4GB RAM each)
- Concurrent Uploads: ~50 per minute
- Video Processing: ~10 concurrent jobs
- Storage: Unlimited S3
- CDN: CloudFront with global edge locations

**Performance Metrics:**
- Video Upload: Direct to S3, ~50MB/s
- Processing Time: 3-5 minutes per GB (depends on Spot vs Regular)
- Streaming Latency: <100ms via CloudFront
- API Response Time: <200ms average
- Socket.IO Latency: <50ms

### Scaling Strategy by Traffic Level

#### **Stage 1: Current (100-1000 users/day)**
✅ Current implementation handles this well
- Backend: 2 instances sufficient
- ECS: Auto-scales based on upload queue
- Cost: ~$100-200/month

#### **Stage 2: Growth (1000-10000 users/day)**

**Backend Scaling:**
```yaml
# Increase auto scaling limits
Backend EC2:
  Min: 2 instances
  Max: 10 instances
  Instance Type: t3.small

# Add more scaling metrics
Scaling Triggers:
  - CPU > 70%
  - Network In > 5MB/s
  - Active Connections > 500
  - Request Rate > 100 req/s
```

**Video Processing:**
```yaml
ECS Tasks:
  Min: 0
  Max: 50
  Priority: More Spot instances (80% Spot, 20% Regular)

SQS:
  Visibility Timeout: 1 hour
  Max Retention: 14 days
  Dead Letter Queue: After 3 retries
```

**Database:**
```yaml
MongoDB:
  - Keep replica set
  - Add more read replicas (1 Primary + 4 Secondary)
  - Enable oplog for better replication
  - Increase instance size (t3.medium)

Redis:
  - Upgrade to ElastiCache cluster
  - Enable automatic failover
  - Add read replicas
```

**Estimated Cost:** ~$500-1000/month

#### **Stage 3: Scale (10000-100000 users/day)**

**Backend Migration:**
```yaml
# Move to ECS for better scaling
ECS Backend Service:
  Task Definition:
    CPU: 512 (0.5 vCPU)
    Memory: 1024 MB
  Auto Scaling:
    Min Tasks: 4
    Max Tasks: 50
    Target Utilization: 70%

ALB:
  - Enable connection draining
  - Add multiple target groups
  - Implement weighted routing
```

**Video Processing Optimization:**
```yaml
# Implement queue prioritization
SQS:
  - High Priority Queue (small files < 100MB)
  - Standard Queue (100MB - 1GB)
  - Low Priority Queue (> 1GB)

# Parallel processing
ECS Tasks:
  - Process multiple resolutions in parallel
  - Use GPU instances for faster encoding
  - Implement chunk-based processing
```

**Storage Optimization:**
```yaml
S3:
  - Intelligent-Tiering for processed videos
  - Move to Glacier after 90 days
  - Delete raw videos after 30 days

CloudFront:
  - Add more cache behaviors
  - Increase TTL for popular videos
  - Implement request collapsing
  - Add Lambda@Edge for dynamic caching
```

**Database Scaling:**
```yaml
MongoDB:
  - Migrate to Atlas M30 or DocumentDB
  - Enable sharding for horizontal scaling
  - Implement read preference strategies
  - Add indexes on common queries

Redis:
  - ElastiCache cluster (3-5 nodes)
  - Cluster mode enabled
  - Automatic failover
  - Read replicas in each AZ
```

**Estimated Cost:** ~$2000-5000/month

#### **Stage 4: Enterprise (100000+ users/day)**

**Global Distribution:**
```yaml
Multi-Region Setup:
  Primary: ap-southeast-1 (Singapore)
  Secondary: us-east-1 (N. Virginia)
  Tertiary: eu-west-1 (Ireland)

Route53:
  - Geolocation routing
  - Latency-based routing
  - Health check failover
```

**Advanced Features:**
```yaml
# Content delivery optimization
CloudFront:
  - Origin Shield enabled
  - Custom error pages
  - Field-level encryption
  - WAF integration

# Video processing optimization
AWS MediaConvert:
  - Replace FFmpeg with MediaConvert
  - Professional encoding presets
  - Better quality at lower bitrates
  - Automatic QVBR encoding

# Database
MongoDB Atlas:
  - M60 or higher cluster
  - Global clusters for low latency
  - Full-text search
  - Analytics nodes

# Caching layers
ElastiCache:
  - Redis Cluster (10+ nodes)
  - DAX for DynamoDB (if migrated)
  - Application-level caching
```

**Monitoring & Observability:**
```yaml
# Enhanced monitoring
CloudWatch:
  - Custom metrics
  - Detailed alarms
  - Anomaly detection
  - Log Insights queries

# APM tools
DataDog/NewRelic:
  - Distributed tracing
  - Real-user monitoring
  - Error tracking
  - Performance profiling
```

**Estimated Cost:** ~$10,000-50,000/month

### Cost Optimization Tips

**Current Optimizations:**
✅ 70% Spot instances for ECS tasks
✅ S3 lifecycle policies
✅ CloudFront caching
✅ Efficient video chunking

**Additional Optimizations:**
1. **Reserved Instances**: Save 40-60% on EC2 costs
2. **S3 Intelligent-Tiering**: Automatic cost optimization
3. **Compute Savings Plans**: Flexible savings across services
4. **CDN Optimization**: Increase cache hit ratio to 90%+
5. **Delete Raw Videos**: After processing, save 50% storage
6. **Compression**: Better FFmpeg settings for smaller files
7. **Right-Sizing**: Monitor and adjust instance sizes

### Performance Optimization Roadmap

**Quick Wins (Week 1):**
- [ ] Enable CloudFront compression
- [ ] Implement API response caching
- [ ] Optimize database indexes
- [ ] Add connection pooling

**Medium Term (Month 1):**
- [ ] Implement video thumbnail sprite sheets
- [ ] Add video preview generation
- [ ] Implement progressive upload
- [ ] Add client-side chunking

**Long Term (Quarter 1):**
- [ ] Migrate to MediaConvert for better quality
- [ ] Implement HLS alongside DASH
- [ ] Add DRM support
- [ ] Implement live streaming

### Monitoring Metrics

**Key Metrics to Track:**
```yaml
Backend:
  - Request rate (req/s)
  - Response time (p50, p95, p99)
  - Error rate (%)
  - Active connections

Video Processing:
  - Queue depth
  - Processing time per GB
  - Success rate (%)
  - Cost per video

Storage:
  - S3 PUT/GET requests
  - CloudFront cache hit ratio
  - Bandwidth usage
  - Storage costs

Database:
  - Connection pool usage
  - Query performance
  - Replication lag
  - Disk usage
```

Your current architecture is production-ready and provides an excellent foundation for scaling to millions of users with incremental upgrades.

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes with clear messages
4. Push to your fork (`git push origin feature/amazing-feature`)
5. Open a Pull Request with detailed description

**Development Guidelines:**
- Follow TypeScript best practices
- Write descriptive commit messages
- Add tests for new features
- Update documentation
- Follow existing code style

## Support & Community

**Get Help:**
- Open an issue on GitHub for bugs or feature requests
- Check existing issues before creating new ones
- Provide detailed information for faster resolution

**Stay Updated:**
- Watch the repository for updates
- Follow the changelog for new releases
- Join discussions in the Issues section

## Acknowledgments

- AWS for cloud infrastructure
- Pulumi for Infrastructure as Code
- FFmpeg for video processing
- DASH.js for adaptive streaming
- Socket.IO for real-time communication
- MongoDB for database
- Redis for caching

Built with passion for learning cloud architecture, video streaming, and DevOps automation.

**"This is how I collect happiness—by building stuff!"** 🚀
