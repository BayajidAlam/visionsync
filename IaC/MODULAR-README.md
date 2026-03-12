# Vision Sync Infrastructure - Modular Structure

## Overview

This directory contains the modularized infrastructure code for the Vision Sync video streaming platform, converted from a single 880-line file into organized modules for better maintainability and clarity.

## Directory Structure

```
IaC/
├── index-modular.ts          # Main entry point (modular version)
├── index.ts                  # Original monolithic file (preserved)
└── src/
    ├── config/
    │   └── index.ts          # Configuration, region, tags
    ├── networking/
    │   └── vpc.ts            # VPC with optimized NAT Gateway strategy
    ├── storage/
    │   └── s3.ts             # S3 buckets and CloudFront distribution
    ├── messaging/
    │   └── sqs.ts            # SQS queues for video processing
    ├── monitoring/
    │   ├── logs.ts           # CloudWatch log groups
    │   └── alarms.ts         # CloudWatch alarms and metrics
    ├── security/
    │   └── iam.ts            # IAM roles and policies
    ├── database/
    │   └── mongodb.ts        # MongoDB 3-instance replica set cluster
    ├── compute/
    │   ├── ecr.ts            # Container registry
    │   ├── ecs.ts            # ECS cluster and task definitions
    │   └── lambda.ts         # Lambda function for ECS triggers
    └── backend/
        └── ec2.ts            # Backend EC2 instance
```

## Module Descriptions

### Configuration (`src/config/index.ts`)

- Central configuration management
- AWS region detection
- Common tags for all resources
- Stack name and environment variables

### Networking (`src/networking/vpc.ts`)

- Multi-AZ VPC with public/private subnets
- Single NAT Gateway strategy (cost optimization: $33/month savings)
- Optimized for ECS Fargate workloads

### Storage (`src/storage/s3.ts`)

- Raw videos bucket with 7-day lifecycle
- Processed videos bucket with intelligent tiering
- CloudFront distribution with cost-optimized price class
- Origin Access Identity for secure content delivery

### Messaging (`src/messaging/sqs.ts`)

- Video processing queue with long polling
- Dead letter queue with 3-retry policy
- Optimized visibility timeouts for Lambda/ECS workflow

### Monitoring (`src/monitoring/`)

- **logs.ts**: CloudWatch log groups for ECS (7-day retention) and Lambda (14-day retention)
- **alarms.ts**: Error rate and queue depth monitoring with thresholds

### Database (`src/database/mongodb.ts`)

- **3 MongoDB instances** deployed across multiple AZs (1 Primary + 2 Secondary read replicas)
- **Replica set configuration** for high availability and automatic failover
- **Ansible-ready setup** with prepared user accounts and SSH access
- **Security groups** with proper MongoDB port access (27017-27019)
- **Cost optimized** with t3.small instances for all replicas
- **Read scaling** with dedicated secondary replicas for read operations

### Security (`src/security/iam.ts`)

- ECS execution and task roles with least-privilege policies
- Lambda execution role with SQS and ECS permissions
- S3 access policies for video processing workflow

### Compute (`src/compute/`)

- **ecr.ts**: Three separate container registries (client, server, video processor) with lifecycle policies and security scanning
- **ecs.ts**: Fargate cluster with 70% Spot instances (cost optimization)
- **lambda.ts**: Event-driven ECS task trigger with SQS integration

### Backend (`src/backend/ec2.ts`)

- Ubuntu-based EC2 instance with Docker and Ansible
- **Ansible automation ready** with inventory file and environment variables
- **ECR integration** with push/pull permissions for all three repositories
- **MongoDB connection** via direct replica set connection
- IAM instance profile for AWS service access
- Elastic IP and security groups

## Cost Optimizations Preserved

1. **VPC**: Single NAT Gateway instead of per-AZ ($33/month savings)
2. **ECS**: 70% Fargate Spot instances (70% cost reduction)
3. **CloudFront**: PriceClass_100 (US/EU only)
4. **S3**: Intelligent tiering and lifecycle policies
5. **Lambda**: Reduced timeout from 900s to 60s

## Usage

### Deploy with Modular Structure

```bash
# Use the modular version
cp index-modular.ts index.ts
pulumi up
```

### Revert to Original

```bash
# Restore original monolithic version
git checkout index.ts
pulumi up
```

## Key Features Maintained

## Key Features Maintained + New

- ✅ Adaptive bitrate video streaming
- ✅ Event-driven processing with SQS/Lambda/ECS
- ✅ Container-based video processing
- ✅ CloudFront global content delivery
- ✅ **1 Primary + 2 Secondary MongoDB replica set** (1 write + 2 read)
- ✅ **Multi-AZ database high availability** with automatic failover
- ✅ **3 separate ECR repositories** (client, server, container)
- ✅ **Ansible automation** for MongoDB setup and application deployment
- ✅ **Read scaling** with dedicated read replicas
- ✅ Comprehensive monitoring and alerting
- ✅ Cost-optimized infrastructure
- ✅ Security best practices
- ✅ All 30+ AWS resources (including MongoDB cluster + ECR repos)

## Dependencies

Each module imports only what it needs:

- All modules depend on `config` for tags and settings
- Compute modules depend on `security` for IAM roles
- Lambda depends on `messaging` for SQS triggers
- ECS depends on `networking` for VPC placement
- **Database module provides MongoDB cluster across 3 AZs**
- **Backend connects to MongoDB cluster via load balancer**

## Exports

The modular structure maintains the same exports as the original file, plus new MongoDB and ECR exports:

- Bucket names and URLs
- ECS cluster and repository information
- Lambda function details
- CloudFront distribution data
- VPC and network configuration
- Backend instance information
- **MongoDB cluster IPs** (Primary + 2 Secondary)
- **MongoDB replica set connection string**
- **Three ECR repository URLs** (client, server, container)

This ensures compatibility with existing automation and scripts.
