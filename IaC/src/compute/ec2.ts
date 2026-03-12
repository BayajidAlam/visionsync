import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags } from "../config";
import { vpc } from "../networking/vpc";

// This file is intentionally minimal as EC2 instances are defined in specific modules:
// - MongoDB instances: ../database/mongodb.ts
// - Redis instance: ../database/redis.ts  
// - Backend instance: ../backend/ec2.ts

// If you need additional EC2 instances, define them here
