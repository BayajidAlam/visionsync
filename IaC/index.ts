// Main modular infrastructure definition
// This file imports all the infrastructure modules and exports key resources

// Networking
export * from "./src/networking/vpc";
export * from "./src/networking/alb";

// Storage
export * from "./src/storage/s3";

// Database
export * from "./src/database/mongodb";
export * from "./src/database/redis";

// Messaging
export * from "./src/messaging/sqs";

// Monitoring
export * from "./src/monitoring/alarms";
export * from "./src/monitoring/logs";

// Security
export * from "./src/security/iam";

// Config
export * from "./src/config/index";

// Compute - explicit exports to avoid ubuntu AMI conflicts
export {
  bastionSg,
  bastionKey,
  bastionRole,
  bastionPolicy,
  bastionPolicyAttachment,
  bastionProfile,
  bastionInstance,
  bastionEip,
} from "./src/compute/bastion";

export * from "./src/compute/ecr";
export * from "./src/compute/ecs";
export * from "./src/compute/lambda";

// Backend - explicit exports to avoid ubuntu AMI conflicts
export {
  backendSg,
  backendKey,
  backendRole,
  backendPolicy,
  backendPolicyAttachment,
  backendProfile,
  userData,
  backendInstance,
} from "./src/backend/ec2";

// Frontend exports
export * from "./src/frontend/ec2";

// Key exports for convenience
import { bastionInstance, bastionEip } from "./src/compute/bastion";
import { backendInstance } from "./src/backend/ec2";
import { frontendInstance } from "./src/frontend/ec2";
import { albDnsName, backendUrl } from "./src/networking/alb";
import {
  mongodbInstance1,
  mongodbInstance2,
  mongodbInstance3,
} from "./src/database/mongodb";
import { redisInstance } from "./src/database/redis";

// Export important connection information
export const bastionPublicIp = bastionEip.publicIp;
export const backendPrivateIp = backendInstance.privateIp;
export const frontendPublicIp = frontendInstance.publicIp;
export const loadBalancerDnsName = albDnsName;
export const applicationUrl = backendUrl;

// Database connection info
export const mongodbNodes = {
  primary: mongodbInstance1.privateIp,
  secondary1: mongodbInstance2.privateIp,
  secondary2: mongodbInstance3.privateIp,
};

export const redisEndpoint = redisInstance.privateIp;
