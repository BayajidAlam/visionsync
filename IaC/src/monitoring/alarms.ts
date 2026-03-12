import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { commonTags } from "../config";
import { lambdaWithDependency } from "../compute/lambda";
import { videoProcessingQueue } from "../messaging/sqs";

// CloudWatch Alarms for monitoring
export const lambdaErrorAlarm = new aws.cloudwatch.MetricAlarm("lambda-error-alarm", {
  name: `vision-sync-lambda-errors-${pulumi.getStack()}`,
  alarmDescription: "Lambda function error rate is too high",

  metricName: "Errors",
  namespace: "AWS/Lambda",
  statistic: "Sum",
  period: 300,
  evaluationPeriods: 2,
  threshold: 5,
  comparisonOperator: "GreaterThanThreshold",

  dimensions: {
    FunctionName: lambdaWithDependency.name,
  },

  tags: {
    ...commonTags,
    Purpose: "monitoring",
  },
});

export const sqsQueueDepthAlarm = new aws.cloudwatch.MetricAlarm(
  "sqs-queue-depth-alarm",
  {
    name: `vision-sync-sqs-depth-${pulumi.getStack()}`,
    alarmDescription: "SQS queue depth is too high",

    metricName: "ApproximateNumberOfVisibleMessages",
    namespace: "AWS/SQS",
    statistic: "Average",
    period: 300,
    evaluationPeriods: 3,
    threshold: 10,
    comparisonOperator: "GreaterThanThreshold",

    dimensions: {
      QueueName: videoProcessingQueue.name,
    },

    tags: {
      ...commonTags,
      Purpose: "monitoring",
    },
  }
);
