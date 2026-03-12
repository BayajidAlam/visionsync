import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { commonTags } from "../config";
import { vpc } from "../networking/vpc";
import { ubuntu, backendKey } from "../backend/ec2";
import { clientEcrRepository } from "../compute/ecr";

// Security group for frontend instances
export const frontendSg = new aws.ec2.SecurityGroup("frontend-sg", {
  name: `vision-sync-frontend-sg-${pulumi.getStack()}`,
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description: "HTTP access for frontend",
    },
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["0.0.0.0/0"],
      description: "HTTPS access for frontend",
    },
    {
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      cidrBlocks: ["0.0.0.0/0"],
      description: "SSH access for deployment",
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
    Name: "frontend-security-group",
    Purpose: "frontend-web-access",
  },
});

// IAM Role for frontend instance (ECR pull access)
const frontendRole = new aws.iam.Role("frontend-role", {
  name: `vision-sync-frontend-role-${pulumi.getStack()}`,
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "ec2.amazonaws.com" },
      },
    ],
  }),
  tags: { ...commonTags, Name: "frontend-role" },
});

const frontendPolicy = new aws.iam.RolePolicy("frontend-ecr-policy", {
  name: "frontend-ecr-pull",
  role: frontendRole.id,
  policy: pulumi.output(clientEcrRepository.arn).apply((arn) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: "ecr:GetAuthorizationToken",
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:GetDownloadUrlForLayer",
            "ecr:BatchGetImage",
          ],
          Resource: arn,
        },
      ],
    }),
  ),
});

const frontendProfile = new aws.iam.InstanceProfile("frontend-profile", {
  name: `vision-sync-frontend-profile-${pulumi.getStack()}`,
  role: frontendRole.name,
  tags: { ...commonTags, Name: "frontend-profile" },
});

// User data script for frontend instance
const frontendUserData = `#!/bin/bash
apt-get update -y
apt-get install -y docker.io awscli
systemctl start docker
systemctl enable docker
usermod -a -G docker ubuntu

echo "Frontend instance setup complete"
`;

// Frontend EC2 Instance
export const frontendInstance = new aws.ec2.Instance("frontend-instance", {
  ami: ubuntu.then((ami) => ami.id), // Ubuntu 22.04
  instanceType: "t3.small", // Cost-effective for frontend
  keyName: backendKey.keyName, // Using same key as backend
  vpcSecurityGroupIds: [frontendSg.id],
  subnetId: vpc.publicSubnetIds[0], // Deploy in public subnet
  iamInstanceProfile: frontendProfile.name,
  userData: frontendUserData,

  tags: {
    ...commonTags,
    Name: `vision-sync-frontend-${pulumi.getStack()}`,
    Purpose: "frontend-web-server",
  },
});

// Export frontend instance details
export const frontendInstanceId = frontendInstance.id;
export const frontendInstanceIp = frontendInstance.publicIp;
export const frontendPrivateIp = frontendInstance.privateIp;
