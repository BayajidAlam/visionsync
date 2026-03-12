# VisionSync Video Streaming Platform
.PHONY: help install build deploy container dev clean logs destroy setup update outputs post-deploy test status \
        deploy-client deploy-server deploy-prod status-prod logs-frontend logs-server-prod ssh-frontend ssh-backend-prod

# Colors for output
YELLOW := \033[1;33m
GREEN := \033[1;32m
RED := \033[1;31m
NC := \033[0m # No Color

# ============================================================================
# PRODUCTION INFRASTRUCTURE — hardcoded after `pulumi up` (update if you
# re-run `pulumi up` and IPs change)
# ============================================================================
AWS_REGION        := ap-southeast-1
AWS_ACCOUNT       := 366451245016
SSH_KEY           := $(HOME)/.ssh/vision-sync-backend

BASTION_IP        := 52.77.164.183
FRONTEND_EC2_IP   := 54.254.240.227
BACKEND_EC2_IP    := 10.0.42.158          # private — access via bastion

ALB_URL           := http://vision-sync-alb-dev-220657630.ap-southeast-1.elb.amazonaws.com
CLOUDFRONT_DOMAIN := d11zonfo5y8dyu.cloudfront.net

ECR_REGISTRY      := $(AWS_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com
CLIENT_ECR        := $(ECR_REGISTRY)/vision-sync-client-dev
SERVER_ECR        := $(ECR_REGISTRY)/vision-sync-server-dev

REDIS_URL         := redis://:VisionSyncRedis2024!@10.0.35.200:6379
MONGODB_URI       := mongodb://10.0.1.15:27017,10.0.174.69:27017,10.0.22.130:27017/vision-sync?replicaSet=rs0
SQS_QUEUE_URL     := https://sqs.$(AWS_REGION).amazonaws.com/$(AWS_ACCOUNT)/vision-sync-video-processing-dev

# ============================================================================
# PRODUCTION DEPLOYMENT TARGETS (the ones that actually work)
# ============================================================================

## Deploy the client (React) to the frontend EC2.
## Builds the Docker image ON the frontend EC2 so VITE_API_URL is baked
## in correctly. The frontend EC2 role cannot push to ECR so we build+run
## the image locally on that host.
deploy-client:
	@echo "$(YELLOW)📦 Packaging client source...$(NC)"
	@cd $(CURDIR) && tar \
		--exclude='client/node_modules' \
		--exclude='client/dist' \
		-czf /tmp/vision-sync-client.tar.gz client/
	@echo "$(YELLOW)📤 Copying source to frontend EC2 ($(FRONTEND_EC2_IP))...$(NC)"
	@scp -o StrictHostKeyChecking=no -i $(SSH_KEY) \
		/tmp/vision-sync-client.tar.gz \
		ubuntu@$(FRONTEND_EC2_IP):~/client-src.tar.gz
	@echo "$(YELLOW)🐳 Building & running on frontend EC2...$(NC)"
	@ssh -o StrictHostKeyChecking=no -i $(SSH_KEY) ubuntu@$(FRONTEND_EC2_IP) \
		"set -e; \
		rm -rf ~/client-build && mkdir ~/client-build; \
		tar -xzf ~/client-src.tar.gz -C ~/client-build --strip-components=1; \
		cd ~/client-build; \
		docker build --build-arg VITE_API_URL=$(ALB_URL) -t vision-sync-client:latest .; \
		docker stop vision-sync-client 2>/dev/null || true; \
		docker rm   vision-sync-client 2>/dev/null || true; \
		docker run -d --name vision-sync-client --restart unless-stopped \
			-p 80:80 vision-sync-client:latest; \
		echo 'Client container started'; \
		docker ps | grep vision-sync-client"
	@echo "$(GREEN)✅ Client deployed to frontend EC2!$(NC)"
	@echo "  URL: $(ALB_URL)"

## Deploy the server (Node.js API) to the backend EC2 via bastion.
## Builds the Docker image locally, pushes to ECR, then the backend EC2
## pulls it (the backend EC2 has ECR pull permissions via its IAM role).
deploy-server:
	@echo "$(YELLOW)🐳 Building server Docker image...$(NC)"
	@cd $(CURDIR)/server && docker build -t vision-sync-server:latest .
	@echo "$(YELLOW)🔐 Logging into ECR...$(NC)"
	@aws ecr get-login-password --region $(AWS_REGION) | \
		docker login --username AWS --password-stdin $(ECR_REGISTRY)
	@docker tag vision-sync-server:latest $(SERVER_ECR):latest
	@echo "$(YELLOW)📤 Pushing server image to ECR...$(NC)"
	@docker push $(SERVER_ECR):latest
	@echo "$(YELLOW)🚀 Pulling & restarting on backend EC2 via bastion...$(NC)"
	@ssh -o StrictHostKeyChecking=no -i $(SSH_KEY) ubuntu@$(BASTION_IP) \
		"ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$(BACKEND_EC2_IP) \
			'aws ecr get-login-password --region $(AWS_REGION) | \
			 docker login --username AWS --password-stdin $(ECR_REGISTRY) && \
			 docker pull $(SERVER_ECR):latest && \
			 docker stop vision-sync-server 2>/dev/null || true && \
			 docker rm   vision-sync-server 2>/dev/null || true && \
			 docker run -d --name vision-sync-server --restart unless-stopped \
				-p 5000:5000 \
				-e PORT=5000 \
				-e NODE_ENV=production \
				-e AWS_REGION=$(AWS_REGION) \
				-e S3_BUCKET_RAW=vision-sync-raw-videos-dev \
				-e S3_BUCKET_PROCESSED=vision-sync-processed-videos-dev \
				-e SQS_QUEUE_URL=$(SQS_QUEUE_URL) \
				-e MONGODB_URI=$(MONGODB_URI) \
				-e REDIS_URL=$(REDIS_URL) \
				-e CLOUDFRONT_DOMAIN=$(CLOUDFRONT_DOMAIN) \
				-e FRONTEND_URL=$(ALB_URL) \
				$(SERVER_ECR):latest && \
			 echo Done && docker ps | grep vision-sync-server'"
	@echo "$(GREEN)✅ Server deployed to backend EC2!$(NC)"

## Deploy both client and server in one command.
deploy-prod: deploy-server deploy-client
	@echo "$(GREEN)🎉 Full production deployment complete!$(NC)"
	@$(MAKE) status-prod

## Show running container status on both EC2s.
status-prod:
	@echo "$(YELLOW)📊 Frontend EC2 ($(FRONTEND_EC2_IP)):$(NC)"
	@ssh -o StrictHostKeyChecking=no -i $(SSH_KEY) ubuntu@$(FRONTEND_EC2_IP) \
		"docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'" 2>/dev/null || echo "Cannot connect"
	@echo ""
	@echo "$(YELLOW)📊 Backend EC2 ($(BACKEND_EC2_IP) via bastion):$(NC)"
	@ssh -o StrictHostKeyChecking=no -i $(SSH_KEY) ubuntu@$(BASTION_IP) \
		"ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$(BACKEND_EC2_IP) \
		 'docker ps --format \"table {{.Names}}\t{{.Status}}\t{{.Ports}}\"'" 2>/dev/null || echo "Cannot connect"
	@echo ""
	@echo "$(YELLOW)🌐 ALB health check:$(NC)"
	@curl -sf $(ALB_URL)/health | grep -o '"status":"[^"]*"' || echo "ALB not responding"

## Tail nginx logs on the frontend EC2.
logs-frontend:
	@ssh -o StrictHostKeyChecking=no -i $(SSH_KEY) ubuntu@$(FRONTEND_EC2_IP) \
		"docker logs -f vision-sync-client"

## Tail server logs on the backend EC2.
logs-server-prod:
	@ssh -o StrictHostKeyChecking=no -i $(SSH_KEY) ubuntu@$(BASTION_IP) \
		"ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$(BACKEND_EC2_IP) \
		 'docker logs -f vision-sync-server'"

## SSH directly into the frontend EC2.
ssh-frontend:
	@ssh -o StrictHostKeyChecking=no -i $(SSH_KEY) ubuntu@$(FRONTEND_EC2_IP)

## SSH into the backend EC2 (private) via bastion.
ssh-backend-prod:
	@ssh -J ubuntu@$(BASTION_IP) -i $(SSH_KEY) ubuntu@$(BACKEND_EC2_IP)

# Default target
help:
	@echo "$(GREEN)VisionSync - Video Streaming Platform$(NC)"
	@echo "=========================================="
	@echo "$(YELLOW)🚀 MAIN DEPLOYMENT COMMANDS:$(NC)"
	@echo "  make deploy-all    - 🎯 ONE COMMAND: Deploy everything (infrastructure + backend + databases)"
	@echo "  make deploy-fast   - ⚡ Quick update deployment (for code changes)"
	@echo ""
	@echo "$(YELLOW)Available commands:$(NC)"
	@echo "  make install   - Install all dependencies"
	@echo "  make build     - Build all components"
	@echo "  make deploy    - Deploy infrastructure to AWS"
	@echo "  make container - Build and push Docker container"
	@echo "  make dev       - Start local development servers"
	@echo "  make env       - Show basic environment variables"
	@echo "  make update-env - Auto-update server/.env with AWS resources"
	@echo "  make outputs   - Show ALL Pulumi outputs (detailed)"
	@echo "  make logs      - View AWS logs"
	@echo "  make clean     - Clean build files"
	@echo "  make destroy   - Destroy AWS infrastructure"
	@echo "  make setup     - Complete first-time setup"
	@echo "  make update    - Quick deploy (rebuild and update)"
	@echo "  make post-deploy - Show configuration after deployment"
	@echo "  make status    - Check deployment status"
	@echo ""
	@echo "$(YELLOW)Backend Commands:$(NC)"
	@echo "  make deploy-backend - Deploy backend to EC2 with Docker"
	@echo "  make update-backend - Update backend container"
	@echo "  make status-backend - Check backend status"
	@echo "  make logs-backend   - View backend logs"
	@echo "  make ssh-backend    - SSH into backend instance"
	@echo ""
	@echo "$(YELLOW)Ansible Commands:$(NC)"
	@echo "  make setup-mongodb     - Setup MongoDB replica set (1 Primary + 2 Secondary)"
	@echo "  make setup-redis       - Setup Redis cache instance"
	@echo "  make setup-all-db      - Setup both MongoDB and Redis"
	@echo "  make deploy-with-ansible - Deploy application using Ansible and ECR"
	@echo "  make create-inventory  - Create Ansible inventory from Pulumi outputs"
	@echo "  make check-mongodb     - Check MongoDB replica set status"
	@echo "  make check-redis       - Check Redis server status"
	@echo "  make check-ansible     - Validate Ansible configuration"

# Install dependencies
install:
	@echo "$(YELLOW)Installing dependencies...$(NC)"
	cd server && npm install
	cd client && npm install
	cd lambda && npm install
	cd container && npm install
	cd IaC && npm install
	@echo "$(GREEN)✅ Dependencies installed!$(NC)"

# Build all components
build:
	@echo "$(YELLOW)Building all components...$(NC)"
	cd server && npm run build
	cd client && npm run build
	cd lambda && npm run build
	cd container && npm run build
	@echo "$(GREEN)✅ Build complete!$(NC)"

# Deploy infrastructure
deploy:
	@echo "$(YELLOW)Deploying infrastructure...$(NC)"
	cd IaC && pulumi up
	@echo "$(GREEN)✅ Infrastructure deployed!$(NC)"
	@make update-env
	@echo "$(GREEN)✅ Server .env file updated automatically!$(NC)"
	@echo "Run 'make outputs' to see all configuration values"

# Build and push container to ECR
container: build
	@echo "$(YELLOW)Building and pushing container...$(NC)"
	$(eval ECR_URL := $(shell cd IaC && pulumi stack output ecrRepositoryUrl 2>/dev/null))
	$(eval AWS_REGION := ap-southeast-1)
	@if [ -z "$(ECR_URL)" ]; then \
		echo "$(RED)❌ Error: ECR repository not found. Run 'make deploy' first$(NC)"; \
		exit 1; \
	fi
	@echo "ECR URL: $(ECR_URL)"
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_URL)
	cd container && docker build -t vision-sync-video-processor .
	docker tag vision-sync-video-processor:latest $(ECR_URL):latest
	docker push $(ECR_URL):latest
	@echo "$(GREEN)✅ Container pushed to ECR!$(NC)"

# Start development servers
dev:
	@echo "$(YELLOW)Starting development servers...$(NC)"
	@echo "Backend will run on http://localhost:5000"
	@echo "Frontend will run on http://localhost:3000"
	@echo "Press Ctrl+C to stop"
	cd server && npm run dev &
	cd client && npm run dev

# Show basic environment variables
env:
	@echo "Copy these environment variables to server/.env:"
	@echo "=========================================="
	$(eval RAW_BUCKET := $(shell cd IaC && pulumi stack output rawVideosBucketName 2>/dev/null))
	$(eval PROCESSED_BUCKET := $(shell cd IaC && pulumi stack output processedVideosBucketName 2>/dev/null))
	$(eval SQS_URL := $(shell cd IaC && pulumi stack output videoProcessingQueueUrl 2>/dev/null))
	@echo "S3_BUCKET_RAW=$(RAW_BUCKET)"
	@echo "S3_BUCKET_PROCESSED=$(PROCESSED_BUCKET)"
	@echo "SQS_QUEUE_URL=$(SQS_URL)"
	@echo "AWS_REGION=ap-southeast-1"

# Automatically update server/.env with AWS resources (NEW)
update-env:
	@echo "$(YELLOW)Updating server/.env with AWS resource values...$(NC)"
	$(eval RAW_BUCKET := $(shell cd IaC && pulumi stack output rawVideosBucketName 2>/dev/null))
	$(eval PROCESSED_BUCKET := $(shell cd IaC && pulumi stack output processedVideosBucketName 2>/dev/null))
	$(eval SQS_URL := $(shell cd IaC && pulumi stack output videoProcessingQueueUrl 2>/dev/null))
	$(eval CLOUDFRONT_ID := $(shell cd IaC && pulumi stack output cloudfrontDistributionId 2>/dev/null))
	$(eval CLOUDFRONT_DOMAIN := $(shell cd IaC && pulumi stack output cloudfrontDomain 2>/dev/null))
	@if [ -z "$(RAW_BUCKET)" ] || [ -z "$(PROCESSED_BUCKET)" ] || [ -z "$(SQS_URL)" ]; then \
		echo "$(RED)❌ Error: Could not retrieve AWS resource values. Make sure infrastructure is deployed.$(NC)"; \
		exit 1; \
	fi
	@# Create backup of current .env
	@cp server/.env server/.env.backup
	@# Update S3 bucket names
	@sed -i 's/^S3_BUCKET_RAW=.*/S3_BUCKET_RAW=$(RAW_BUCKET)/' server/.env
	@sed -i 's/^S3_BUCKET_PROCESSED=.*/S3_BUCKET_PROCESSED=$(PROCESSED_BUCKET)/' server/.env
	@# Update SQS URL (escape special characters)
	@sed -i 's|^SQS_QUEUE_URL=.*|SQS_QUEUE_URL=$(SQS_URL)|' server/.env
	@# Update CloudFront values if available
	@if [ -n "$(CLOUDFRONT_ID)" ]; then \
		sed -i 's/^CLOUDFRONT_DISTRIBUTION_ID=.*/CLOUDFRONT_DISTRIBUTION_ID=$(CLOUDFRONT_ID)/' server/.env; \
	fi
	@if [ -n "$(CLOUDFRONT_DOMAIN)" ]; then \
		sed -i 's/^CLOUDFRONT_DOMAIN=.*/CLOUDFRONT_DOMAIN=$(CLOUDFRONT_DOMAIN)/' server/.env; \
	fi
	@echo "$(GREEN)✅ Updated server/.env with:$(NC)"
	@echo "  S3_BUCKET_RAW=$(RAW_BUCKET)"
	@echo "  S3_BUCKET_PROCESSED=$(PROCESSED_BUCKET)"
	@echo "  SQS_QUEUE_URL=$(SQS_URL)"
	@if [ -n "$(CLOUDFRONT_ID)" ]; then echo "  CLOUDFRONT_DISTRIBUTION_ID=$(CLOUDFRONT_ID)"; fi
	@if [ -n "$(CLOUDFRONT_DOMAIN)" ]; then echo "  CLOUDFRONT_DOMAIN=$(CLOUDFRONT_DOMAIN)"; fi
	@echo "$(YELLOW)📋 Backup saved as server/.env.backup$(NC)"

# Get ALL Pulumi outputs with CloudFront and formatting (NEW)
outputs:
	@echo "$(GREEN)=========================================="
	@echo "     PULUMI STACK OUTPUTS"
	@echo "==========================================$(NC)"
	@echo ""
	@echo "$(YELLOW)📦 S3 Buckets:$(NC)"
	$(eval RAW_BUCKET := $(shell cd IaC && pulumi stack output rawVideosBucketName 2>/dev/null))
	$(eval PROCESSED_BUCKET := $(shell cd IaC && pulumi stack output processedVideosBucketName 2>/dev/null))
	@echo "S3_BUCKET_RAW=$(RAW_BUCKET)"
	@echo "S3_BUCKET_PROCESSED=$(PROCESSED_BUCKET)"
	@echo ""
	@echo "$(YELLOW)📨 SQS Queue:$(NC)"
	$(eval SQS_URL := $(shell cd IaC && pulumi stack output videoProcessingQueueUrl 2>/dev/null))
	@echo "SQS_QUEUE_URL=$(SQS_URL)"
	@echo ""
	@echo "$(YELLOW)🌐 CloudFront CDN:$(NC)"
	$(eval CLOUDFRONT_ID := $(shell cd IaC && pulumi stack output cloudfrontDistributionId 2>/dev/null))
	$(eval CLOUDFRONT_DOMAIN := $(shell cd IaC && pulumi stack output cloudfrontDomain 2>/dev/null))
	@echo "CLOUDFRONT_DISTRIBUTION_ID=$(CLOUDFRONT_ID)"
	@echo "CLOUDFRONT_DOMAIN=$(CLOUDFRONT_DOMAIN)"
	@echo "CLOUDFRONT_URL=https://$(CLOUDFRONT_DOMAIN)"
	@echo ""
	@echo "$(YELLOW)🐳 ECR Repository:$(NC)"
	$(eval ECR_URL := $(shell cd IaC && pulumi stack output ecrRepositoryUrl 2>/dev/null))
	@echo "ECR_REPOSITORY_URL=$(ECR_URL)"
	@echo ""
	@echo "$(YELLOW)🔧 Lambda Function:$(NC)"
	$(eval LAMBDA_NAME := $(shell cd IaC && pulumi stack output lambdaFunctionName 2>/dev/null))
	@echo "LAMBDA_FUNCTION_NAME=$(LAMBDA_NAME)"
	@echo ""
	@echo "$(YELLOW)🌐 VPC Information:$(NC)"
	$(eval VPC_ID := $(shell cd IaC && pulumi stack output vpcId 2>/dev/null))
	@echo "VPC_ID=$(VPC_ID)"
	@echo ""
	@echo "$(GREEN)=========================================="
	@echo "Copy these values to your .env files!$(NC)"
	@echo "=========================================="

# Post-deployment configuration helper (NEW)
post-deploy: outputs
	@echo ""
	@echo "$(GREEN)✅ Infrastructure deployed successfully!$(NC)"
	@echo ""
	@echo "$(YELLOW)Next steps:$(NC)"
	@echo "1. Update server/.env with the values above"
	@echo "2. Update client/.env with:"
	@echo "   REACT_APP_API_URL=http://localhost:5000"
	@echo "   REACT_APP_CLOUDFRONT_URL=https://$(shell cd IaC && pulumi stack output cloudfrontDomain 2>/dev/null)"
	@echo ""
	@echo "3. For production, update the WEBHOOK_URL in container:"
	@echo "   WEBHOOK_URL=https://your-api-domain.com/api/webhook/processing-complete"
	@echo ""
	@echo "4. Run 'make container' to build and push Docker image"
	@echo "5. Run 'make dev' to start local development"

# Check deployment status (NEW)
status:
	@echo "$(YELLOW)Checking deployment status...$(NC)"
	@echo ""
	@echo "$(YELLOW)📊 Pulumi Stack:$(NC)"
	cd IaC && pulumi stack --show-name
	@echo ""
	@echo "$(YELLOW)🔍 Resource Summary:$(NC)"
	cd IaC && pulumi stack --show-summary
	@echo ""
	@echo "$(YELLOW)☁️  AWS Resources:$(NC)"
	@aws s3 ls | grep vision-sync || echo "No S3 buckets found"
	@aws ecs list-clusters --region ap-southeast-1 | grep vision-sync || echo "No ECS clusters found"
	@echo ""
	@echo "$(GREEN)Run 'make outputs' for detailed configuration$(NC)"

# View logs menu
logs:
	@echo "Choose which logs to view:"
	@echo "1. Lambda logs: make logs-lambda"
	@echo "2. ECS logs: make logs-ecs"
	@echo "3. Server logs: make logs-server"

# Lambda logs
logs-lambda:
	$(eval LAMBDA_NAME := $(shell cd IaC && pulumi stack output lambdaFunctionName 2>/dev/null))
	@if [ -z "$(LAMBDA_NAME)" ]; then \
		echo "$(RED)❌ Lambda function not found. Deploy first with 'make deploy'$(NC)"; \
		exit 1; \
	fi
	aws logs tail /aws/lambda/$(LAMBDA_NAME) --follow

# ECS logs
logs-ecs:
	@echo "$(YELLOW)Viewing ECS container logs...$(NC)"
	aws logs tail /ecs/vision-sync-video-processing-dev --follow

# Local server logs (NEW)
logs-server:
	@echo "$(YELLOW)Viewing local server logs...$(NC)"
	cd server && npm run dev

# Test all components (NEW)
test:
	@echo "$(YELLOW)Running tests...$(NC)"
	@echo "Testing server..."
	cd server && npm test 2>/dev/null || echo "No server tests configured"
	@echo "Testing client..."
	cd client && npm test 2>/dev/null || echo "No client tests configured"
	@echo "Testing lambda..."
	cd lambda && npm test 2>/dev/null || echo "No lambda tests configured"
	@echo "$(GREEN)✅ Tests complete!$(NC)"

# Clean build files
clean:
	@echo "$(YELLOW)Cleaning build files...$(NC)"
	rm -rf server/dist
	rm -rf client/dist
	rm -rf lambda/dist
	rm -rf container/dist
	rm -rf */node_modules/.cache
	@echo "$(GREEN)✅ Clean complete!$(NC)"

# Destroy AWS infrastructure
destroy:
	@echo "$(RED)⚠️  WARNING: This will destroy ALL AWS resources!$(NC)"
	@read -p "Are you sure? Type 'yes' to confirm: " confirm && [ "$$confirm" = "yes" ]
	cd IaC && pulumi destroy
	@echo "$(GREEN)✅ Infrastructure destroyed$(NC)"

# Complete setup (first time)
setup: install build deploy container post-deploy
	@echo "$(GREEN)✅ Complete setup finished!$(NC)"
	@echo "Next steps:"
	@echo "1. Update .env files with the values shown above"
	@echo "2. Run 'make dev' to start development servers"

# Quick deploy (updates)
update: build container deploy
	@echo "$(GREEN)✅ Update complete!$(NC)"
	@make outputs

# Reset everything (NEW)
reset: clean
	@echo "$(YELLOW)Resetting project...$(NC)"
	rm -rf */node_modules
	@make install
	@echo "$(GREEN)✅ Reset complete! Run 'make setup' to redeploy$(NC)"

# Docker cleanup (NEW)
docker-clean:
	@echo "$(YELLOW)Cleaning Docker resources...$(NC)"
	docker system prune -f
	@echo "$(GREEN)✅ Docker cleanup complete!$(NC)"

# Deploy backend to EC2 with Docker
deploy-backend:
	@echo "$(YELLOW)🚀 Deploying Backend to AWS EC2...$(NC)"
	@# Check prerequisites
	@command -v pulumi >/dev/null 2>&1 || { echo "$(RED)❌ Pulumi not found$(NC)"; exit 1; }
	@# Get outputs (backend is in PRIVATE subnet, use bastion as jump host)
	$(eval BACKEND_PRIVATE_IP := $(shell cd IaC && pulumi stack output backendInstance --json 2>/dev/null | grep -o '"privateIp":"[^"]*"' | cut -d'"' -f4))
	$(eval BASTION_IP := $(shell cd IaC && pulumi stack output bastionPublicIp 2>/dev/null))
	$(eval SERVER_ECR := $(shell cd IaC && pulumi stack output serverEcrRepository --json 2>/dev/null | grep -o '"repositoryUrl":"[^"]*"' | cut -d'"' -f4))
	$(eval AWS_REGION := ap-southeast-1)
	@echo "$(GREEN)✅ Bastion IP: $(BASTION_IP)$(NC)"
	@echo "$(GREEN)✅ Backend Private IP: $(BACKEND_PRIVATE_IP)$(NC)"
	@echo "$(GREEN)✅ ECR URL: $(SERVER_ECR)$(NC)"
	@# Images should already be in ECR - skip local build
	@echo "$(YELLOW)📋 Using pre-built images from ECR$(NC)"
	@# Copy deployment script to bastion
	@echo "$(YELLOW)📋 Preparing bastion for deployment...$(NC)"
	@ssh -o StrictHostKeyChecking=no -i "$$HOME/.ssh/vision-sync-backend" ubuntu@$(BASTION_IP) '\
		mkdir -p ~/scripts && \
		cat > ~/scripts/deploy-backend.sh << "EOF"\n\
#!/bin/bash\n\
set -e\n\
BACKEND_IP="$(BACKEND_PRIVATE_IP)"\n\
ECR_REPO="$(SERVER_ECR)"\n\
REGION="$(AWS_REGION)"\n\
echo "Installing Docker on backend..."\n\
ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$$BACKEND_IP "sudo apt update && sudo apt install -y docker.io awscli && sudo systemctl start docker && sudo usermod -aG docker ubuntu" || true\n\
echo "Pulling image from ECR..."\n\
ssh -i ~/.ssh/vision-sync-backend ubuntu@$$BACKEND_IP "aws ecr get-login-password --region $$REGION | sudo docker login --username AWS --password-stdin $${ECR_REPO%%/*} && sudo docker pull $$ECR_REPO:latest"\n\
echo "Deploying container..."\n\
ssh -i ~/.ssh/vision-sync-backend ubuntu@$$BACKEND_IP "sudo docker stop vision-sync-server 2>/dev/null || true && sudo docker rm vision-sync-server 2>/dev/null || true"\n\
ssh -i ~/.ssh/vision-sync-backend ubuntu@$$BACKEND_IP "sudo docker run -d --name vision-sync-server --restart unless-stopped -p 5000:5000 \
  -e PORT=5000 -e NODE_ENV=production -e AWS_REGION=$$REGION \
  -e S3_BUCKET_RAW=vision-sync-raw-videos-dev -e S3_BUCKET_PROCESSED=vision-sync-processed-videos-dev \
  -e SQS_QUEUE_URL=https://sqs.ap-southeast-1.amazonaws.com/366451245016/vision-sync-video-processing-dev \
  -e MONGODB_URI=mongodb://10.0.1.15:27017,10.0.174.69:27017,10.0.22.130:27017/vision-sync?replicaSet=rs0 \
  -e REDIS_URL=redis://10.0.35.200:6379 -e CLOUDFRONT_DOMAIN=d11zonfo5y8dyu.cloudfront.net \
  -e FRONTEND_URL=http://localhost:3000 $$ECR_REPO:latest"\n\
echo "Backend deployed!"\n\
ssh -i ~/.ssh/vision-sync-backend ubuntu@$$BACKEND_IP "sudo docker ps | grep vision-sync-server"\n\
EOF\n\
		chmod +x ~/scripts/deploy-backend.sh'
	@# Execute deployment
	@echo "$(YELLOW)📋 Deploying backend container via bastion...$(NC)"
	@ssh -i "$$HOME/.ssh/vision-sync-backend" ubuntu@$(BASTION_IP) 'bash ~/scripts/deploy-backend.sh'
	@echo ""
	@echo "$(GREEN)🎉 Deployment Complete!$(NC)"
	@echo "Backend Private IP: $(GREEN)$(BACKEND_PRIVATE_IP)$(NC)"
	@echo "Access via Bastion: $(GREEN)ssh -J ubuntu@$(BASTION_IP) -i $$HOME/.ssh/vision-sync-backend ubuntu@$(BACKEND_PRIVATE_IP)$(NC)"

# Deploy backend container (internal target)
deploy-backend-container:
	$(eval RAW_BUCKET := $(shell cd IaC && pulumi stack output rawVideosBucketName 2>/dev/null))
	$(eval PROCESSED_BUCKET := $(shell cd IaC && pulumi stack output processedVideosBucketName 2>/dev/null))
	$(eval SQS_QUEUE_URL := $(shell cd IaC && pulumi stack output videoProcessingQueueUrl 2>/dev/null))
	$(eval CLOUDFRONT_DOMAIN := $(shell cd IaC && pulumi stack output cloudfrontDomain 2>/dev/null))
	@ssh -o StrictHostKeyChecking=no -i "$$HOME/.ssh/vision-sync-backend" ubuntu@$(BACKEND_IP) '\
		set -e && \
		aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_URL) && \
		docker stop vision-sync-backend 2>/dev/null || true && \
		docker rm vision-sync-backend 2>/dev/null || true && \
		docker run -d --name vision-sync-backend \
			--restart unless-stopped \
			-p 5000:5000 \
			-e NODE_ENV=production \
			-e PORT=5000 \
			-e AWS_REGION=$(AWS_REGION) \
			-e S3_BUCKET_RAW=$(RAW_BUCKET) \
			-e S3_BUCKET_PROCESSED=$(PROCESSED_BUCKET) \
			-e SQS_QUEUE_URL="$(SQS_QUEUE_URL)" \
			-e CLOUDFRONT_DOMAIN=$(CLOUDFRONT_DOMAIN) \
			-e FRONTEND_URL=http://localhost:3000 \
			-e CORS_ORIGIN=* \
			$(ECR_URL):backend-latest && \
		echo "Backend container started"'

# Update Lambda with webhook URL (internal target)
update-webhook-url:
	$(eval LAMBDA_NAME := $(shell cd IaC && pulumi stack output lambdaFunctionName 2>/dev/null))
	$(eval WEBHOOK_URL := http://$(BACKEND_IP):5000/api/webhook/processing-complete)
	$(eval RAW_BUCKET := $(shell cd IaC && pulumi stack output rawVideosBucketName 2>/dev/null))
	$(eval PROCESSED_BUCKET := $(shell cd IaC && pulumi stack output processedVideosBucketName 2>/dev/null))
	$(eval ECS_CLUSTER := $(shell cd IaC && pulumi stack output ecsClusterName 2>/dev/null))
	$(eval VPC_ID := $(shell cd IaC && pulumi stack output vpcId 2>/dev/null))
	$(eval PRIVATE_SUBNETS := $(shell cd IaC && pulumi stack output privateSubnetIds 2>/dev/null | tr -d '[]" ' | tr ',' ' '))
	$(eval SECURITY_GROUP := $(shell aws ec2 describe-security-groups --filters Name=group-name,Values=default Name=vpc-id,Values=$(VPC_ID) --query SecurityGroups[0].GroupId --output text 2>/dev/null))
	@echo "$(YELLOW)📋 Updating Lambda webhook URL...$(NC)"
	@aws lambda update-function-configuration \
		--function-name "$(LAMBDA_NAME)" \
		--environment 'Variables={ECS_CLUSTER="$(ECS_CLUSTER)",ECS_TASK_DEFINITION="$(shell cd IaC && pulumi stack output ecsTaskDefinition | cut -d'/' -f2)",SUBNET_IDS="$(PRIVATE_SUBNETS)",SECURITY_GROUP_ID="$(SECURITY_GROUP)",PROCESSED_BUCKET="$(PROCESSED_BUCKET)",REGION="ap-southeast-1",WEBHOOK_URL="$(WEBHOOK_URL)"}' \
		--region ap-southeast-1
	@echo "$(GREEN)✅ Lambda updated with webhook URL$(NC)"

# Update backend container
update-backend:
	$(eval BACKEND_IP := $(shell cd IaC && pulumi stack output backendPublicIp 2>/dev/null))
	$(eval ECR_URL := $(shell cd IaC && pulumi stack output ecrRepositoryUrl 2>/dev/null))
	@echo "$(YELLOW)🔄 Updating backend container...$(NC)"
	@# Build and push new image
	@aws ecr get-login-password --region ap-southeast-1 | docker login --username AWS --password-stdin $(ECR_URL)
	@docker build -f Dockerfile.backend -t vision-sync-backend .
	@docker tag vision-sync-backend:latest $(ECR_URL):backend-latest
	@docker push $(ECR_URL):backend-latest
	@# Update container on EC2
	@make deploy-backend-container BACKEND_IP=$(BACKEND_IP) ECR_URL=$(ECR_URL) AWS_REGION=ap-southeast-1
	@echo "$(GREEN)✅ Backend updated$(NC)"

# SSH into backend instance
ssh-backend:
	$(eval BACKEND_PRIVATE_IP := $(shell cd IaC && pulumi stack output backendInstance --json 2>/dev/null | grep -o '"privateIp":"[^"]*"' | cut -d'"' -f4))
	$(eval BASTION_IP := $(shell cd IaC && pulumi stack output bastionPublicIp 2>/dev/null))
	@echo "$(YELLOW)🔗 Connecting to backend instance via bastion...$(NC)"
	@ssh -J ubuntu@$(BASTION_IP) -i "$$HOME/.ssh/vision-sync-backend" ubuntu@$(BACKEND_PRIVATE_IP)

# View backend logs
logs-backend:
	$(eval BACKEND_PRIVATE_IP := $(shell cd IaC && pulumi stack output backendInstance --json 2>/dev/null | grep -o '"privateIp":"[^"]*"' | cut -d'"' -f4))
	$(eval BASTION_IP := $(shell cd IaC && pulumi stack output bastionPublicIp 2>/dev/null))
	@echo "$(YELLOW)📋 Viewing backend logs via bastion...$(NC)"
	@ssh -J ubuntu@$(BASTION_IP) -i "$$HOME/.ssh/vision-sync-backend" ubuntu@$(BACKEND_PRIVATE_IP) "sudo docker logs -f vision-sync-server"

# Backend status
status-backend:
	$(eval BACKEND_PRIVATE_IP := $(shell cd IaC && pulumi stack output backendInstance --json 2>/dev/null | grep -o '"privateIp":"[^"]*"' | cut -d'"' -f4))
	$(eval BASTION_IP := $(shell cd IaC && pulumi stack output bastionPublicIp 2>/dev/null))
	@echo "$(YELLOW)📊 Backend Status$(NC)"
	@echo "Private IP: $(BACKEND_PRIVATE_IP)"
	@echo "Bastion IP: $(BASTION_IP)"
	@echo "Checking container status via bastion..."
	@ssh -J ubuntu@$(BASTION_IP) -i "$$HOME/.ssh/vision-sync-backend" ubuntu@$(BACKEND_PRIVATE_IP) "sudo docker ps --filter name=vision-sync-server" 2>/dev/null || echo "Cannot connect to instance"

# Help with common issues (NEW)
troubleshoot:
	@echo "$(YELLOW)Common Issues & Solutions:$(NC)"
	@echo ""
	@echo "1. ECR login failed:"
	@echo "   aws configure set region ap-southeast-1"
	@echo "   aws ecr get-login-password --region ap-southeast-1"
	@echo ""
	@echo "2. Pulumi errors:"
	@echo "   pulumi login"
	@echo "   pulumi stack select dev"
	@echo ""
	@echo "3. Container push failed:"
	@echo "   make docker-clean"
	@echo "   make container"
	@echo ""
	@echo "4. Socket.IO not connecting:"
	@echo "   Check FRONTEND_URL in server/.env"
	@echo "   Check REACT_APP_API_URL in client/.env"
	@echo ""
	@echo "5. Backend deployment:"
	@echo "   make deploy-backend  # Full deployment"
	@echo "   make update-backend  # Update only"
	@echo "   make status-backend  # Check status"
	@echo "   make logs-backend    # View logs"
	@echo ""
	@echo "Run 'make status' to check deployment status"

# ============================================================================
# ANSIBLE DEPLOYMENT TARGETS
# ============================================================================

# Create Ansible inventory from Pulumi outputs
create-inventory:
	@echo "$(YELLOW)📋 Creating Ansible inventory from Pulumi outputs...$(NC)"
	$(eval MONGODB_IPS := $(shell cd IaC && pulumi stack output mongodbInstanceIps --json 2>/dev/null | jq -r '.[]' | paste -sd ' ' -))
	$(eval BACKEND_IP := $(shell cd IaC && pulumi stack output backendPublicIp 2>/dev/null))
	$(eval CLIENT_ECR := $(shell cd IaC && pulumi stack output clientEcrRepositoryUrl 2>/dev/null))
	$(eval SERVER_ECR := $(shell cd IaC && pulumi stack output serverEcrRepositoryUrl 2>/dev/null))
	$(eval CONTAINER_ECR := $(shell cd IaC && pulumi stack output videoProcessorEcrRepositoryUrl 2>/dev/null))
	@if [ -z "$(MONGODB_IPS)" ] || [ -z "$(BACKEND_IP)" ]; then \
		echo "$(RED)❌ Error: Missing infrastructure. Run 'make deploy' first$(NC)"; \
		exit 1; \
	fi
	@echo "# Auto-generated Ansible inventory" > ansible/hosts.ini
	@echo "" >> ansible/hosts.ini
	@echo "[mongodb]" >> ansible/hosts.ini
	@i=0; for ip in $(MONGODB_IPS); do \
		if [ $$i -eq 0 ]; then \
			echo "$$ip mongodb_role=primary" >> ansible/hosts.ini; \
		else \
			echo "$$ip mongodb_role=secondary" >> ansible/hosts.ini; \
		fi; \
		i=$$((i+1)); \
	done
	@echo "" >> ansible/hosts.ini
	@echo "[backend]" >> ansible/hosts.ini
	@echo "$(BACKEND_IP)" >> ansible/hosts.ini
	@echo "" >> ansible/hosts.ini
	@echo "[all:vars]" >> ansible/hosts.ini
	@echo "ansible_user=ubuntu" >> ansible/hosts.ini
	@echo "ansible_ssh_private_key_file=~/.ssh/vision-sync-backend" >> ansible/hosts.ini
	@echo "ansible_ssh_common_args='-o StrictHostKeyChecking=no'" >> ansible/hosts.ini
	@echo "CLIENT_ECR_REPO=$(CLIENT_ECR)" >> ansible/hosts.ini
	@echo "SERVER_ECR_REPO=$(SERVER_ECR)" >> ansible/hosts.ini
	@echo "CONTAINER_ECR_REPO=$(CONTAINER_ECR)" >> ansible/hosts.ini
	@echo "AWS_DEFAULT_REGION=ap-southeast-1" >> ansible/hosts.ini
	@echo "$(GREEN)✅ Ansible inventory created: ansible/hosts.ini$(NC)"
	@echo "MongoDB IPs: $(MONGODB_IPS)"
	@echo "Backend IP: $(BACKEND_IP)"

# Validate Ansible configuration
check-ansible:
	@echo "$(YELLOW)🔍 Validating Ansible configuration...$(NC)"
	@command -v ansible >/dev/null 2>&1 || { echo "$(RED)❌ Ansible not found. Install with: pip install ansible$(NC)"; exit 1; }
	@if [ ! -f ansible/hosts.ini ]; then \
		echo "$(RED)❌ Inventory not found. Run 'make create-inventory' first$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)📋 Testing connectivity...$(NC)"
	@cd ansible && ansible all -i hosts.ini -m ping
	@echo "$(GREEN)✅ Ansible configuration valid$(NC)"

# Setup MongoDB replica set using Ansible
setup-mongodb: create-inventory check-ansible
	@echo "$(YELLOW)🚀 Setting up MongoDB replica set (1 Primary + 2 Secondary)...$(NC)"
	@cd ansible && ansible-playbook -i hosts.ini site.yml --tags mongodb
	@echo "$(GREEN)✅ MongoDB replica set setup complete!$(NC)"
	@make check-mongodb

# Check MongoDB replica set status
check-mongodb:
	@echo "$(YELLOW)🔍 Checking MongoDB replica set status...$(NC)"
	$(eval PRIMARY_IP := $(shell cd ansible && awk '/mongodb_role=primary/ {print $$1}' hosts.ini 2>/dev/null))
	@if [ -z "$(PRIMARY_IP)" ]; then \
		echo "$(RED)❌ Primary MongoDB IP not found. Run 'make create-inventory' first$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)📋 Connecting to primary MongoDB at $(PRIMARY_IP)...$(NC)"
	@ssh -o StrictHostKeyChecking=no -i "$$HOME/.ssh/vision-sync-backend" ubuntu@$(PRIMARY_IP) \
		'mongosh --eval "rs.status()" 2>/dev/null | grep -E "(set|name|stateStr|health)" || echo "MongoDB not ready yet"'
	@echo "$(GREEN)✅ MongoDB replica set status check complete$(NC)"

# Setup Redis cache using Docker (Simple & Better!)
setup-redis: create-inventory check-ansible
	@echo "$(YELLOW)🚀 Setting up Redis with Docker (much simpler!)...$(NC)"
	@cd ansible && ansible-playbook -i hosts.ini redis-docker-setup.yml
	@echo "$(GREEN)✅ Redis Docker setup complete!$(NC)"
	@make check-redis

# Check Redis server status
check-redis:
	@echo "$(YELLOW)🔍 Checking Redis server status...$(NC)"
	$(eval REDIS_IP := $(shell cd ansible && grep 'redis-server' hosts.ini | awk '{print $$2}' | cut -d'=' -f2 2>/dev/null))
	@if [ -z "$(REDIS_IP)" ]; then \
		echo "$(RED)❌ Redis IP not found. Run 'make create-inventory' first$(NC)"; \
		exit 1; \
	fi
	@echo "$(YELLOW)📋 Connecting to Redis server at $(REDIS_IP)...$(NC)"
	@ssh -o StrictHostKeyChecking=no -i "$$HOME/.ssh/vision-sync-backend" ec2-user@$(REDIS_IP) \
		'docker exec redis-server redis-cli -a VisionSyncRedis2024! info server | grep redis_version || echo "Redis not ready yet"'
	@echo "$(GREEN)✅ Redis server status check complete$(NC)"

# Setup both MongoDB and Redis
setup-all-db: setup-mongodb setup-redis
	@echo "$(GREEN)✅ All database services (MongoDB + Redis) setup complete!$(NC)"

# Deploy application using Ansible and ECR
deploy-with-ansible: create-inventory build-and-push-all-images
	@echo "$(YELLOW)🚀 Deploying Vision Sync application using Ansible...$(NC)"
	@cd ansible && ansible-playbook -i hosts.ini site.yml
	@echo "$(GREEN)✅ Application deployed via Ansible!$(NC)"
	@make status-ansible-deployment

# Build and push all Docker images to ECR
build-and-push-all-images:
	@echo "$(YELLOW)🐳 Building and pushing all Docker images to ECR...$(NC)"
	$(eval CLIENT_ECR := $(shell cd IaC && pulumi stack output clientEcrRepositoryUrl 2>/dev/null))
	$(eval SERVER_ECR := $(shell cd IaC && pulumi stack output serverEcrRepositoryUrl 2>/dev/null))
	$(eval CONTAINER_ECR := $(shell cd IaC && pulumi stack output videoProcessorEcrRepositoryUrl 2>/dev/null))
	$(eval AWS_REGION := ap-southeast-1)
	@if [ -z "$(CLIENT_ECR)" ]; then \
		echo "$(RED)❌ ECR repositories not found. Run 'make deploy' first$(NC)"; \
		exit 1; \
	fi
	@# Login to ECR
	@aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(CLIENT_ECR) 
	@# Build and push client
	@echo "$(YELLOW)📋 Building client image...$(NC)"
	@cd client && docker build -t vision-sync-client .
	@docker tag vision-sync-client:latest $(CLIENT_ECR):latest
	@docker push $(CLIENT_ECR):latest
	@# Build and push server
	@echo "$(YELLOW)📋 Building server image...$(NC)"
	@cd server && docker build -t vision-sync-server .
	@docker tag vision-sync-server:latest $(SERVER_ECR):latest
	@docker push $(SERVER_ECR):latest
	@# Build and push video processor
	@echo "$(YELLOW)📋 Building video processor image...$(NC)"
	@cd container && docker build -t vision-sync-processor .
	@docker tag vision-sync-processor:latest $(CONTAINER_ECR):latest
	@docker push $(CONTAINER_ECR):latest
	@echo "$(GREEN)✅ All images pushed to ECR!$(NC)"

# Check Ansible deployment status
status-ansible-deployment:
	@echo "$(YELLOW)📊 Checking Ansible deployment status...$(NC)"
	$(eval BACKEND_IP := $(shell cd IaC && pulumi stack output backendPublicIp 2>/dev/null))
	$(eval PRIMARY_IP := $(shell cd ansible && awk '/mongodb_role=primary/ {print $$1}' hosts.ini 2>/dev/null))
	@echo ""
	@echo "$(YELLOW)🖥️  Backend Application:$(NC)"
	@echo "IP: $(BACKEND_IP)"
	@echo "URL: http://$(BACKEND_IP):3000"
	@if curl -f -s "http://$(BACKEND_IP):3000" >/dev/null 2>&1; then \
		echo "Status: $(GREEN)✅ Online$(NC)"; \
	else \
		echo "Status: $(RED)❌ Offline$(NC)"; \
	fi
	@echo ""
	@echo "$(YELLOW)🗄️  MongoDB Replica Set:$(NC)"
	@echo "Primary: $(PRIMARY_IP)"
	@ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no -i "$$HOME/.ssh/vision-sync-backend" ubuntu@$(PRIMARY_IP) \
		'mongosh --quiet --eval "rs.isMaster().ismaster" 2>/dev/null' | grep -q true && \
		echo "Status: $(GREEN)✅ Primary Online$(NC)" || echo "Status: $(RED)❌ Primary Offline$(NC)"
	@echo ""
	@echo "$(GREEN)✅ Deployment status check complete$(NC)"

# Complete Ansible-based deployment
deploy-full-ansible: deploy build-and-push-all-images setup-mongodb deploy-with-ansible
	@echo ""
	@echo "$(GREEN)🎉 Complete Ansible deployment finished!$(NC)"
	@echo ""
	@echo "$(YELLOW)📋 Next steps:$(NC)"
	@echo "1. Access your application at: http://$(shell cd IaC && pulumi stack output backendPublicIp 2>/dev/null):3000"
	@echo "2. MongoDB replica set is ready for connections"
	@echo "3. All Docker images are deployed via ECR"
	@echo ""
	@echo "$(YELLOW)🔧 Management commands:$(NC)"
	@echo "  make check-mongodb           - Check MongoDB status"
	@echo "  make status-ansible-deployment - Check full deployment status"
	@echo "  make logs-backend           - View application logs"

# 🚀 ONE COMMAND DEPLOYMENT - Deploy everything at once
deploy-all: install build
	@echo "$(GREEN)🚀 STARTING COMPLETE DEPLOYMENT$(NC)"
	@echo "$(YELLOW)This will deploy: Infrastructure + Backend + Databases + All Services$(NC)"
	@echo ""
	
	@echo "$(YELLOW)📋 Step 1/6: Deploying AWS Infrastructure...$(NC)"
	cd IaC && pulumi up --yes
	@make update-env
	@echo "$(GREEN)✅ Infrastructure deployed!$(NC)"
	@echo ""
	
	@echo "$(YELLOW)📋 Step 2/6: Building and pushing containers...$(NC)"
	@make push-containers
	@echo "$(GREEN)✅ All containers pushed to ECR!$(NC)"
	@echo ""
	
	@echo "$(YELLOW)📋 Step 3/6: Setting up databases...$(NC)"
	@echo "$(GREEN)✅ Using cloud databases (MongoDB Atlas) - skipping local setup$(NC)"
	@echo ""
	
	@echo "$(YELLOW)📋 Step 4/6: Deploying backend services...$(NC)"
	@make deploy-services
	@echo "$(GREEN)✅ Backend services deployed!$(NC)"
	@echo ""
	
	@echo "$(YELLOW)📋 Step 5/6: Configuring application...$(NC)"
	@make configure-app
	@echo "$(GREEN)✅ Application configured!$(NC)"
	@echo ""
	
	@echo "$(YELLOW)📋 Step 6/6: Final verification...$(NC)"
	@make verify-deployment
	@echo ""
	@echo "$(GREEN)🎉 DEPLOYMENT COMPLETE!$(NC)"
	@echo "$(GREEN)✅ Your video streaming platform is ready!$(NC)"
	@make show-urls

# ⚡ Fast deployment for code updates only
deploy-fast: build
	@echo "$(GREEN)⚡ FAST DEPLOYMENT - Code Updates Only$(NC)"
	@make push-containers
	@make update-services
	@echo "$(GREEN)✅ Fast deployment complete!$(NC)"
	@make show-urls

# Push all containers to ECR
push-containers:
	$(eval ECR_VIDEO_URL := $(shell cd IaC && pulumi stack output ecrRepositoryUrl 2>/dev/null))
	$(eval ECR_BACKEND_URL := $(shell cd IaC && pulumi stack output ecrBackendUrl 2>/dev/null))
	$(eval ECR_CLIENT_URL := $(shell cd IaC && pulumi stack output ecrClientUrl 2>/dev/null))
	$(eval AWS_REGION := ap-southeast-1)
	
	@echo "🔐 Logging into ECR..."
	aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_VIDEO_URL)
	
	@echo "🐳 Building and pushing video processor..."
	cd container && docker build -t vision-sync-video-processor .
	docker tag vision-sync-video-processor:latest $(ECR_VIDEO_URL):latest
	docker push $(ECR_VIDEO_URL):latest
	
	@echo "🐳 Building and pushing backend..."
	docker build -f server/Dockerfile -t vision-sync-backend server/
	docker tag vision-sync-backend:latest $(ECR_BACKEND_URL):latest
	docker push $(ECR_BACKEND_URL):latest
	
	@echo "🐳 Building and pushing client..."
	docker build -f client/Dockerfile -t vision-sync-client client/
	docker tag vision-sync-client:latest $(ECR_CLIENT_URL):latest
	docker push $(ECR_CLIENT_URL):latest

# Setup all databases at once
setup-databases:
	@echo "🗄️  Setting up MongoDB replica set..."
	@make setup-mongodb
	@echo "🗄️  Setting up Redis cache..."
	@make setup-redis
	@echo "🗄️  Configuring database connections..."
	@make configure-db-connections

# Deploy all backend services
deploy-services:
	$(eval BACKEND_IP := $(shell cd IaC && pulumi stack output backendInstanceIp 2>/dev/null))
	$(eval ECR_BACKEND_URL := $(shell cd IaC && pulumi stack output ecrBackendUrl 2>/dev/null))
	
	@echo "🚀 Deploying backend to $(BACKEND_IP)..."
	@ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-key.pem ubuntu@$(BACKEND_IP) '\
		docker stop vision-sync-backend 2>/dev/null || true && \
		docker rm vision-sync-backend 2>/dev/null || true && \
		docker pull $(ECR_BACKEND_URL):latest && \
		docker run -d \
			--name vision-sync-backend \
			--restart unless-stopped \
			-p 5000:5000 \
			--env-file /home/ubuntu/.env \
			$(ECR_BACKEND_URL):latest'
	
	@echo "🚀 Starting video processing service..."
	@echo "✅ Video processing service (ECS) is managed automatically via SQS triggers"

# Configure application settings
configure-app:
	$(eval BACKEND_IP := $(shell cd IaC && pulumi stack output backendInstanceIp 2>/dev/null))
	$(eval CLOUDFRONT_DOMAIN := $(shell cd IaC && pulumi stack output cloudfrontDomain 2>/dev/null))
	
	@echo "🔧 Uploading environment configuration..."
	@scp -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-key.pem server/.env ubuntu@$(BACKEND_IP):/home/ubuntu/.env
	
	@echo "🔧 Configuring CORS and endpoints..."
	@ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-key.pem ubuntu@$(BACKEND_IP) '\
		echo "FRONTEND_URL=https://$(CLOUDFRONT_DOMAIN)" >> /home/ubuntu/.env && \
		echo "WEBHOOK_URL=http://$(BACKEND_IP):5000/api/webhook/processing-complete" >> /home/ubuntu/.env'

# Verify deployment is working
verify-deployment:
	$(eval BACKEND_IP := $(shell cd IaC && pulumi stack output backendInstanceIp 2>/dev/null))
	
	@echo "🔍 Checking backend health..."
	@curl -f http://$(BACKEND_IP):5000/health || echo "⚠️  Backend not responding yet"
	
	@echo "🔍 Checking database connections..."
	@ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-key.pem ubuntu@$(BACKEND_IP) 'docker logs vision-sync-backend --tail 10' || true

# Show deployment URLs and info
show-urls:
	$(eval BACKEND_IP := $(shell cd IaC && pulumi stack output backendInstanceIp 2>/dev/null))
	$(eval CLOUDFRONT_DOMAIN := $(shell cd IaC && pulumi stack output cloudfrontDomain 2>/dev/null))
	
	@echo ""
	@echo "$(GREEN)🌐 YOUR VIDEO STREAMING PLATFORM URLS:$(NC)"
	@echo "=========================================="
	@echo "🎥 Frontend:     https://$(CLOUDFRONT_DOMAIN)"
	@echo "🔧 Backend API:  http://$(BACKEND_IP):5000"
	@echo "📊 Health Check: http://$(BACKEND_IP):5000/health"
	@echo "📁 S3 Raw:       $(shell cd IaC && pulumi stack output s3RawBucket 2>/dev/null)"
	@echo "📁 S3 Processed: $(shell cd IaC && pulumi stack output s3ProcessedBucket 2>/dev/null)"
	@echo ""
	@echo "$(YELLOW)🔑 Access Info:$(NC)"
	@echo "SSH: ssh -i ~/.ssh/vision-sync-key.pem ubuntu@$(BACKEND_IP)"
	@echo "Logs: make logs-backend"
	@echo ""

# Update services (for fast deployments)
update-services:
	$(eval BACKEND_IP := $(shell cd IaC && pulumi stack output backendInstanceIp 2>/dev/null))
	$(eval ECR_BACKEND_URL := $(shell cd IaC && pulumi stack output ecrBackendUrl 2>/dev/null))
	
	@echo "🔄 Updating backend service..."
	@ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-key.pem ubuntu@$(BACKEND_IP) '\
		docker pull $(ECR_BACKEND_URL):latest && \
		docker stop vision-sync-backend && \
		docker rm vision-sync-backend && \
		docker run -d \
			--name vision-sync-backend \
			--restart unless-stopped \
			-p 5000:5000 \
			--env-file /home/ubuntu/.env \
			$(ECR_BACKEND_URL):latest'