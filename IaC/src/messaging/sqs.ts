import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags } from "../config";
import { rawVideosBucket } from "../storage/s3"; // For S3 Event Notification

// Create SQS Dead Letter Queue
export const videoProcessingDLQ = new aws.sqs.Queue("video-processing-dlq", {
  name: `vision-sync-video-processing-dlq-${pulumi.getStack()}`,
  messageRetentionSeconds: 1209600, // 14 days
  tags: {
    ...commonTags,
    Purpose: "video-processing-dlq",
  },
});

// Create SQS queue for video processing
export const videoProcessingQueue = new aws.sqs.Queue(
  "video-processing-queue",
  {
    name: `vision-sync-video-processing-${pulumi.getStack()}`,
    visibilityTimeoutSeconds: 960, // 16 minutes (longer than Lambda timeout)
    messageRetentionSeconds: 1209600, // 14 days
    receiveWaitTimeSeconds: 20, // Enable long polling

    redrivePolicy: pulumi.jsonStringify({
      deadLetterTargetArn: videoProcessingDLQ.arn,
      maxReceiveCount: 3,
    }),

    tags: {
      ...commonTags,
      Purpose: "video-processing-queue",
    },
  }
);

// FIX: SQS queue policy allowing S3 to SendMessage via Event Notification.
// Without this policy, S3 Event Notifications are silently dropped by SQS
// and Lambda never fires — the entire processing pipeline stalls.
new aws.sqs.QueuePolicy("video-processing-queue-policy", {
  queueUrl: videoProcessingQueue.url,
  policy: pulumi.all([videoProcessingQueue.arn, rawVideosBucket.arn]).apply(
    ([queueArn, bucketArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowS3EventNotification",
            Effect: "Allow",
            Principal: {
              Service: "s3.amazonaws.com",
            },
            Action: "sqs:SendMessage",
            Resource: queueArn,
            Condition: {
              ArnLike: {
                // Scope to exactly the raw bucket — no other S3 bucket can send
                "aws:SourceArn": bucketArn,
              },
            },
          },
        ],
      })
  ),
});

// FIX: S3 Event Notification — wire raw bucket uploads to SQS automatically.
// This is the blog-approach trigger: S3 → SQS (no client confirm step needed).
// Fires on any ObjectCreated event under the videos/ prefix in the raw bucket.
new aws.s3.BucketNotification("raw-videos-notification", {
  bucket: rawVideosBucket.id,
  queues: [
    {
      queueArn: videoProcessingQueue.arn,
      events: ["s3:ObjectCreated:*"], // Triggers on Put, Post, Copy, MultipartUpload
      filterPrefix: "videos/",        // Only process uploads to the videos/ prefix
    },
  ],
});

