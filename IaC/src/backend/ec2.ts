import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { commonTags, config } from "../config";
import { vpc } from "../networking/vpc";
import { rawVideosBucket, processedVideosBucket } from "../storage/s3";
import { videoProcessingQueue } from "../messaging/sqs";
import {
  clientEcrRepository,
  serverEcrRepository,
  ecrRepository,
} from "../compute/ecr";
// Dependencies will be loaded later to avoid circular imports

// Get Ubuntu AMI
export const ubuntu = aws.ec2.getAmi({
  mostRecent: true,
  owners: ["099720109477"], // Canonical
  filters: [
    {
      name: "name",
      values: ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"],
    },
    {
      name: "virtualization-type",
      values: ["hvm"],
    },
  ],
});

// Security group for backend - access from VPC
export const backendSg = new aws.ec2.SecurityGroup("backend-sg", {
  name: `vision-sync-backend-sg-${pulumi.getStack()}`,
  vpcId: vpc.vpcId,
  ingress: [
    // SSH access from VPC
    {
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      cidrBlocks: ["10.0.0.0/16"], // VPC CIDR
      description: "SSH access from VPC",
    },
    // HTTP access from anywhere in VPC
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["10.0.0.0/16"], // VPC CIDR
      description: "HTTP access from VPC",
    },
    // Backend API access from VPC
    {
      protocol: "tcp",
      fromPort: 5000,
      toPort: 5000,
      cidrBlocks: ["10.0.0.0/16"], // VPC CIDR
      description: "Backend API access from VPC",
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
  tags: { ...commonTags, Purpose: "backend-private-access" },
});

// Key pair for EC2
export const backendKey = new aws.ec2.KeyPair("backend-key", {
  keyName: `vision-sync-backend-${pulumi.getStack()}`,
  publicKey: config.require("sshPublicKey"),
  tags: commonTags,
});

// IAM role for backend instance
export const backendRole = new aws.iam.Role("backend-role", {
  assumeRolePolicy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "ec2.amazonaws.com" },
      },
    ],
  }),
  tags: commonTags,
});

// IAM policy for backend
export const backendPolicy = new aws.iam.Policy("backend-policy", {
  policy: pulumi
    .all([
      rawVideosBucket.arn,
      processedVideosBucket.arn,
      videoProcessingQueue.arn,
      clientEcrRepository.arn,
      serverEcrRepository.arn,
      ecrRepository.arn,
    ])
    .apply(
      ([
        rawArn,
        processedArn,
        queueArn,
        clientEcrArn,
        serverEcrArn,
        containerEcrArn,
      ]) =>
        pulumi.jsonStringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Action: ["s3:*"],
              Resource: [
                `${rawArn}/*`,
                `${processedArn}/*`,
                rawArn,
                processedArn,
              ],
            },
            {
              Effect: "Allow",
              Action: ["sqs:*"],
              Resource: queueArn,
            },
            {
              Effect: "Allow",
              Action: [
                "ecr:GetAuthorizationToken",
                "ecr:BatchCheckLayerAvailability",
                "ecr:GetDownloadUrlForLayer",
                "ecr:BatchGetImage",
                "ecr:PutImage",
                "ecr:InitiateLayerUpload",
                "ecr:UploadLayerPart",
                "ecr:CompleteLayerUpload",
              ],
              Resource: [clientEcrArn, serverEcrArn, containerEcrArn],
            },
            {
              Effect: "Allow",
              Action: ["ecr:GetAuthorizationToken"],
              Resource: "*",
            },
          ],
        }),
    ),
});

export const backendPolicyAttachment = new aws.iam.RolePolicyAttachment(
  "backend-policy-attach",
  {
    role: backendRole.name,
    policyArn: backendPolicy.arn,
  },
);

export const backendProfile = new aws.iam.InstanceProfile("backend-profile", {
  role: backendRole.name,
});

// User data script for basic Docker setup
export const userData = `#!/bin/bash
set -e
apt-get update
apt-get install -y docker.io awscli python3 python3-pip

# Install Ansible
pip3 install ansible

systemctl start docker
systemctl enable docker
usermod -aG docker ubuntu

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Create app directory
mkdir -p /opt/vision-sync
chown ubuntu:ubuntu /opt/vision-sync

# Create ansible user for automation
useradd -m -s /bin/bash ansible
mkdir -p /home/ansible/.ssh
chown ansible:ansible /home/ansible/.ssh
chmod 700 /home/ansible/.ssh

# Add ansible to sudoers
echo "ansible ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

echo "Backend instance ready - Ansible configuration will be added later"
`;

// Backend EC2 instance
export const backendInstance = new aws.ec2.Instance("backend-instance", {
  ami: ubuntu.then((ami) => ami.id),
  instanceType: "t3.small",
  keyName: backendKey.keyName,
  vpcSecurityGroupIds: [backendSg.id],
  subnetId: vpc.privateSubnetIds[0], // Move to private subnet
  iamInstanceProfile: backendProfile.name,
  associatePublicIpAddress: false, // No public IP - access via bastion
  userData: userData,
  tags: { ...commonTags, Name: `vision-sync-backend-${pulumi.getStack()}` },
});

// Backend instance is in private subnet - no public IP needed
