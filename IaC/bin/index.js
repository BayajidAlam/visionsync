"use strict";
// Main modular infrastructure definition
// This file imports all the infrastructure modules and exports key resources
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisEndpoint = exports.mongodbNodes = exports.applicationUrl = exports.loadBalancerDnsName = exports.backendPrivateIp = exports.bastionPublicIp = exports.backendEip = exports.backendInstance = exports.userData = exports.backendProfile = exports.backendPolicyAttachment = exports.backendPolicy = exports.backendRole = exports.backendKey = exports.backendSg = exports.bastionEip = exports.bastionInstance = exports.bastionProfile = exports.bastionPolicyAttachment = exports.bastionPolicy = exports.bastionRole = exports.bastionKey = exports.bastionSg = void 0;
// Networking
__exportStar(require("./networking/vpc"), exports);
__exportStar(require("./networking/alb"), exports);
// Storage
__exportStar(require("./storage/s3"), exports);
// Database
__exportStar(require("./database/mongodb"), exports);
__exportStar(require("./database/redis"), exports);
// Messaging
__exportStar(require("./messaging/sqs"), exports);
// Monitoring
__exportStar(require("./monitoring/alarms"), exports);
__exportStar(require("./monitoring/logs"), exports);
// Security
__exportStar(require("./security/iam"), exports);
// Config
__exportStar(require("./config/index"), exports);
// Compute - explicit exports to avoid ubuntu AMI conflicts
var bastion_1 = require("./compute/bastion");
Object.defineProperty(exports, "bastionSg", { enumerable: true, get: function () { return bastion_1.bastionSg; } });
Object.defineProperty(exports, "bastionKey", { enumerable: true, get: function () { return bastion_1.bastionKey; } });
Object.defineProperty(exports, "bastionRole", { enumerable: true, get: function () { return bastion_1.bastionRole; } });
Object.defineProperty(exports, "bastionPolicy", { enumerable: true, get: function () { return bastion_1.bastionPolicy; } });
Object.defineProperty(exports, "bastionPolicyAttachment", { enumerable: true, get: function () { return bastion_1.bastionPolicyAttachment; } });
Object.defineProperty(exports, "bastionProfile", { enumerable: true, get: function () { return bastion_1.bastionProfile; } });
Object.defineProperty(exports, "bastionInstance", { enumerable: true, get: function () { return bastion_1.bastionInstance; } });
Object.defineProperty(exports, "bastionEip", { enumerable: true, get: function () { return bastion_1.bastionEip; } });
__exportStar(require("./compute/ecr"), exports);
__exportStar(require("./compute/ecs"), exports);
__exportStar(require("./compute/lambda"), exports);
// Backend - explicit exports to avoid ubuntu AMI conflicts
var ec2_1 = require("./backend/ec2");
Object.defineProperty(exports, "backendSg", { enumerable: true, get: function () { return ec2_1.backendSg; } });
Object.defineProperty(exports, "backendKey", { enumerable: true, get: function () { return ec2_1.backendKey; } });
Object.defineProperty(exports, "backendRole", { enumerable: true, get: function () { return ec2_1.backendRole; } });
Object.defineProperty(exports, "backendPolicy", { enumerable: true, get: function () { return ec2_1.backendPolicy; } });
Object.defineProperty(exports, "backendPolicyAttachment", { enumerable: true, get: function () { return ec2_1.backendPolicyAttachment; } });
Object.defineProperty(exports, "backendProfile", { enumerable: true, get: function () { return ec2_1.backendProfile; } });
Object.defineProperty(exports, "userData", { enumerable: true, get: function () { return ec2_1.userData; } });
Object.defineProperty(exports, "backendInstance", { enumerable: true, get: function () { return ec2_1.backendInstance; } });
Object.defineProperty(exports, "backendEip", { enumerable: true, get: function () { return ec2_1.backendEip; } });
// Key exports for convenience
const bastion_2 = require("./compute/bastion");
const ec2_2 = require("./backend/ec2");
const alb_1 = require("./networking/alb");
const mongodb_1 = require("./database/mongodb");
const redis_1 = require("./database/redis");
// Export important connection information
exports.bastionPublicIp = bastion_2.bastionEip.publicIp;
exports.backendPrivateIp = ec2_2.backendInstance.privateIp;
exports.loadBalancerDnsName = alb_1.albDnsName;
exports.applicationUrl = alb_1.backendUrl;
// Database connection info
exports.mongodbNodes = {
    primary: mongodb_1.mongodbInstance1.privateIp,
    secondary1: mongodb_1.mongodbInstance2.privateIp,
    secondary2: mongodb_1.mongodbInstance3.privateIp,
};
exports.redisEndpoint = redis_1.redisInstance.privateIp;
