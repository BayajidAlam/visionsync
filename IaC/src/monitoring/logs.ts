import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags } from "../config";

// CloudWatch Log Group for ECS
export const ecsLogGroup = new aws.cloudwatch.LogGroup("ecs-log-group", {
  name: `/aws/ecs/vision-sync-${pulumi.getStack()}`,
  retentionInDays: 7, // 7 days retention
  tags: {
    ...commonTags,
    Purpose: "ecs-logging",
  },
});

// CloudWatch Log Group for Lambda
export const lambdaLogGroup = new aws.cloudwatch.LogGroup("lambda-log-group", {
  name: `/aws/lambda/vision-sync-${pulumi.getStack()}`,
  retentionInDays: 14, // 14 days retention
  tags: {
    ...commonTags,
    Purpose: "lambda-logging",
  },
});

// CloudWatch Log Group for Application
export const appLogGroup = new aws.cloudwatch.LogGroup("app-log-group", {
  name: `/aws/application/vision-sync-${pulumi.getStack()}`,
  retentionInDays: 30, // 30 days retention for application logs
  tags: {
    ...commonTags,
    Purpose: "application-logging",
  },
});
