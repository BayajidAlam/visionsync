import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags } from "../config";
import { vpc } from "../networking/vpc";
import { ubuntu, backendKey } from "../backend/ec2";

// MongoDB security group - restricted access from private subnet
const mongodbSecurityGroup = new aws.ec2.SecurityGroup("mongodb-sg", {
  name: `vision-sync-mongodb-sg-${pulumi.getStack()}`,
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 27017,
      toPort: 27017,
      cidrBlocks: ["10.0.0.0/16"], // Allow from entire VPC for replica set communication
      description: "MongoDB access from VPC (for replica set + backend)",
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
    Name: `vision-sync-mongodb-sg-${pulumi.getStack()}`,
    Purpose: "mongodb-private-access",
  },
});

// User data script for MongoDB setup on Ubuntu
const mongodbUserData = `#!/bin/bash
apt-get update -y
apt-get install -y docker.io
systemctl start docker
systemctl enable docker
usermod -a -G docker ubuntu

# MongoDB replica set setup
mkdir -p /data/mongodb
chown ubuntu:ubuntu /data/mongodb

# MongoDB will be installed and configured via Ansible
echo "MongoDB setup complete - ready for Ansible configuration"
`;

// MongoDB Instance 1 (Primary)
export const mongodbInstance1 = new aws.ec2.Instance("mongodb-1", {
  ami: ubuntu.then((ami) => ami.id), // Dynamic Ubuntu 22.04
  instanceType: "t3.small",
  keyName: backendKey.keyName,
  vpcSecurityGroupIds: [mongodbSecurityGroup.id],
  subnetId: vpc.privateSubnetIds[0],
  userData: mongodbUserData,

  tags: {
    ...commonTags,
    Name: `vision-sync-mongodb-1-${pulumi.getStack()}`,
    Role: "mongodb-primary",
  },
});

// MongoDB Instance 2 (Secondary)
export const mongodbInstance2 = new aws.ec2.Instance("mongodb-2", {
  ami: ubuntu.then((ami) => ami.id), // Dynamic Ubuntu 22.04
  instanceType: "t3.small",
  keyName: backendKey.keyName,
  vpcSecurityGroupIds: [mongodbSecurityGroup.id],
  subnetId: vpc.privateSubnetIds[1],
  userData: mongodbUserData,

  tags: {
    ...commonTags,
    Name: `vision-sync-mongodb-2-${pulumi.getStack()}`,
    Role: "mongodb-secondary",
  },
});

// MongoDB Instance 3 (Secondary)
export const mongodbInstance3 = new aws.ec2.Instance("mongodb-3", {
  ami: ubuntu.then((ami) => ami.id), // Dynamic Ubuntu 22.04
  instanceType: "t3.small",
  keyName: backendKey.keyName,
  vpcSecurityGroupIds: [mongodbSecurityGroup.id],
  subnetId: vpc.privateSubnetIds[0], // Use first subnet since we only have 2 private subnets
  userData: mongodbUserData,

  tags: {
    ...commonTags,
    Name: `vision-sync-mongodb-3-${pulumi.getStack()}`,
    Role: "mongodb-secondary",
  },
});

// MongoDB connection string
export const mongodbConnectionString = pulumi.interpolate`mongodb://${mongodbInstance1.privateIp}:27017,${mongodbInstance2.privateIp}:27017,${mongodbInstance3.privateIp}:27017/vision-sync?replicaSet=rs0`;
