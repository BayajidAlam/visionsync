import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { commonTags, config } from "../config";
import { vpc } from "../networking/vpc";

// Get Ubuntu AMI for bastion
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

// Security group for bastion host - only SSH access from internet
export const bastionSg = new aws.ec2.SecurityGroup("bastion-sg", {
  name: `vision-sync-bastion-sg-${pulumi.getStack()}`,
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 22,
      toPort: 22,
      cidrBlocks: ["0.0.0.0/0"],
      description: "SSH access from internet",
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
    Name: "bastion-security-group",
    Purpose: "bastion-access",
  },
});

// Key pair for bastion
export const bastionKey = new aws.ec2.KeyPair("bastion-key", {
  keyName: `vision-sync-bastion-${pulumi.getStack()}`,
  publicKey: config.require("sshPublicKey"),
  tags: { ...commonTags, Purpose: "bastion-access" },
});

// IAM role for bastion host
export const bastionRole = new aws.iam.Role("bastion-role", {
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
  tags: { ...commonTags, Purpose: "bastion-role" },
});

// Basic policy for bastion - minimal permissions + ECR access
export const bastionPolicy = new aws.iam.Policy("bastion-policy", {
  name: `vision-sync-bastion-policy-${pulumi.getStack()}`,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "ec2:DescribeInstances",
          "ec2:DescribeImages",
          "ec2:DescribeKeyPairs",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSubnets",
        ],
        Resource: "*",
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
        Resource: "*",
      },
    ],
  }),
});

export const bastionPolicyAttachment = new aws.iam.RolePolicyAttachment(
  "bastion-policy-attach",
  {
    role: bastionRole.name,
    policyArn: bastionPolicy.arn,
  },
);

export const bastionProfile = new aws.iam.InstanceProfile("bastion-profile", {
  role: bastionRole.name,
});

// User data for bastion - minimal setup for jump host
export const bastionUserData = `#!/bin/bash
set -e
apt-get update
apt-get install -y python3 python3-pip awscli

# Install Ansible for orchestration
pip3 install ansible

# Create ansible user
useradd -m -s /bin/bash ansible
mkdir -p /home/ansible/.ssh
chown ansible:ansible /home/ansible/.ssh
chmod 700 /home/ansible/.ssh

# Add ansible to sudoers
echo "ansible ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Copy SSH key for ansible user (will be used to access other instances)
cp /home/ubuntu/.ssh/authorized_keys /home/ansible/.ssh/authorized_keys
chown ansible:ansible /home/ansible/.ssh/authorized_keys
chmod 600 /home/ansible/.ssh/authorized_keys

echo "Bastion host ready for SSH jump and Ansible orchestration"
`;

// Bastion EC2 instance - small instance in public subnet
export const bastionInstance = new aws.ec2.Instance("bastion-instance", {
  ami: ubuntu.then((ami) => ami.id),
  instanceType: "t3.micro", // Small instance for bastion
  keyName: bastionKey.keyName,
  vpcSecurityGroupIds: [bastionSg.id],
  subnetId: vpc.publicSubnetIds[0], // Public subnet
  iamInstanceProfile: bastionProfile.name,
  associatePublicIpAddress: true,
  userData: bastionUserData,
  tags: {
    ...commonTags,
    Name: `vision-sync-bastion-${pulumi.getStack()}`,
    Purpose: "bastion-host",
  },
});

// Elastic IP for bastion (for stable SSH access)
export const bastionEip = new aws.ec2.Eip("bastion-eip", {
  instance: bastionInstance.id,
  domain: "vpc",
  tags: { ...commonTags, Purpose: "bastion-eip" },
});
