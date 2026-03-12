import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { commonTags, region } from "../config";
import { lambdaExecutionRole } from "../security/iam";
import { videoProcessingQueue, videoProcessingDLQ } from "../messaging/sqs";
import { lambdaLogGroup } from "../monitoring/logs";
import { ecsCluster, ecsTaskDefinition } from "./ecs";
import { vpc } from "../networking/vpc";
import { processedVideosBucket } from "../storage/s3";

// FIX: Dedicated security group for Lambda — never use the default VPC security group.
// Default SG has permissive rules that apply to all VPC resources.
// Lambda only needs HTTPS egress to call AWS APIs (ECS, SQS, CloudWatch).
// This SG is used for ECS tasks launched by Lambda (not for Lambda itself —
// Lambda runs outside VPC and needs no SG for AWS API calls).
export const lambdaSg = new aws.ec2.SecurityGroup("lambda-sg", {
  name: `vision-sync-lambda-sg-${pulumi.getStack()}`,
  description:
    "Security group for ECS video-processor tasks launched by Lambda",
  vpcId: vpc.vpcId,
  ingress: [], // No inbound — tasks pull work from S3, results pushed outbound
  egress: [
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["0.0.0.0/0"],
      description: "HTTPS to S3, ECR, CloudWatch, SQS (via NAT gateway)",
    },
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description:
        "HTTP to ALB for webhook POST /api/webhook/processing-complete",
    },
  ],
  tags: {
    ...commonTags,
    Name: "ecs-task-security-group",
    Purpose: "ecs-task-egress",
  },
});

// Create Lambda function - OPTIMIZED: Reduced timeout
export const lambdaWithDependency = new aws.lambda.Function(
  "ecs-task-trigger-with-deps",
  {
    name: `vision-sync-ecs-trigger-${pulumi.getStack()}`,
    runtime: "nodejs18.x",

    // Reference the built Lambda code from the lambda directory
    code: new pulumi.asset.AssetArchive({
      ".": new pulumi.asset.FileArchive("../lambda/dist"),
      node_modules: new pulumi.asset.FileArchive("../lambda/node_modules"),
    }),

    handler: "index.handler",
    role: lambdaExecutionRole.arn,
    timeout: 60, // COST OPTIMIZATION: Reduced from 900 to 60 seconds
    memorySize: 256,

    environment: {
      variables: pulumi
        .all([
          ecsCluster.name,
          ecsTaskDefinition.arn,
          vpc.privateSubnetIds,
          lambdaSg.id, // FIX: Use dedicated Lambda SG instead of default VPC SG
          processedVideosBucket.bucket,
          region,
        ])
        .apply(([clusterName, taskDefArn, subnetIds, sgId, bucket, reg]) => ({
          ECS_CLUSTER: clusterName,
          ECS_TASK_DEFINITION: taskDefArn,
          SUBNET_IDS: subnetIds.join(","),
          SECURITY_GROUP_ID: sgId,
          PROCESSED_BUCKET: bucket,
          REGION: reg.name,
        })),
    },

    deadLetterConfig: {
      targetArn: videoProcessingDLQ.arn,
    },

    tags: {
      ...commonTags,
      Purpose: "video-processing-trigger",
    },
  },
  { dependsOn: [lambdaLogGroup] },
);

// Create SQS trigger for Lambda
export const sqsEventSourceMapping = new aws.lambda.EventSourceMapping(
  "sqs-lambda-trigger",
  {
    eventSourceArn: videoProcessingQueue.arn,
    functionName: lambdaWithDependency.name,
    batchSize: 1,
    maximumBatchingWindowInSeconds: 5,

    functionResponseTypes: ["ReportBatchItemFailures"],
  },
);

// Grant SQS permission to invoke Lambda
export const sqsInvokeLambdaPermission = new aws.lambda.Permission(
  "sqs-invoke-lambda",
  {
    action: "lambda:InvokeFunction",
    function: lambdaWithDependency.name,
    principal: "sqs.amazonaws.com",
    sourceArn: videoProcessingQueue.arn,
  },
);
