#!/bin/bash
set -e

# ECR Configuration
AWS_REGION="ap-southeast-1"
AWS_ACCOUNT_ID="366451245016"
ECR_REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

# Repository names
SERVER_REPO="${ECR_REGISTRY}/vision-sync-server-dev"
CLIENT_REPO="${ECR_REGISTRY}/vision-sync-client-dev"
PROCESSOR_REPO="${ECR_REGISTRY}/vision-sync-video-processor-dev"

echo "=== Logging in to ECR ==="
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${ECR_REGISTRY}

echo "=== Building Server Image ==="
cd ~/build/server
docker build -t vision-sync-server:latest .
docker tag vision-sync-server:latest ${SERVER_REPO}:latest
echo "=== Pushing Server Image ==="
docker push ${SERVER_REPO}:latest

echo "=== Building Client Image ==="
cd ~/build/client
docker build -t vision-sync-client:latest .
docker tag vision-sync-client:latest ${CLIENT_REPO}:latest
echo "=== Pushing Client Image ==="
docker push ${CLIENT_REPO}:latest

echo "=== Building Video Processor Image ==="
cd ~/build/container
docker build -t vision-sync-processor:latest .
docker tag vision-sync-processor:latest ${PROCESSOR_REPO}:latest
echo "=== Pushing Video Processor Image ==="
docker push ${PROCESSOR_REPO}:latest

echo "=== ✅ All images built and pushed successfully! ==="
