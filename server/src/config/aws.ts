import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";
import { config } from "./env.js";

// Build credentials object only when explicit keys are provided (local dev).
// In production on EC2, omit credentials so SDK uses the instance profile via IMDS.
const explicitCredentials =
  config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {};

export const s3Client = new S3Client({
  region: config.AWS_REGION,
  ...explicitCredentials,
  // SDK v3.525+ defaults to "when_supported" which injects x-amz-checksum-crc32
  // into presigned URLs. Browser XHR won't send that header → S3 returns 403.
  // "when_required" disables speculative checksum injection for browser uploads.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

export const sqsClient = new SQSClient({
  region: config.AWS_REGION,
  ...explicitCredentials,
});
