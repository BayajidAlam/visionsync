import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

// Create a VPC
const vpc = new aws.ec2.Vpc("video-processing-vpc", {
  cidrBlock: "10.0.0.0/16",
  enableDnsSupport: true,
  enableDnsHostnames: true,
});

// Create a Subnet
const subnet = new aws.ec2.Subnet("video-processing-subnet", {
  vpcId: vpc.id,
  cidrBlock: "10.0.1.0/24",
  mapPublicIpOnLaunch: true,
  availabilityZone: "ap-southeast-1a",
});

// Create an Internet Gateway
const internetGateway = new aws.ec2.InternetGateway("video-processing-igw", {
  vpcId: vpc.id,
});

// Create a Route Table
const routeTable = new aws.ec2.RouteTable("video-processing-route-table", {
  vpcId: vpc.id,
  routes: [
    {
      cidrBlock: "0.0.0.0/0",
      gatewayId: internetGateway.id,
    },
  ],
});

// Associate Route Table with Subnet
new aws.ec2.RouteTableAssociation("video-processing-rta", {
  subnetId: subnet.id,
  routeTableId: routeTable.id,
});

// Create Security Group
const securityGroup = new aws.ec2.SecurityGroup("video-processing-sg", {
  vpcId: vpc.id,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
});

// Create S3 buckets
const rawVideosBucket = new aws.s3.Bucket("raw-videos", {
  bucket: "raw-sync-videos-bucket",
});
const processedVideosBucket = new aws.s3.Bucket("processed-videos", {
  bucket: "processed-sync-videos-bucket",
});

// Create SQS queue
const videoProcessingQueue = new aws.sqs.Queue("video-processing-queue", {
  name: "video-processing-queue",
});

// Create IAM role for ECS tasks
const ecsTaskRole = new aws.iam.Role("ecs-task-role", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "ecs-tasks.amazonaws.com" },
      },
    ],
  }),
});

new aws.iam.RolePolicyAttachment("ecs-task-s3-access", {
  role: ecsTaskRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonS3FullAccess,
});

new aws.iam.RolePolicyAttachment("ecs-task-sqs-access", {
  role: ecsTaskRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonSQSFullAccess,
});

// Create ECS cluster
const ecsCluster = new aws.ecs.Cluster("video-processing-cluster", {
  name: "video-processing-cluster",
});

// Create ECS task definition
const ecsTaskDefinition = new aws.ecs.TaskDefinition("video-processing-task", {
  family: "video-processing-task",
  cpu: "1024",
  memory: "2048",
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: ecsTaskRole.arn,
  containerDefinitions: JSON.stringify([
    {
      name: "video-processor",
      image: "jrottenberg/ffmpeg",
      memory: 1024,
      cpu: 512,
      essential: true,
      environment: [
        { name: "S3_BUCKET", value: processedVideosBucket.bucket },
        { name: "SQS_QUEUE_URL", value: videoProcessingQueue.url },
      ],
    },
  ]),
});

// Create Lambda function
const lambdaRole = new aws.iam.Role("lambda-role", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
      },
    ],
  }),
});

new aws.iam.RolePolicyAttachment("lambda-ecs-access", {
  role: lambdaRole.name,
  policyArn: aws.iam.ManagedPolicy.AmazonECSFullAccess,
});

// Create SSM parameter to store subnet ID
const subnetParam = new aws.ssm.Parameter("subnet-id", {
  name: "/video-processing/subnet-id",
  type: "String",
  value: subnet.id,
});

// Add SSM read permissions to Lambda role
const ssmPolicy = new aws.iam.Policy("lambda-ssm-policy", {
  policy: pulumi.all([subnetParam.arn]).apply(([arn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Action: "ssm:GetParameter",
          Effect: "Allow",
          Resource: arn,
        },
      ],
    })
  ),
});

new aws.iam.RolePolicyAttachment("lambda-ssm-attach", {
  role: lambdaRole.name,
  policyArn: ssmPolicy.arn,
});

const lambdaFunction = new aws.lambda.Function("trigger-ecs-task", {
  code: new pulumi.asset.AssetArchive({
    ".": new pulumi.asset.FileArchive("./lambda"),
  }),
  runtime: "nodejs14.x",
  role: lambdaRole.arn,
  handler: "index.handler",
  vpcConfig: {
    subnetIds: [subnet.id],
    securityGroupIds: [securityGroup.id],
  },
  environment: {
    variables: {
      ECS_CLUSTER: ecsCluster.name,
      ECS_TASK_DEFINITION: ecsTaskDefinition.arn,
    },
  },
});

new aws.lambda.EventSourceMapping("sqs-trigger", {
  eventSourceArn: videoProcessingQueue.arn,
  functionName: lambdaFunction.arn,
  batchSize: 1,
});

// Export resource details
export const vpcId = vpc.id;
export const subnetId = subnet.id;
export const securityGroupId = securityGroup.id;
export const rawVideosBucketName = rawVideosBucket.bucket;
export const processedVideosBucketName = processedVideosBucket.bucket;
export const videoProcessingQueueUrl = videoProcessingQueue.url;
export const ecsClusterName = ecsCluster.name;
export const ecsTaskDefinitionArn = ecsTaskDefinition.arn;
export const lambdaFunctionName = lambdaFunction.name;
