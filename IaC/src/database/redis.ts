import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags } from "../config";
import { vpc } from "../networking/vpc";

import { ubuntu, backendKey } from "../backend/ec2";

// Redis security group - restricted access from private subnet
const redisSecurityGroup = new aws.ec2.SecurityGroup("redis-sg", {
  name: `vision-sync-redis-sg-${pulumi.getStack()}`,
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 6379,
      toPort: 6379,
      cidrBlocks: ["10.0.0.0/16"], // Allow from entire VPC (for backend + replica set pattern)
      description: "Redis access from VPC",
    },
    {
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      cidrBlocks: ["10.0.0.0/16"], // VPC CIDR
      description: "SSH access from VPC",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      description: "All outbound traffic",
    },
  ],
  tags: {
    ...commonTags,
    Name: `vision-sync-redis-sg-${pulumi.getStack()}`,
    Purpose: "redis-private-access",
  },
});

// User data script for Redis setup on Ubuntu
const redisUserData = `#!/bin/bash
apt-get update -y
apt-get install -y docker.io
systemctl start docker
systemctl enable docker
usermod -a -G docker ubuntu

# Create Redis data directory
mkdir -p /data/redis
chown ubuntu:ubuntu /data/redis

# Redis will be configured via Ansible
echo "Redis setup complete - ready for Ansible configuration"
`;

// Redis EC2 instance
export const redisInstance = new aws.ec2.Instance("redis-instance", {
  ami: ubuntu.then((ami) => ami.id), // Dynamic Ubuntu 22.04
  instanceType: "t3.micro", // Cost-effective for Redis
  keyName: backendKey.keyName,
  vpcSecurityGroupIds: [redisSecurityGroup.id],
  subnetId: vpc.privateSubnetIds[0],
  userData: redisUserData,

  rootBlockDevice: {
    volumeSize: 10, // 10GB for Redis data
    volumeType: "gp3",
    encrypted: true,
  },

  tags: {
    ...commonTags,
    Name: `vision-sync-redis-${pulumi.getStack()}`,
    Purpose: "caching-rate-limiting",
  },
});

// Export Redis configuration
export const redisEndpoint = redisInstance.privateIp;
export const redisPort = pulumi.output(6379);

// Redis configuration object
export const redisConfig = {
  password: "VisionSyncRedis2024!",
  maxMemory: "256mb",
  maxMemoryPolicy: "allkeys-lru",
  persistence: true,
};

// For compatibility with existing exports
export const redisCluster = redisInstance; // For compatibility with existing exports
