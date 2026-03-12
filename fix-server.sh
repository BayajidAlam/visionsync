#!/bin/bash
set -e

SERVER_ECR="366451245016.dkr.ecr.ap-southeast-1.amazonaws.com/vision-sync-server-dev"
CLIENT_ECR="366451245016.dkr.ecr.ap-southeast-1.amazonaws.com/vision-sync-client-dev"

echo "=== Stopping existing containers ==="
docker stop vision-sync-server 2>/dev/null || true
docker rm vision-sync-server 2>/dev/null || true
docker stop vision-sync-client 2>/dev/null || true
docker rm vision-sync-client 2>/dev/null || true

echo "=== Pulling latest images ==="
aws ecr get-login-password --region ap-southeast-1 | \
  docker login --username AWS --password-stdin 366451245016.dkr.ecr.ap-southeast-1.amazonaws.com
docker pull "$SERVER_ECR:latest"
docker pull "$CLIENT_ECR:latest"

echo "=== Starting server ==="
docker run -d \
  --name vision-sync-server \
  --restart unless-stopped \
  -p 5000:5000 \
  -e PORT=5000 \
  -e NODE_ENV=production \
  -e AWS_REGION=ap-southeast-1 \
  -e S3_BUCKET_RAW=vision-sync-raw-videos-dev \
  -e S3_BUCKET_PROCESSED=vision-sync-processed-videos-dev \
  -e "SQS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/366451245016/vision-sync-video-processing-dev" \
  -e "MONGODB_URI=mongodb://10.0.1.15:27017,10.0.174.69:27017,10.0.22.130:27017/vision-sync?replicaSet=rs0" \
  -e "REDIS_URL=redis://:VisionSyncRedis2024!@10.0.35.200:6379" \
  -e "CLOUDFRONT_DOMAIN=d11zonfo5y8dyu.cloudfront.net" \
  -e "FRONTEND_URL=http://localhost:3000" \
  "$SERVER_ECR:latest"

echo "=== Starting client ==="
docker run -d \
  --name vision-sync-client \
  --restart unless-stopped \
  -p 3000:80 \
  "$CLIENT_ECR:latest"

echo "=== Waiting for containers to start ==="
sleep 8

echo "=== Container status ==="
docker ps | grep -E "vision-sync-server|vision-sync-client"

echo ""
echo "=== Done ==="
