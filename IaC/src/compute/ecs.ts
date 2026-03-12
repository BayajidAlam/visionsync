import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags, stackName, region } from "../config";
import {
  rawVideosBucket,
  processedVideosBucket,
  distribution,
} from "../storage/s3";
import { ecsLogGroup } from "../monitoring/logs";
import { ecrRepository } from "./ecr";
import { ecsExecutionRole, ecsTaskRole } from "../security/iam";
import { vpc } from "../networking/vpc";
import { alb } from "../networking/alb"; // FIX: Import ALB for webhook URL

// Create ECS Cluster
export const ecsCluster = new aws.ecs.Cluster("video-processing-cluster", {
  name: `vision-sync-processing-${stackName}`,

  settings: [
    {
      name: "containerInsights",
      value: "enabled",
    },
  ],

  tags: {
    ...commonTags,
    Purpose: "video-processing",
  },
});

// Create capacity provider association separately
new aws.ecs.ClusterCapacityProviders("cluster-capacity-providers", {
  clusterName: ecsCluster.name,
  capacityProviders: ["FARGATE", "FARGATE_SPOT"], // COST OPTIMIZATION: Added Spot support

  defaultCapacityProviderStrategies: [
    {
      capacityProvider: "FARGATE_SPOT", // COST OPTIMIZATION: Default to Spot (70% savings)
      weight: 70,
    },
    {
      capacityProvider: "FARGATE",
      weight: 30,
    },
  ],
});

// Create ECS Task Definition
export const ecsTaskDefinition = new aws.ecs.TaskDefinition(
  "video-processing-task",
  {
    family: `vision-sync-video-processing-${stackName}`,
    cpu: "2048",
    memory: "4096",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: ecsExecutionRole.arn,
    taskRoleArn: ecsTaskRole.arn,

    containerDefinitions: pulumi
      .all([
        region,
        ecsLogGroup.name,
        ecrRepository.repositoryUrl,
        rawVideosBucket.bucket,
        processedVideosBucket.bucket,
        distribution.domainName,
        alb.dnsName, // FIX: Inject ALB DNS for webhook URL
      ])
      .apply(
        ([
          reg,
          logGroupName,
          repoUrl,
          rawBucket,
          processedBucket,
          cloudfrontDomain,
          albDns, // FIX: ALB DNS for webhook
        ]) =>
          pulumi.jsonStringify([
            {
              name: "video-processor",
              image: `${repoUrl}:latest`,
              cpu: 2048,
              memory: 4096,
              essential: true,

              logConfiguration: {
                logDriver: "awslogs",
                options: {
                  "awslogs-group": logGroupName,
                  "awslogs-region": reg.name,
                  "awslogs-stream-prefix": "ecs",
                },
              },
              environment: [
                { name: "AWS_REGION", value: reg.name },
                { name: "NODE_ENV", value: "production" },
                { name: "TEMP_DIR", value: "/tmp/video-processing" },
                { name: "VIDEO_BUCKET", value: rawBucket },
                { name: "OUTPUT_BUCKET", value: processedBucket },
                // NOTE: VIDEO_FILE_NAME and VIDEO_ID are EMPTY here intentionally.
                // Lambda MUST pass these as task overrides via containerOverrides.environment
                // when calling ecs:RunTask. These are per-job values, not shared config.
                { name: "VIDEO_FILE_NAME", value: "" },
                { name: "VIDEO_ID", value: "" },
                {
                  name: "WEBHOOK_URL",
                  // FIX: Use ALB DNS — ECS containers run in VPC and cannot reach localhost
                  // Previously this was hardcoded to localhost:5000 causing silent failures
                  value: `http://${albDns}/api/webhook/processing-complete`,
                },
                { name: "CLOUDFRONT_DOMAIN", value: cloudfrontDomain },
                {
                  name: "CLOUDFRONT_URL",
                  value: `https://${cloudfrontDomain}`,
                },
                { name: "INSTANCE_TYPE", value: "spot" },
                { name: "PROCESSING_PRIORITY", value: "low" },
                { name: "ENABLE_BATCH_MODE", value: "true" },
                { name: "FFMPEG_PRESET", value: "fast" },
                { name: "FFMPEG_THREADS", value: "2" },
                { name: "MAX_PROCESSING_TIME", value: "1800" },
              ],
              healthCheck: {
                command: [
                  "CMD-SHELL",
                  "node -e \"console.log('healthy')\" || exit 1",
                ],
                interval: 30,
                timeout: 5,
                retries: 3,
                startPeriod: 60,
              },

              stopTimeout: 120,
            },
          ])
      ),

    tags: {
      ...commonTags,
      Purpose: "video-processing-task",
    },
  }
);
