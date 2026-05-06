# VisionSync deployment and operations
# Secrets (REDIS_PASSWORD, etc.) must be set in environment or .env — never hardcode here
-include .env
export

SHELL := /usr/bin/bash
.RECIPEPREFIX := >

.PHONY: help install build dev clean deploy destroy outputs update-env \
        preflight require-infra prepare-key create-inventory ansible-sync ansible-bootstrap \
        setup-mongodb setup-redis setup-all-db check-mongodb check-redis \
        deploy-server deploy-client deploy-lambda deploy-processor deploy-prod status-prod \
        logs-server-prod logs-frontend ssh-frontend ssh-backend-prod

YELLOW := \033[1;33m
GREEN := \033[1;32m
RED := \033[1;31m
NC := \033[0m

AWS_REGION ?= ap-southeast-1
AWS_ACCOUNT ?= $(shell aws sts get-caller-identity --query Account --output text 2>/dev/null)
ECR_REGISTRY := $(AWS_ACCOUNT).dkr.ecr.$(AWS_REGION).amazonaws.com
SERVER_ECR := $(ECR_REGISTRY)/vision-sync-server-dev
CLIENT_ECR := $(ECR_REGISTRY)/vision-sync-client-dev

LOCAL_SSH_KEY ?= $(HOME)/.ssh/vision-sync-backend
SAFE_KEY_DIR ?= /tmp/vision-sync-keys
SAFE_SSH_KEY ?= $(SAFE_KEY_DIR)/vision-sync-backend
REMOTE_SSH_KEY ?= /home/ubuntu/.ssh/vision-sync-backend

BASTION_IP ?= $(shell cd IaC && pulumi stack output bastionPublicIp 2>/dev/null)
FRONTEND_EC2_IP ?= $(shell cd IaC && pulumi stack output frontendPublicIp 2>/dev/null)
BACKEND_EC2_IP ?= $(shell cd IaC && pulumi stack output backendPrivateIp 2>/dev/null)
MONGODB_NODES_JSON ?= $(shell cd IaC && pulumi stack output mongodbNodes 2>/dev/null)
MONGO_PRIMARY_IP ?= $(shell echo '$(MONGODB_NODES_JSON)' | sed -n 's/.*"primary":"\([^"]*\)".*/\1/p')
MONGO_SECONDARY1_IP ?= $(shell echo '$(MONGODB_NODES_JSON)' | sed -n 's/.*"secondary1":"\([^"]*\)".*/\1/p')
MONGO_SECONDARY2_IP ?= $(shell echo '$(MONGODB_NODES_JSON)' | sed -n 's/.*"secondary2":"\([^"]*\)".*/\1/p')
REDIS_IP ?= $(shell cd IaC && pulumi stack output redisEndpoint 2>/dev/null)

ALB_DNS ?= $(shell cd IaC && pulumi stack output loadBalancerDnsName 2>/dev/null)
ALB_URL ?= http://$(ALB_DNS)
CLOUDFRONT_DOMAIN ?= $(shell cd IaC && pulumi stack output cloudfrontDomain 2>/dev/null)
RAW_BUCKET ?= $(shell cd IaC && pulumi stack output rawVideosBucketName 2>/dev/null)
PROCESSED_BUCKET ?= $(shell cd IaC && pulumi stack output processedVideosBucketName 2>/dev/null)
SQS_QUEUE_URL ?= $(shell cd IaC && pulumi stack output videoProcessingQueueUrl 2>/dev/null)
MONGODB_URI ?= $(shell cd IaC && pulumi stack output mongodbConnectionString 2>/dev/null)
REDIS_PASSWORD ?=
REDIS_URL ?= redis://:$(REDIS_PASSWORD)@$(REDIS_IP):6379

LIVE_INVENTORY ?= ansible/live-inventory.ini

help:
> @echo "$(GREEN)VisionSync Makefile$(NC)"
> @echo ""
> @echo "Infrastructure:"
> @echo "  make deploy            - pulumi up"
> @echo "  make outputs           - show dynamic stack values"
> @echo "  make update-env        - update server/.env from Pulumi"
> @echo "  make destroy           - destroy infrastructure"
> @echo ""
> @echo "Bastion + Ansible:"
> @echo "  make create-inventory  - generate ansible/live-inventory.ini"
> @echo "  make ansible-sync      - copy ansible directory to bastion"
> @echo "  make ansible-bootstrap - sync + install ansible + copy key"
> @echo "  make setup-mongodb     - install/configure MongoDB replica set"
> @echo "  make setup-redis       - install/configure Redis"
> @echo "  make setup-all-db      - setup mongodb and redis"
> @echo ""
> @echo "Application deployment:"
> @echo "  make deploy-server     - build server image, push ECR, restart backend"
> @echo "  make deploy-client     - build client image on frontend host"
> @echo "  make deploy-lambda     - build lambda and update function code directly (no pulumi)"
> @echo "  make deploy-prod       - deploy server + client + status"
> @echo ""
> @echo "Operations:"
> @echo "  make status-prod       - show container status and ALB health"
> @echo "  make logs-server-prod  - tail backend logs"
> @echo "  make logs-frontend     - tail frontend logs"

install:
> @echo "$(YELLOW)Installing dependencies...$(NC)"
> cd server && npm install
> cd client && npm install
> cd lambda && npm install
> cd container && npm install
> cd IaC && npm install
> @echo "$(GREEN)Dependencies installed$(NC)"

build:
> @echo "$(YELLOW)Building components...$(NC)"
> cd server && npm run build
> cd client && npm run build
> cd lambda && npm run build
> cd container && npm run build
> @echo "$(GREEN)Build complete$(NC)"

dev:
> @echo "$(YELLOW)Starting backend and frontend in dev mode...$(NC)"
> cd server && npm run dev &
> cd client && npm run dev

clean:
> rm -rf server/dist client/dist lambda/dist container/dist
> rm -rf server/node_modules/.cache client/node_modules/.cache lambda/node_modules/.cache container/node_modules/.cache
> @echo "$(GREEN)Clean complete$(NC)"

deploy:
> @echo "$(YELLOW)Deploying infrastructure...$(NC)"
> cd IaC && pulumi up
> @echo "$(GREEN)Infrastructure deployed$(NC)"

destroy:
> @echo "$(RED)WARNING: this will destroy all infrastructure$(NC)"
> @read -p "Type 'yes' to continue: " c; [ "$$c" = "yes" ]
> cd IaC && pulumi destroy

outputs:
> @echo "$(GREEN)Current deployment outputs$(NC)"
> @echo "  AWS account:      $(AWS_ACCOUNT)"
> @echo "  Bastion IP:       $(BASTION_IP)"
> @echo "  Frontend IP:      $(FRONTEND_EC2_IP)"
> @echo "  Backend IP:       $(BACKEND_EC2_IP)"
> @echo "  ALB URL:          $(ALB_URL)"
> @echo "  CloudFront:       $(CLOUDFRONT_DOMAIN)"
> @echo "  MongoDB URI:      $(MONGODB_URI)"
> @echo "  Redis URL:        $(REDIS_URL)"
> @echo "  SQS URL:          $(SQS_QUEUE_URL)"

update-env:
> @if [ ! -f server/.env ]; then echo "$(YELLOW)server/.env not found, skipping update-env$(NC)"; exit 0; fi
> @cp server/.env server/.env.backup
> @sed -i 's|^AWS_REGION=.*|AWS_REGION=$(AWS_REGION)|' server/.env || true
> @sed -i 's|^S3_BUCKET_RAW=.*|S3_BUCKET_RAW=$(RAW_BUCKET)|' server/.env || true
> @sed -i 's|^S3_BUCKET_PROCESSED=.*|S3_BUCKET_PROCESSED=$(PROCESSED_BUCKET)|' server/.env || true
> @sed -i 's|^SQS_QUEUE_URL=.*|SQS_QUEUE_URL=$(SQS_QUEUE_URL)|' server/.env || true
> @sed -i 's|^MONGODB_URI=.*|MONGODB_URI=$(MONGODB_URI)|' server/.env || true
> @sed -i 's|^REDIS_URL=.*|REDIS_URL=$(REDIS_URL)|' server/.env || true
> @sed -i 's|^CLOUDFRONT_DOMAIN=.*|CLOUDFRONT_DOMAIN=$(CLOUDFRONT_DOMAIN)|' server/.env || true
> @sed -i 's|^FRONTEND_URL=.*|FRONTEND_URL=$(ALB_URL)|' server/.env || true
> @echo "$(GREEN)Updated server/.env (backup: server/.env.backup)$(NC)"

preflight:
> @command -v aws >/dev/null || (echo "$(RED)aws CLI not found$(NC)" && exit 1)
> @command -v docker >/dev/null || (echo "$(RED)docker not found$(NC)" && exit 1)
> @command -v pulumi >/dev/null || (echo "$(RED)pulumi not found$(NC)" && exit 1)
> @aws sts get-caller-identity --output text >/dev/null || (echo "$(RED)aws credentials are not valid$(NC)" && exit 1)
> @test -f "$(LOCAL_SSH_KEY)" || (echo "$(RED)SSH key not found at $(LOCAL_SSH_KEY)$(NC)" && exit 1)

require-infra:
> @test -n "$(BASTION_IP)" || (echo "$(RED)bastionPublicIp is empty$(NC)" && exit 1)
> @test -n "$(FRONTEND_EC2_IP)" || (echo "$(RED)frontendPublicIp is empty$(NC)" && exit 1)
> @test -n "$(BACKEND_EC2_IP)" || (echo "$(RED)backendPrivateIp is empty$(NC)" && exit 1)
> @test -n "$(MONGO_PRIMARY_IP)" || (echo "$(RED)mongodbNodes.primary is empty$(NC)" && exit 1)
> @test -n "$(MONGO_SECONDARY1_IP)" || (echo "$(RED)mongodbNodes.secondary1 is empty$(NC)" && exit 1)
> @test -n "$(MONGO_SECONDARY2_IP)" || (echo "$(RED)mongodbNodes.secondary2 is empty$(NC)" && exit 1)
> @test -n "$(REDIS_IP)" || (echo "$(RED)redisEndpoint is empty$(NC)" && exit 1)

prepare-key: preflight
> @mkdir -p "$(SAFE_KEY_DIR)"
> @cp "$(LOCAL_SSH_KEY)" "$(SAFE_SSH_KEY)"
> @chmod 600 "$(SAFE_SSH_KEY)"
> @echo "$(GREEN)Prepared space-safe SSH key at $(SAFE_SSH_KEY)$(NC)"

create-inventory: require-infra
> @printf '%s\n' \
> "[mongodb]" \
> "mongodb-primary ansible_host=$(MONGO_PRIMARY_IP)" \
> "mongodb-secondary-1 ansible_host=$(MONGO_SECONDARY1_IP)" \
> "mongodb-secondary-2 ansible_host=$(MONGO_SECONDARY2_IP)" \
> "" \
> "[redis]" \
> "redis-server ansible_host=$(REDIS_IP)" \
> "" \
> "[backend]" \
> "backend-server ansible_host=$(BACKEND_EC2_IP)" \
> "" \
> "[frontend]" \
> "frontend-server ansible_host=$(FRONTEND_EC2_IP)" \
> "" \
> "[all:vars]" \
> "ansible_user=ubuntu" \
> "ansible_ssh_private_key_file=~/.ssh/vision-sync-backend" \
> "ansible_ssh_common_args=-o StrictHostKeyChecking=no" \
> "aws_region=$(AWS_REGION)" \
> "aws_account=$(AWS_ACCOUNT)" \
> "raw_bucket=$(RAW_BUCKET)" \
> "processed_bucket=$(PROCESSED_BUCKET)" \
> "sqs_queue_url=$(SQS_QUEUE_URL)" \
> "mongodb_uri=$(MONGODB_URI)" \
> "redis_url=$(REDIS_URL)" \
> "redis_password=$(REDIS_PASSWORD)" \
> "cloudfront_domain=$(CLOUDFRONT_DOMAIN)" \
> "alb_url=$(ALB_URL)" > "$(LIVE_INVENTORY)"
> @cp "$(LIVE_INVENTORY)" ansible/hosts.ini
> @echo "$(GREEN)Generated $(LIVE_INVENTORY) and ansible/hosts.ini$(NC)"

ansible-sync: prepare-key create-inventory
> @echo "$(YELLOW)Syncing ansible content to bastion $(BASTION_IP)...$(NC)"
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "rm -rf ~/ansible-sync && mkdir -p ~/ansible-sync"
> @scp -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" -r ansible ubuntu@$(BASTION_IP):~/ansible-sync
> @scp -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" "$(LIVE_INVENTORY)" ubuntu@$(BASTION_IP):~/ansible-sync/ansible/live-inventory.ini
> @echo "$(GREEN)Ansible synced to bastion$(NC)"

ansible-bootstrap: ansible-sync
> @echo "$(YELLOW)Bootstrapping ansible runtime on bastion...$(NC)"
> @scp -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP):~/vision-sync-backend
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "mkdir -p ~/.ssh && mv ~/vision-sync-backend $(REMOTE_SSH_KEY) && chmod 600 $(REMOTE_SSH_KEY)"
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "command -v ansible-playbook >/dev/null || (sudo apt-get update && sudo apt-get install -y ansible)"
> @echo "$(GREEN)Bastion bootstrap complete$(NC)"

setup-mongodb: ansible-bootstrap
> @echo "$(YELLOW)Setting up MongoDB replica set...$(NC)"
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "cd ~/ansible-sync/ansible && ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -i live-inventory.ini mongodb-replica-setup.yml -e 'primary_ip=$(MONGO_PRIMARY_IP) secondary1_ip=$(MONGO_SECONDARY1_IP) secondary2_ip=$(MONGO_SECONDARY2_IP)'"
> @echo "$(GREEN)MongoDB setup complete$(NC)"

setup-redis: ansible-bootstrap
> @echo "$(YELLOW)Setting up Redis...$(NC)"
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "cd ~/ansible-sync/ansible && ANSIBLE_HOST_KEY_CHECKING=False ansible-playbook -i live-inventory.ini redis-setup.yml"
> @echo "$(GREEN)Redis setup complete$(NC)"

setup-all-db: setup-mongodb setup-redis
> @echo "$(GREEN)MongoDB and Redis setup completed$(NC)"

check-mongodb: prepare-key require-infra
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$(MONGO_PRIMARY_IP) \"mongosh --quiet --eval 'rs.status().members.forEach(m => print(m.name + \" \" + m.stateStr))'\""

check-redis: prepare-key require-infra
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$(REDIS_IP) \"docker exec redis-server redis-cli -a $(REDIS_PASSWORD) ping\""

deploy-server: preflight require-infra prepare-key
> @echo "$(YELLOW)Building and pushing backend image...$(NC)"
> @cd server && docker build -t vision-sync-server:latest .
> @aws ecr get-login-password --region "$(AWS_REGION)" | docker login --username AWS --password-stdin "$(ECR_REGISTRY)"
> @docker tag vision-sync-server:latest "$(SERVER_ECR):latest"
> @docker push "$(SERVER_ECR):latest"
> @echo "$(YELLOW)Deploying backend through bastion...$(NC)"
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$(BACKEND_EC2_IP) 'aws ecr get-login-password --region $(AWS_REGION) | docker login --username AWS --password-stdin $(ECR_REGISTRY) && docker pull $(SERVER_ECR):latest && docker stop vision-sync-server 2>/dev/null || true && docker rm vision-sync-server 2>/dev/null || true && docker run -d --name vision-sync-server --restart unless-stopped -p 5000:5000 -e PORT=5000 -e NODE_ENV=production -e AWS_REGION=$(AWS_REGION) -e S3_BUCKET_RAW=$(RAW_BUCKET) -e S3_BUCKET_PROCESSED=$(PROCESSED_BUCKET) -e SQS_QUEUE_URL="$(SQS_QUEUE_URL)" -e MONGODB_URI="$(MONGODB_URI)" -e REDIS_URL="$(REDIS_URL)" -e CLOUDFRONT_DOMAIN=$(CLOUDFRONT_DOMAIN) -e FRONTEND_URL=$(ALB_URL) $(SERVER_ECR):latest && docker ps --format \"table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\" | grep vision-sync-server'"
> @echo "$(GREEN)Backend deployed$(NC)"

deploy-lambda: preflight
> @echo "$(YELLOW)Building Lambda and updating function code...$(NC)"
> @cd lambda && npm run build
> @rm -f /tmp/vision-sync-lambda.zip
> @cd lambda/dist && zip -r /tmp/vision-sync-lambda.zip . > /dev/null
> @cd lambda && zip -r /tmp/vision-sync-lambda.zip node_modules/ > /dev/null
> @aws lambda update-function-code \
>   --function-name vision-sync-ecs-trigger-dev \
>   --zip-file fileb:///tmp/vision-sync-lambda.zip \
>   --region $(AWS_REGION) \
>   --output text --query 'FunctionArn'
> @aws lambda wait function-updated \
>   --function-name vision-sync-ecs-trigger-dev \
>   --region $(AWS_REGION)
> @echo "$(GREEN)Lambda deployed$(NC)"

deploy-processor: preflight
> @echo "$(YELLOW)Building and pushing processor image...$(NC)"
> @cd container && docker build -t vision-sync-processor:latest .
> @aws ecr get-login-password --region "$(AWS_REGION)" | docker login --username AWS --password-stdin "$(ECR_REGISTRY)"
> @docker tag vision-sync-processor:latest "$(ECR_REGISTRY)/vision-sync-video-processor-dev:latest"
> @docker push "$(ECR_REGISTRY)/vision-sync-video-processor-dev:latest"
> @echo "$(GREEN)Processor image pushed$(NC)"

push-containers: preflight
> @echo "$(YELLOW)Building and pushing all containers...$(NC)"
> @aws ecr get-login-password --region "$(AWS_REGION)" | docker login --username AWS --password-stdin "$(ECR_REGISTRY)"
> @cd server && docker build -t vision-sync-server:latest .
> @docker tag vision-sync-server:latest "$(SERVER_ECR):latest"
> @docker push "$(SERVER_ECR):latest"
> @cd client && docker build --build-arg VITE_API_URL=$(ALB_URL) -t vision-sync-client:latest .
> @docker tag vision-sync-client:latest "$(CLIENT_ECR):latest"
> @docker push "$(CLIENT_ECR):latest"
> @cd container && docker build -t vision-sync-processor:latest .
> @docker tag vision-sync-processor:latest "$(ECR_REGISTRY)/vision-sync-video-processor-dev:latest"
> @docker push "$(ECR_REGISTRY)/vision-sync-video-processor-dev:latest"
> @echo "$(GREEN)All containers built and pushed$(NC)"

deploy-client: preflight require-infra prepare-key
> @echo "$(YELLOW)Packaging and deploying frontend...$(NC)"
> @tar --exclude='client/node_modules' --exclude='client/dist' -czf /tmp/vision-sync-client.tar.gz client/
> @scp -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" /tmp/vision-sync-client.tar.gz ubuntu@$(FRONTEND_EC2_IP):~/client-src.tar.gz
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(FRONTEND_EC2_IP) "set -e; rm -rf ~/client-build && mkdir ~/client-build; tar -xzf ~/client-src.tar.gz -C ~/client-build --strip-components=1; cd ~/client-build; docker build --build-arg VITE_API_URL=$(ALB_URL) -t vision-sync-client:latest .; docker stop vision-sync-client 2>/dev/null || true; docker rm vision-sync-client 2>/dev/null || true; docker run -d --name vision-sync-client --restart unless-stopped -p 80:80 vision-sync-client:latest; docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep vision-sync-client"
> @echo "$(GREEN)Frontend deployed$(NC)"

deploy-prod: deploy-server deploy-client status-prod
> @echo "$(GREEN)Production deployment complete$(NC)"

status-prod: preflight require-infra prepare-key
> @echo "$(YELLOW)Frontend container status ($(FRONTEND_EC2_IP))$(NC)"
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(FRONTEND_EC2_IP) "docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'"
> @echo ""
> @echo "$(YELLOW)Backend container status ($(BACKEND_EC2_IP) via $(BASTION_IP))$(NC)"
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$(BACKEND_EC2_IP) \"docker ps --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}'\""
> @echo ""
> @echo "$(YELLOW)ALB health check ($(ALB_URL)/health)$(NC)"
> @curl -sS "$(ALB_URL)/health" || true
> @echo ""
> @curl -I -sS "$(ALB_URL)" | head -n 1 || true

logs-server-prod: prepare-key require-infra
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(BASTION_IP) "ssh -o StrictHostKeyChecking=no -i ~/.ssh/vision-sync-backend ubuntu@$(BACKEND_EC2_IP) 'docker logs -f vision-sync-server'"

logs-frontend: prepare-key require-infra
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(FRONTEND_EC2_IP) "docker logs -f vision-sync-client"

ssh-frontend: prepare-key require-infra
> @ssh -o StrictHostKeyChecking=no -i "$(SAFE_SSH_KEY)" ubuntu@$(FRONTEND_EC2_IP)

ssh-backend-prod: prepare-key require-infra
> @ssh -J ubuntu@$(BASTION_IP) -i "$(SAFE_SSH_KEY)" ubuntu@$(BACKEND_EC2_IP)
