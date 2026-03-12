import {
  ECSClient,
  RunTaskCommand,
  AssignPublicIp,
  PropagateTags,
} from "@aws-sdk/client-ecs";
import { SQSHandler, SQSEvent, SQSRecord, Context } from "aws-lambda";

// FIX: S3 Event Notification sends a different structure than a custom message.
// When S3 triggers SQS, the record.body is an S3 event, not a VideoMessage.
interface S3EventRecord {
  s3: {
    bucket: { name: string };
    object: { key: string; size: number };
  };
}

interface VideoMessage {
  videoId: string;
  bucketName: string;
  fileName: string;
  originalFileName: string;
  fileSize: number;
  uploadedBy: string;
  timestamp: string;
  messageId?: string;
}

interface ProcessingResult {
  messageId: string;
  videoId?: string;
  taskArn?: string;
  status: "started" | "failed";
  error?: string;
}

const ecs = new ECSClient({
  region: process.env.AWS_REGION || "ap-southeast-1",
});

const validateEnvironment = (): void => {
  const required = [
    "ECS_CLUSTER",
    "ECS_TASK_DEFINITION",
    "SUBNET_IDS",
    "SECURITY_GROUP_ID",
    "PROCESSED_BUCKET",
    "AWS_REGION",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }
};

// FIX: S3 Event Notifications wrap their payload differently from direct SQS messages.
// S3 sends: { "Records": [{ "s3": { "bucket": {...}, "object": {...} } }] }
// We extract videoId from the object key path: "videos/<videoId>/<filename>"
const parseMessage = (record: SQSRecord): VideoMessage => {
  try {
    const body = JSON.parse(record.body);

    // S3 Event Notification format (our approach)
    if (body.Records && body.Records[0]?.s3) {
      const s3Record: S3EventRecord = body.Records[0];
      const bucketName = s3Record.s3.bucket.name;
      const key = s3Record.s3.object.key; // "videos/<videoId>/<filename>"
      const fileSize = s3Record.s3.object.size;

      const keyParts = key.split("/");
      if (keyParts.length < 3 || keyParts[0] !== "videos") {
        throw new Error(
          `Unexpected S3 key format: ${key}. Expected: videos/<videoId>/<filename>`,
        );
      }

      const videoId = keyParts[1];
      const fileName = key; // full S3 key used as filename for the container

      return {
        videoId,
        bucketName,
        fileName,
        originalFileName: keyParts[2],
        fileSize,
        uploadedBy: "s3-event-notification",
        timestamp: new Date().toISOString(),
      };
    }

    // Legacy direct SQS message format (kept for backwards compatibility)
    const message = body as VideoMessage;
    if (!message.videoId || !message.bucketName || !message.fileName) {
      throw new Error(
        "Missing required message fields: videoId, bucketName, fileName",
      );
    }
    return message;
  } catch (error) {
    throw new Error(
      `Invalid message format: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }
};

// COST OPTIMIZATION: Choose between Spot and regular Fargate based on priority
const shouldUseSpot = (message: VideoMessage): boolean => {
  const useSpot = process.env.USE_FARGATE_SPOT === "true";
  const spotPercentage = parseInt(process.env.SPOT_PERCENTAGE || "70");

  if (!useSpot) return false;

  // Use Spot for most tasks (based on percentage)
  // Use regular Fargate for urgent/large files
  const isUrgent = message.fileSize > 1024 * 1024 * 1024; // Files > 1GB
  const randomPercent = Math.random() * 100;

  return !isUrgent && randomPercent < spotPercentage;
};

const startECSTask = async (message: VideoMessage): Promise<string> => {
  const useSpot = shouldUseSpot(message);

  // COST OPTIMIZATION: Configure capacity provider based on priority
  const capacityProviderStrategy = useSpot
    ? [
        {
          capacityProvider: "FARGATE_SPOT",
          weight: 1,
          base: 0,
        },
      ]
    : [
        {
          capacityProvider: "FARGATE",
          weight: 1,
          base: 0,
        },
      ];

  const taskParams = {
    cluster: process.env.ECS_CLUSTER!,
    taskDefinition: process.env.ECS_TASK_DEFINITION!,

    // COST OPTIMIZATION: Use capacity provider strategy for Spot instances
    capacityProviderStrategy,

    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: process.env.SUBNET_IDS!.split(","),
        securityGroups: [process.env.SECURITY_GROUP_ID!],
        // FIX: DISABLED — ECS tasks run in private subnets behind NAT Gateway.
        // Assigning public IPs exposes the FFmpeg container directly to the internet.
        assignPublicIp: AssignPublicIp.DISABLED,
      },
    },

    overrides: {
      containerOverrides: [
        {
          name: "video-processor",
          environment: [
            { name: "VIDEO_BUCKET", value: message.bucketName },
            { name: "VIDEO_FILE_NAME", value: message.fileName },
            { name: "VIDEO_ID", value: message.videoId },
            { name: "OUTPUT_BUCKET", value: process.env.PROCESSED_BUCKET! },
            // NOTE: WEBHOOK_URL is NOT overridden here — the ECS task definition
            // already has the correct http://ALB/api/webhook/processing-complete value.
            // Overriding with process.env.WEBHOOK_URL would set it to "" (empty)
            // because Lambda's environment doesn't have WEBHOOK_URL set, silently
            // causing the container to skip the webhook and leaving video at "uploaded".
            {
              name: "AWS_REGION",
              value: process.env.AWS_REGION || "ap-southeast-1",
            },

            // COST OPTIMIZATION: FFmpeg settings based on instance type
            { name: "FFMPEG_PRESET", value: useSpot ? "medium" : "fast" },
            { name: "FFMPEG_THREADS", value: useSpot ? "1" : "2" },
            { name: "PROCESSING_PRIORITY", value: useSpot ? "low" : "normal" },
            { name: "INSTANCE_TYPE", value: useSpot ? "spot" : "on-demand" },

            // COST OPTIMIZATION: Batch processing for Spot instances
            { name: "ENABLE_BATCH_MODE", value: useSpot ? "true" : "false" },
            { name: "MAX_PROCESSING_TIME", value: useSpot ? "3600" : "1800" }, // 1 hour vs 30 min
          ],
        },
      ],
    },

    tags: [
      { key: "VideoId", value: message.videoId },
      { key: "Purpose", value: "VideoProcessing" },
      { key: "InstanceType", value: useSpot ? "spot" : "on-demand" },
      { key: "CostOptimized", value: "true" },
      { key: "Timestamp", value: new Date().toISOString() },
    ],

    // COST OPTIMIZATION: Set appropriate timeouts
    propagateTags: PropagateTags.TASK_DEFINITION,
  };

  console.log("Starting ECS task:", {
    cluster: taskParams.cluster,
    taskDefinition: taskParams.taskDefinition,
    videoId: message.videoId,
    useSpot,
    capacityProvider: useSpot ? "FARGATE_SPOT" : "FARGATE",
    estimatedCostSavings: useSpot ? "70%" : "0%",
  });

  try {
    const result = await ecs.send(new RunTaskCommand(taskParams));

    if (result.failures && result.failures.length > 0) {
      const failure = result.failures[0];

      // COST OPTIMIZATION: Retry with regular Fargate if Spot fails
      if (useSpot && failure.reason?.includes("RESOURCE")) {
        console.log("Spot capacity unavailable, retrying with regular Fargate");

        // Retry with regular Fargate
        const retryParams = {
          ...taskParams,
          capacityProviderStrategy: [
            {
              capacityProvider: "FARGATE",
              weight: 1,
              base: 0,
            },
          ],
        };

        // Update environment to reflect fallback
        if (retryParams.overrides?.containerOverrides?.[0]?.environment) {
          const env = retryParams.overrides.containerOverrides[0].environment;
          const instanceTypeEnv = env.find((e) => e.name === "INSTANCE_TYPE");
          if (instanceTypeEnv) {
            instanceTypeEnv.value = "on-demand-fallback";
          }
        }

        const retryResult = await ecs.send(new RunTaskCommand(retryParams));

        if (retryResult.failures && retryResult.failures.length > 0) {
          throw new Error(
            `ECS task failed on retry: ${retryResult.failures[0].reason}`,
          );
        }

        if (!retryResult.tasks || retryResult.tasks.length === 0) {
          throw new Error("No ECS tasks were started on retry");
        }

        const taskArn = retryResult.tasks[0].taskArn;
        if (!taskArn) {
          throw new Error("ECS task started on retry but no ARN returned");
        }

        console.log(
          `ECS task started successfully on Fargate fallback: ${taskArn}`,
        );
        return taskArn;
      }

      throw new Error(
        `ECS task failed: ${failure.reason} - ${failure.detail || ""}`,
      );
    }

    if (!result.tasks || result.tasks.length === 0) {
      throw new Error("No ECS tasks were started");
    }

    const taskArn = result.tasks[0].taskArn;
    if (!taskArn) {
      throw new Error("ECS task started but no ARN returned");
    }

    console.log(`ECS task started successfully: ${taskArn}`);
    console.log(
      `Cost savings: ${useSpot ? "~70%" : "0%"} compared to regular Fargate`,
    );
    return taskArn;
  } catch (error) {
    console.error("ECS task execution error:", error);
    throw error;
  }
};

const processRecord = async (record: SQSRecord): Promise<ProcessingResult> => {
  try {
    console.log(`Processing SQS record: ${record.messageId}`);

    const message = parseMessage(record);
    console.log("Video processing request:", {
      videoId: message.videoId,
      bucketName: message.bucketName,
      fileName: message.fileName,
      fileSize: message.fileSize,
      timestamp: message.timestamp,
      willUseSpot: shouldUseSpot(message),
    });

    const taskArn = await startECSTask(message);

    return {
      messageId: record.messageId,
      videoId: message.videoId,
      taskArn,
      status: "started",
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing SQS message:", {
      messageId: record.messageId,
      error: errorMessage,
    });

    return {
      messageId: record.messageId,
      status: "failed",
      error: errorMessage,
    };
  }
};

export const handler: SQSHandler = async (
  event: SQSEvent,
  context: Context,
): Promise<void> => {
  console.log("Lambda function started:", {
    requestId: context.awsRequestId,
    remainingTimeInMillis: context.getRemainingTimeInMillis(),
    recordCount: event.Records.length,
    spotEnabled: process.env.USE_FARGATE_SPOT === "true",
    spotPercentage: process.env.SPOT_PERCENTAGE || "70",
  });

  try {
    validateEnvironment();

    const results: ProcessingResult[] = [];
    let hasFailures = false;

    // Process records sequentially to avoid overwhelming ECS
    for (const record of event.Records) {
      const result = await processRecord(record);
      results.push(result);

      if (result.status === "failed") {
        hasFailures = true;
      }
    }

    // Calculate cost savings summary
    const spotTasks = results.filter((r) => r.status === "started").length;
    const estimatedSavings = spotTasks * 0.7; // 70% savings per Spot task

    console.log("Lambda execution completed:", {
      totalMessages: event.Records.length,
      successful: results.filter((r) => r.status === "started").length,
      failed: results.filter((r) => r.status === "failed").length,
      estimatedMonthlySavings: `${(estimatedSavings * 0.2).toFixed(2)}`, // Rough estimate
      results,
    });

    // If any record failed, throw error to trigger SQS retry
    if (hasFailures) {
      const failedResults = results.filter((r) => r.status === "failed");
      throw new Error(
        `Failed to process ${failedResults.length} message(s): ${failedResults
          .map((r) => r.error)
          .join(", ")}`,
      );
    }

    return;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Lambda execution failed:", {
      error: errorMessage,
      requestId: context.awsRequestId,
    });

    throw error;
  }
};
