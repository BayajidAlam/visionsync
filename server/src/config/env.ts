import dotenv from "dotenv";

dotenv.config();

interface Config {
  PORT: number;
  NODE_ENV: string;

  // AWS Configuration
  AWS_REGION: string;
  AWS_ACCESS_KEY_ID?: string; // Optional — use EC2 instance profile when not set
  AWS_SECRET_ACCESS_KEY?: string; // Optional — use EC2 instance profile when not set

  // S3 Configuration
  S3_BUCKET_RAW: string;
  S3_BUCKET_PROCESSED: string;

  // COST OPTIMIZATION: S3 Lifecycle Settings
  S3_LIFECYCLE_ENABLED: boolean;
  S3_INTELLIGENT_TIERING: boolean;
  S3_RAW_VIDEO_RETENTION_DAYS: number;
  S3_GLACIER_TRANSITION_DAYS: number;
  S3_DEEP_ARCHIVE_TRANSITION_DAYS: number;

  // SQS Configuration
  SQS_QUEUE_URL: string;

  // MongoDB Configuration
  MONGODB_URI: string;

  // Redis Configuration (NEW - for caching and rate limiting)
  REDIS_URL: string;
  REDIS_HOST: string;
  REDIS_PORT: number;
  REDIS_PASSWORD?: string;
  REDIS_TLS: boolean;
  REDIS_CLUSTER_MODE: boolean;

  // COST OPTIMIZATION: MongoDB Settings
  MONGODB_CONNECTION_POOL_SIZE: number;
  MONGODB_MAX_IDLE_TIME: number;
  MONGODB_SERVER_SELECTION_TIMEOUT: number;

  // CloudFront Configuration
  CLOUDFRONT_DISTRIBUTION_ID?: string;
  CLOUDFRONT_DOMAIN?: string;

  // COST OPTIMIZATION: CloudFront Settings
  CLOUDFRONT_PRICE_CLASS: string;
  CLOUDFRONT_DEFAULT_TTL: number;
  CLOUDFRONT_MAX_TTL: number;
  CLOUDFRONT_COMPRESSION_ENABLED: boolean;

  // ECS Configuration
  ECS_CLUSTER_NAME?: string;
  ECS_TASK_DEFINITION?: string;

  // COST OPTIMIZATION: ECS Settings
  ECS_USE_FARGATE_SPOT: boolean;
  ECS_SPOT_PERCENTAGE: number;
  ECS_TASK_CPU: number;
  ECS_TASK_MEMORY: number;
  ECS_MAX_PROCESSING_TIME: number;

  // Video Processing
  FFMPEG_PRESET: string;
  FFMPEG_THREADS: number;
  PROCESSING_PRIORITY: string;
  ENABLE_BATCH_PROCESSING: boolean;

  // Rate Limiting (Memory-based)
  RATE_LIMIT_WINDOW_MS: number;
  RATE_LIMIT_MAX_REQUESTS: number;
  UPLOAD_RATE_LIMIT_MAX: number;
  RATE_LIMIT_STORE: string;

  // Proxy / trust settings
  TRUST_PROXY: boolean;

  // CORS Configuration
  FRONTEND_URL: string;

  // Monitoring
  LOG_LEVEL: string;
  LOG_RETENTION_DAYS: number;
  METRICS_ENABLED: boolean;
  DETAILED_MONITORING: boolean;

  // COST OPTIMIZATION: Feature Flags
  ENABLE_ANALYTICS: boolean;
  ENABLE_DETAILED_LOGGING: boolean;
  ENABLE_PERFORMANCE_MONITORING: boolean;
  ENABLE_COST_TRACKING: boolean;
}

