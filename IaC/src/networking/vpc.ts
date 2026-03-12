import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import { commonTags } from "../config";

// Create VPC for ECS tasks - OPTIMIZED: Single NAT Gateway
export const vpc = new awsx.ec2.Vpc("vision-sync-vpc", {
  numberOfAvailabilityZones: 2,
  natGateways: {
    strategy: awsx.ec2.NatGatewayStrategy.Single, // COST OPTIMIZATION: Single NAT Gateway (saves $33/month)
  },
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: {
    ...commonTags,
    Name: "vision-sync-vpc",
  },
});
