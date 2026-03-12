import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Configuration
export const config = new pulumi.Config();
export const region = aws.getRegion();
export const caller = aws.getCallerIdentity();

// Tags for all resources
export const commonTags = {
  Project: "VisionSync",
  Environment: pulumi.getStack(),
  ManagedBy: "Pulumi",
};

// Stack configuration
export const stackName = pulumi.getStack();
