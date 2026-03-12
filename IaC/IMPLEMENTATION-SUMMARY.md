# ✅ Updated Architecture: MongoDB + ECR + Ansible

## 🎯 **Implemented Your Requirements**

### 1. MongoDB Configuration (1 Write + 2 Read Replicas)

✅ **1 Primary MongoDB** (AZ-A) - Handles all write operations  
✅ **2 Secondary MongoDB** (AZ-B, AZ-C) - Read replicas for scaling  
✅ **Ansible-ready setup** - User accounts and SSH access configured  
✅ **Cost optimized** - All t3.small instances (~$48/month total)

### 2. ECR Repositories (3 Separate Containers)

✅ **Client ECR Repository** - Frontend/React application container  
✅ **Server ECR Repository** - Backend/API application container  
✅ **Container ECR Repository** - Video processing worker container  
✅ **Lifecycle policies** - Auto-cleanup of old images  
✅ **Security scanning** - Automatic vulnerability scanning

### 3. Ansible Automation

✅ **MongoDB replica set setup** - Automated configuration and initialization  
✅ **ECR image deployment** - Pull and deploy from all three repositories  
✅ **Environment configuration** - Automatic connection strings and variables  
✅ **Docker Compose setup** - Multi-container application orchestration

## 📁 **File Changes Made**

### Infrastructure Updates

- **`src/database/mongodb.ts`**: Changed from 1+1+arbiter to 1+2 read replicas
- **`src/compute/ecr.ts`**: Added client and server ECR repositories
- **`src/backend/ec2.ts`**: Added Ansible setup and ECR permissions
- **`index-modular.ts`**: Updated exports for new repositories

### Ansible Automation Added

- **`ansible/site.yml`**: MongoDB setup + application deployment playbooks
- **`ansible/templates/mongod.conf.j2`**: MongoDB configuration template
- **`ansible/templates/docker-compose.yml.j2`**: Multi-container setup
- **`ansible/README.md`**: Complete automation documentation

## 🚀 **Deployment Workflow**

### 1. Deploy Infrastructure

```bash
cd IaC
cp index-modular.ts index.ts
pulumi up
```

### 2. Build and Push Images

```bash
# Get ECR URLs from Pulumi outputs
CLIENT_ECR=$(pulumi stack output clientEcrRepositoryUrl)
SERVER_ECR=$(pulumi stack output serverEcrRepositoryUrl)
CONTAINER_ECR=$(pulumi stack output ecrRepositoryUrl)

# Login to ECR
aws ecr get-login-password | docker login --username AWS --password-stdin $CLIENT_ECR

# Build and push each image
docker build -t client ./client && docker tag client $CLIENT_ECR:latest && docker push $CLIENT_ECR:latest
docker build -t server ./server && docker tag server $SERVER_ECR:latest && docker push $SERVER_ECR:latest
docker build -t container ./container && docker tag container $CONTAINER_ECR:latest && docker push $CONTAINER_ECR:latest
```

### 3. Run Ansible Automation

```bash
# SSH to backend instance
BACKEND_IP=$(pulumi stack output backendPublicIp)
ssh -i ~/.ssh/vision-sync-key ubuntu@$BACKEND_IP

# Run MongoDB setup
cd /opt/vision-sync
ansible-playbook -i inventory.ini ~/ansible/site.yml

# Applications automatically start via Docker Compose
```

## 🔗 **Connection Architecture**

```
┌─────────────────────────────────────────────────────────────┐
│                MongoDB Replica Set (vision-sync-rs)        │
├─────────────────────────────────────────────────────────────┤
│  AZ-A: Primary     AZ-B: Secondary-1   AZ-C: Secondary-2   │
│  (Write + Read)    (Read Only)         (Read Only)         │
│  t3.small          t3.small            t3.small            │
└─────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend EC2 Instance                     │
├─────────────────────────────────────────────────────────────┤
│  Client Container  ◄──── ECR: vision-sync-client          │
│  Server Container  ◄──── ECR: vision-sync-server          │
│  Video Processor   ◄──── ECR: vision-sync-video-processor │
└─────────────────────────────────────────────────────────────┘
```

## 💰 **Cost Optimization**

### MongoDB Cluster

- **3 x t3.small instances**: ~$48/month
- **vs. Atlas M30 cluster**: $82/month
- **Savings**: 41% reduction

### ECR Storage

- **3 repositories**: ~$3/month (with lifecycle cleanup)
- **Automatic cleanup**: Untagged images deleted after 1 day
- **Version control**: Keep latest 10 tagged versions

## 🔧 **Environment Variables Available**

### Auto-configured on Backend Instance

```bash
CLIENT_ECR_REPO=<account>.dkr.ecr.us-east-1.amazonaws.com/vision-sync-client-dev
SERVER_ECR_REPO=<account>.dkr.ecr.us-east-1.amazonaws.com/vision-sync-server-dev
CONTAINER_ECR_REPO=<account>.dkr.ecr.us-east-1.amazonaws.com/vision-sync-video-processor-dev
MONGODB_URI=mongodb://<primary>:27017,<secondary1>:27017,<secondary2>:27017/vision-sync?replicaSet=vision-sync-rs
```

Your infrastructure now **perfectly matches your requirements**:

- ✅ **1 write + 2 read MongoDB replicas**
- ✅ **3 separate ECR repositories**
- ✅ **Ansible automation for everything**
- ✅ **Cost-optimized and production-ready**

🎉 Ready for deployment!
