import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags } from "../config";

// ECS Task Execution Role
export const ecsExecutionRole = new aws.iam.Role("ecs-execution-role", {
  name: `vision-sync-ecs-execution-role-${pulumi.getStack()}`,
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "ecs-tasks.amazonaws.com",
        },
      },
    ],
  }),
  tags: commonTags,
});

// Attach AWS managed policy for ECS task execution
new aws.iam.RolePolicyAttachment("ecs-execution-role-policy", {
  role: ecsExecutionRole.name,
  policyArn:
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
});

// ECS Task Role (for application permissions)
export const ecsTaskRole = new aws.iam.Role("ecs-task-role", {
  name: `vision-sync-ecs-task-role-${pulumi.getStack()}`,
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "ecs-tasks.amazonaws.com",
        },
      },
    ],
  }),
  tags: commonTags,
});

// FIX: Removed SQS permissions — ECS container only needs S3 access.
// SQS is Lambda's responsibility (trigger → launch task). ECS never touches the queue.
// FIX: Scoped S3 to specific action per bucket (raw=read, processed=write)
const ecsTaskPolicy = new aws.iam.Policy("ecs-task-policy", {
  name: `vision-sync-ecs-task-policy-${pulumi.getStack()}`,
  description:
    "Policy for ECS tasks: read from raw S3 bucket, write to processed S3 bucket",
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        // Download source video from raw bucket
        Effect: "Allow",
        Action: ["s3:GetObject"],
        Resource: "arn:aws:s3:::vision-sync-raw-videos-*/*",
      },
      {
        // Upload DASH chunks + manifest to processed bucket
        Effect: "Allow",
        Action: ["s3:PutObject"],
        Resource: "arn:aws:s3:::vision-sync-processed-videos-*/*",
      },
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        Resource: "arn:aws:logs:*:*:log-group:/aws/ecs/vision-sync-*",
      },
    ],
  }),
  tags: commonTags,
});

// Attach custom policy to ECS task role
new aws.iam.RolePolicyAttachment("ecs-task-role-policy", {
  role: ecsTaskRole.name,
  policyArn: ecsTaskPolicy.arn,
});

// Lambda Execution Role
export const lambdaExecutionRole = new aws.iam.Role("lambda-execution-role", {
  name: `vision-sync-lambda-execution-role-${pulumi.getStack()}`,
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: {
          Service: "lambda.amazonaws.com",
        },
      },
    ],
  }),
  tags: commonTags,
});

// Attach AWS managed policy for Lambda basic execution
new aws.iam.RolePolicyAttachment("lambda-basic-execution", {
  role: lambdaExecutionRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
});

// Custom policy for Lambda to access ECS and SQS
const lambdaPolicy = new aws.iam.Policy("lambda-policy", {
  name: `vision-sync-lambda-policy-${pulumi.getStack()}`,
  description: "Policy for Lambda to trigger ECS tasks and access SQS",
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        // FIX: Scoped ECS permissions — RunTask scoped to vision-sync task definitions
        // DescribeTasks/DescribeTaskDefinition still need * (they don't support resource-level)
        Effect: "Allow",
        Action: ["ecs:RunTask"],
        Resource: "arn:aws:ecs:*:*:task-definition/vision-sync-*",
      },
      {
        // ecs:TagResource required when RunTask includes tags or propagateTags
        Effect: "Allow",
        Action: ["ecs:TagResource"],
        Resource: "arn:aws:ecs:*:*:task/vision-sync-*/*",
      },
      {
        Effect: "Allow",
        Action: [
          "ecs:StopTask",
          "ecs:DescribeTasks",
          "ecs:DescribeTaskDefinition",
        ],
        Resource: "*",
      },
      {
        Effect: "Allow",
        Action: ["iam:PassRole"],
        Resource: [
          "arn:aws:iam::*:role/vision-sync-ecs-execution-role-*",
          "arn:aws:iam::*:role/vision-sync-ecs-task-role-*",
        ],
      },
      {
        Effect: "Allow",
        Action: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:SendMessage",
        ],
        Resource: "arn:aws:sqs:*:*:vision-sync-*",
      },
      {
        Effect: "Allow",
        Action: [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
        ],
        Resource: "arn:aws:logs:*:*:log-group:/aws/lambda/vision-sync-*",
      },
    ],
  }),
  tags: commonTags,
});

// Attach custom policy to Lambda role
new aws.iam.RolePolicyAttachment("lambda-role-policy", {
  role: lambdaExecutionRole.name,
  policyArn: lambdaPolicy.arn,
});