function validateEnv(): Config {
  const requiredVars = [
    "AWS_REGION",
    // AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are optional — EC2 instance profile used when absent
    "S3_BUCKET_RAW",
    "S3_BUCKET_PROCESSED",
    "SQS_QUEUE_URL",
    "MONGODB_URI",
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`,
    );
  }

  return {
    PORT: parseInt(process.env.PORT || "5000"),
    NODE_ENV: process.env.NODE_ENV || "development",

    // AWS Configuration
    AWS_REGION: process.env.AWS_REGION!,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,

    // S3 Configuration
    S3_BUCKET_RAW: process.env.S3_BUCKET_RAW!,
    S3_BUCKET_PROCESSED: process.env.S3_BUCKET_PROCESSED!,

    // COST OPTIMIZATION: S3 Lifecycle Settings
    S3_LIFECYCLE_ENABLED: process.env.S3_LIFECYCLE_ENABLED === "true",
    S3_INTELLIGENT_TIERING: process.env.S3_INTELLIGENT_TIERING === "true",
    S3_RAW_VIDEO_RETENTION_DAYS: parseInt(
      process.env.S3_RAW_VIDEO_RETENTION_DAYS || "30",
    ),
    S3_GLACIER_TRANSITION_DAYS: parseInt(
      process.env.S3_GLACIER_TRANSITION_DAYS || "90",
    ),
    S3_DEEP_ARCHIVE_TRANSITION_DAYS: parseInt(
      process.env.S3_DEEP_ARCHIVE_TRANSITION_DAYS || "365",
    ),

    // SQS Configuration
    SQS_QUEUE_URL: process.env.SQS_QUEUE_URL!,

    // MongoDB Configuration
    MONGODB_URI: process.env.MONGODB_URI!,

    // Redis Configuration (NEW - for caching and rate limiting)
    REDIS_URL:
      process.env.REDIS_URL || process.env.REDIS_CONNECTION_STRING || "",
    REDIS_HOST: process.env.REDIS_HOST || "localhost",
    REDIS_PORT: parseInt(process.env.REDIS_PORT || "6379"),
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,
    REDIS_TLS: process.env.REDIS_TLS === "true",
    REDIS_CLUSTER_MODE: process.env.REDIS_CLUSTER_MODE === "true",

    // COST OPTIMIZATION: MongoDB Settings
    MONGODB_CONNECTION_POOL_SIZE: parseInt(
      process.env.MONGODB_CONNECTION_POOL_SIZE || "5",
    ),
    MONGODB_MAX_IDLE_TIME: parseInt(
      process.env.MONGODB_MAX_IDLE_TIME || "30000",
    ),
    MONGODB_SERVER_SELECTION_TIMEOUT: parseInt(
      process.env.MONGODB_SERVER_SELECTION_TIMEOUT || "5000",
    ),

    // CloudFront Configuration
    CLOUDFRONT_DISTRIBUTION_ID: process.env.CLOUDFRONT_DISTRIBUTION_ID,
    CLOUDFRONT_DOMAIN: process.env.CLOUDFRONT_DOMAIN,

    // COST OPTIMIZATION: CloudFront Settings
    CLOUDFRONT_PRICE_CLASS:
      process.env.CLOUDFRONT_PRICE_CLASS || "PriceClass_100",
    CLOUDFRONT_DEFAULT_TTL: parseInt(
      process.env.CLOUDFRONT_DEFAULT_TTL || "86400",
    ),
    CLOUDFRONT_MAX_TTL: parseInt(process.env.CLOUDFRONT_MAX_TTL || "31536000"),
    CLOUDFRONT_COMPRESSION_ENABLED:
      process.env.CLOUDFRONT_COMPRESSION_ENABLED !== "false",

    // ECS Configuration
    ECS_CLUSTER_NAME: process.env.ECS_CLUSTER_NAME,
    ECS_TASK_DEFINITION: process.env.ECS_TASK_DEFINITION,

    // COST OPTIMIZATION: ECS Settings
    ECS_USE_FARGATE_SPOT: process.env.ECS_USE_FARGATE_SPOT === "true",
    ECS_SPOT_PERCENTAGE: parseInt(process.env.ECS_SPOT_PERCENTAGE || "70"),
    ECS_TASK_CPU: parseInt(process.env.ECS_TASK_CPU || "1024"),
    ECS_TASK_MEMORY: parseInt(process.env.ECS_TASK_MEMORY || "2048"),
    ECS_MAX_PROCESSING_TIME: parseInt(
      process.env.ECS_MAX_PROCESSING_TIME || "3600",
    ),

    // Video Processing
    FFMPEG_PRESET: process.env.FFMPEG_PRESET || "fast",
    FFMPEG_THREADS: parseInt(process.env.FFMPEG_THREADS || "2"),
    PROCESSING_PRIORITY: process.env.PROCESSING_PRIORITY || "normal",
    ENABLE_BATCH_PROCESSING: process.env.ENABLE_BATCH_PROCESSING === "true",

    // Rate Limiting (Redis-based for production, memory for development)
    RATE_LIMIT_WINDOW_MS: parseInt(
      process.env.RATE_LIMIT_WINDOW_MS || "900000",
    ), // 15 minutes
    RATE_LIMIT_MAX_REQUESTS: parseInt(
      process.env.RATE_LIMIT_MAX_REQUESTS || "100",
    ),
    UPLOAD_RATE_LIMIT_MAX: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX || "5"),
    RATE_LIMIT_STORE:
      process.env.RATE_LIMIT_STORE ||
      (process.env.NODE_ENV === "production" ? "redis" : "memory"),

    // Proxy / trust settings
    TRUST_PROXY: process.env.TRUST_PROXY === "true",

    // CORS Configuration
    FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",

    // Monitoring
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    LOG_RETENTION_DAYS: parseInt(process.env.LOG_RETENTION_DAYS || "7"),
    METRICS_ENABLED: process.env.METRICS_ENABLED === "true",
    DETAILED_MONITORING: process.env.DETAILED_MONITORING === "true",

    // COST OPTIMIZATION: Feature Flags
    ENABLE_ANALYTICS: process.env.ENABLE_ANALYTICS === "true",
    ENABLE_DETAILED_LOGGING: process.env.ENABLE_DETAILED_LOGGING === "true",
    ENABLE_PERFORMANCE_MONITORING:
      process.env.ENABLE_PERFORMANCE_MONITORING === "true",
    ENABLE_COST_TRACKING: process.env.ENABLE_COST_TRACKING !== "false", // Default enabled
  };
}

export const config = validateEnv();

// COST OPTIMIZATION: Export cost tracking utilities
export const getCostOptimizationStatus = () => {
  return {
    s3LifecycleEnabled: config.S3_LIFECYCLE_ENABLED,
    intelligentTieringEnabled: config.S3_INTELLIGENT_TIERING,
    fargateSpotEnabled: config.ECS_USE_FARGATE_SPOT,
    cloudFrontPriceClass: config.CLOUDFRONT_PRICE_CLASS,
    rateLimitStore: config.RATE_LIMIT_STORE,
    estimatedMonthlySavings: calculateEstimatedSavings(),
    optimizationsActive: getActiveOptimizations(),
  };
};

const calculateEstimatedSavings = (): string => {
  let savings = 0;

  // S3 Lifecycle savings
  if (config.S3_LIFECYCLE_ENABLED) savings += 85;

  // Fargate Spot savings
  if (config.ECS_USE_FARGATE_SPOT) savings += 108;

  // CloudFront price class savings
  if (config.CLOUDFRONT_PRICE_CLASS === "PriceClass_100") savings += 64;

  // Memory-based rate limiting savings
  if (config.RATE_LIMIT_STORE === "memory") savings += 32;

  return `$${savings}/month`;
};

const getActiveOptimizations = (): string[] => {
  const optimizations: string[] = [];

  if (config.S3_LIFECYCLE_ENABLED) optimizations.push("S3 Lifecycle Policies");
  if (config.S3_INTELLIGENT_TIERING)
    optimizations.push("S3 Intelligent Tiering");
  if (config.ECS_USE_FARGATE_SPOT) optimizations.push("Fargate Spot Instances");
  if (config.CLOUDFRONT_PRICE_CLASS === "PriceClass_100")
    optimizations.push("CloudFront Regional Pricing");
  if (config.CLOUDFRONT_COMPRESSION_ENABLED)
    optimizations.push("CloudFront Compression");
  if (config.RATE_LIMIT_STORE === "memory")
    optimizations.push("Memory-based Rate Limiting");
  if (!config.DETAILED_MONITORING) optimizations.push("Reduced Monitoring");
  if (config.LOG_RETENTION_DAYS <= 7) optimizations.push("Short Log Retention");

  return optimizations;
};
