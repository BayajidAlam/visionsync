#!/bin/bash
set -e

BACKEND_IP="10.0.42.158"
ECR_REPO="366451245016.dkr.ecr.ap-southeast-1.amazonaws.com/vision-sync-server-dev"
REGION="ap-southeast-1"

echo "🚀 Deploying backend to $BACKEND_IP..."

# Install Docker on backend
echo "📦 Installing Docker on backend..."
ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$BACKEND_IP 'sudo apt update && sudo apt install -y docker.io && sudo systemctl start docker && sudo usermod -aG docker ubuntu'

# Install AWS CLI on backend if not present
echo "📦 Installing AWS CLI on backend..."
ssh -i ~/.ssh/vision-sync-backend ubuntu@$BACKEND_IP 'which aws || sudo apt install -y awscli'

# Pull image from ECR
echo "⬇️  Pulling image from ECR..."
ssh -i ~/.ssh/vision-sync-backend ubuntu@$BACKEND_IP "aws ecr get-login-password --region $REGION | sudo docker login --username AWS --password-stdin 366451245016.dkr.ecr.ap-southeast-1.amazonaws.com && sudo docker pull $ECR_REPO:latest"

# Stop existing container
echo "🛑 Stopping existing container..."
ssh -i ~/.ssh/vision-sync-backend ubuntu@$BACKEND_IP 'sudo docker stop vision-sync-server 2>/dev/null || true && sudo docker rm vision-sync-server 2>/dev/null || true'

# Start new container
echo "▶️  Starting new container..."
ssh -i ~/.ssh/vision-sync-backend ubuntu@$BACKEND_IP "sudo docker run -d --name vision-sync-server --restart unless-stopped -p 5000:5000 \
  -e PORT=5000 \
  -e NODE_ENV=production \
  -e AWS_REGION=ap-southeast-1 \
  -e S3_BUCKET_RAW=vision-sync-raw-videos-dev \
  -e S3_BUCKET_PROCESSED=vision-sync-processed-videos-dev \
  -e SQS_QUEUE_URL='https://sqs.ap-southeast-1.amazonaws.com/366451245016/vision-sync-video-processing-dev' \
  -e MONGODB_URI='mongodb://10.0.1.15:27017,10.0.174.69:27017,10.0.22.130:27017/vision-sync?replicaSet=rs0' \
  -e REDIS_URL='redis://10.0.35.200:6379' \
  -e CLOUDFRONT_DOMAIN='d11zonfo5y8dyu.cloudfront.net' \
  -e FRONTEND_URL='http://localhost:3000' \
  $ECR_REPO:latest"

echo "✅ Backend deployed successfully!"
echo "🔍 Checking container status..."
ssh -i ~/.ssh/vision-sync-backend ubuntu@$BACKEND_IP 'sudo docker ps | grep vision-sync-server'
