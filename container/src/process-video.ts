import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { spawn, ChildProcess } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import axios from "axios";

interface ProcessingEnvironment {
  videoBucket: string;
  videoFileName: string;
  videoId: string;
  outputBucket: string;
  webhookUrl?: string;
  awsRegion: string;

  // COST OPTIMIZATION: New environment variables
  ffmpegPreset: string;
  ffmpegThreads: string;
  processingPriority: string;
  instanceType: string;
  enableBatchMode: boolean;
  maxProcessingTime: number;
}

interface FFmpegProgress {
  frame?: number;
  fps?: number;
  time?: string;
  bitrate?: string;
  size?: string;
}

export class VideoProcessor {
  private s3Client: S3Client;
  private env: ProcessingEnvironment;
  private tempDir: string;

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || "ap-southeast-1",
    });

    this.env = {
      videoBucket: process.env.VIDEO_BUCKET || "",
      videoFileName: process.env.VIDEO_FILE_NAME || "",
      videoId: process.env.VIDEO_ID || "",
      outputBucket: process.env.OUTPUT_BUCKET || "",
      webhookUrl: process.env.WEBHOOK_URL,
      awsRegion: process.env.AWS_REGION || "ap-southeast-1",

      // COST OPTIMIZATION: FFmpeg optimization settings
      ffmpegPreset: process.env.FFMPEG_PRESET || "fast",
      ffmpegThreads: process.env.FFMPEG_THREADS || "2",
      processingPriority: process.env.PROCESSING_PRIORITY || "normal",
      instanceType: process.env.INSTANCE_TYPE || "on-demand",
      enableBatchMode: process.env.ENABLE_BATCH_MODE === "true",
      maxProcessingTime: parseInt(process.env.MAX_PROCESSING_TIME || "1800"), // 30 minutes default
    };

    this.tempDir = process.env.TEMP_DIR || "/tmp/video-processing";

    this.validateEnvironment();
  }

  private validateEnvironment(): void {
    const required = [
      "videoBucket",
      "videoFileName",
      "videoId",
      "outputBucket",
    ];
    const missing = required.filter(
      (key) => !this.env[key as keyof ProcessingEnvironment],
    );

    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables: ${missing.join(", ")}`,
      );
    }
  }

  private async downloadVideo(outputPath: string): Promise<number> {
    try {
      console.log(
        `Downloading video from S3: ${this.env.videoBucket}/${this.env.videoFileName}`,
      );

      const command = new GetObjectCommand({
        Bucket: this.env.videoBucket,
        Key: this.env.videoFileName,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error("No video data received from S3");
      }

      const chunks: Uint8Array[] = [];
      const stream = response.Body as any;

      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      await fs.writeFile(outputPath, buffer);

      const fileSize = buffer.length;
      console.log(
        `Video downloaded successfully: ${(fileSize / 1024 / 1024).toFixed(
          2,
        )} MB`,
      );

      return fileSize;
    } catch (error) {
      console.error("Error downloading video:", error);
      throw new Error(
        `Failed to download video: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async sendWebhook(
    status: string,
    manifestUrl?: string,
  ): Promise<void> {
    if (!this.env.webhookUrl) {
      console.log("No webhook URL configured, skipping webhook");
      return;
    }

    try {
      const payload = {
        videoId: this.env.videoId,
        status,
        manifestUrl,
        timestamp: new Date().toISOString(),
        instanceType: this.env.instanceType,
        processingMode: this.env.enableBatchMode ? "batch" : "single",
      };

      console.log("Sending webhook:", payload);

      await axios.post(this.env.webhookUrl, payload, {
        timeout: 10000,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "VisionSync-VideoProcessor/1.0",
        },
      });

      console.log("Webhook sent successfully");
    } catch (webhookError: unknown) {
      const error =
        webhookError instanceof Error
          ? webhookError
          : new Error("Unknown webhook error");

      // Check if it's an axios error by checking for response property
      const hasAxiosResponse =
        typeof webhookError === "object" &&
        webhookError !== null &&
        "response" in webhookError;

      console.error("Webhook failed:", {
        url: this.env.webhookUrl,
        error: error.message,
        status: hasAxiosResponse
          ? (webhookError as any).response?.status
          : undefined,
        data: hasAxiosResponse
          ? (webhookError as any).response?.data
          : undefined,
      });
    }
  }

  private parseFFmpegProgress(line: string): FFmpegProgress | null {
    const progress: FFmpegProgress = {};

    const frameMatch = line.match(/frame=\s*(\d+)/);
    const fpsMatch = line.match(/fps=\s*([\d.]+)/);
    const timeMatch = line.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
    const bitrateMatch = line.match(/bitrate=\s*([\d.]+\w+)/);
    const sizeMatch = line.match(/size=\s*(\d+\w+)/);

    if (frameMatch) progress.frame = parseInt(frameMatch[1]);
    if (fpsMatch) progress.fps = parseFloat(fpsMatch[1]);
    if (timeMatch) progress.time = timeMatch[1];
    if (bitrateMatch) progress.bitrate = bitrateMatch[1];
    if (sizeMatch) progress.size = sizeMatch[1];

    return Object.keys(progress).length > 0 ? progress : null;
  }

  private async processVideoWithFFmpeg(
    inputPath: string,
    outputDir: string,
  ): Promise<void> {
    console.log("Starting FFmpeg processing with cost-optimized settings...");
    console.log("Processing configuration:", {
      preset: this.env.ffmpegPreset,
      threads: this.env.ffmpegThreads,
      priority: this.env.processingPriority,
      instanceType: this.env.instanceType,
      batchMode: this.env.enableBatchMode,
      maxTime: this.env.maxProcessingTime,
    });

    return new Promise((resolve, reject) => {
      // COST OPTIMIZATION: Optimized FFmpeg arguments for faster processing
      const ffmpegArgs = [
        "-i",
        inputPath,

        // COST OPTIMIZATION: Limit threads to reduce CPU usage
        "-threads",
        this.env.ffmpegThreads,

        // FIX: Removed -t flag — it was truncating any video longer than maxProcessingTime seconds.
        // Processing timeout is enforced at the Node.js process level via setTimeout below.

        "-filter_complex",
        // Keep a consistent rendition ladder so clients always expose full resolution options.
        "[0:v]split=4[v1][v2][v3][v4]; [v1]scale=1920:1080[v1out]; [v2]scale=1280:720[v2out]; [v3]scale=960:540[v3out]; [v4]scale=640:360[v4out]",

        // COST OPTIMIZATION: Video streams with optimized bitrates
        ...(this.env.processingPriority === "low"
          ? [
              // Lower bitrate ladder for Spot instances (4 streams)
              "-map",
              "[v1out]",
              "-c:v:0",
              "libx264",
              "-b:v:0",
              "3000k",
              "-maxrate:0",
              "3300k",
              "-bufsize:0",
              "6000k",
              "-map",
              "[v2out]",
              "-c:v:1",
              "libx264",
              "-b:v:1",
              "1800k",
              "-maxrate:1",
              "1980k",
              "-bufsize:1",
              "3600k",
              "-map",
              "[v3out]",
              "-c:v:2",
              "libx264",
              "-b:v:2",
              "1000k",
              "-maxrate:2",
              "1100k",
              "-bufsize:2",
              "2000k",
              "-map",
              "[v4out]",
              "-c:v:3",
              "libx264",
              "-b:v:3",
              "550k",
              "-maxrate:3",
              "605k",
              "-bufsize:3",
              "1100k",
            ]
          : [
              // Full quality for regular instances (4 streams)
              "-map",
              "[v1out]",
              "-c:v:0",
              "libx264",
              "-b:v:0",
              "5000k",
              "-maxrate:0",
              "5500k",
              "-bufsize:0",
              "10000k",
              "-map",
              "[v2out]",
              "-c:v:1",
              "libx264",
              "-b:v:1",
              "3000k",
              "-maxrate:1",
              "3300k",
              "-bufsize:1",
              "6000k",
              "-map",
              "[v3out]",
              "-c:v:2",
              "libx264",
              "-b:v:2",
              "1500k",
              "-maxrate:2",
              "1650k",
              "-bufsize:2",
              "3000k",
              "-map",
              "[v4out]",
              "-c:v:3",
              "libx264",
              "-b:v:3",
              "800k",
              "-maxrate:3",
              "880k",
              "-bufsize:3",
              "1600k",
            ]),

        // Audio stream - optimized for cost
        "-map",
        "0:a?",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-ar",
        "48000",

        // COST OPTIMIZATION: Encoding settings based on instance type
        "-g",
        "48",
        "-sc_threshold",
        "0",
        "-keyint_min",
        "48",
        "-preset",
        this.env.ffmpegPreset, // 'fast' for regular, 'medium' for Spot
        "-profile:v",
        "high",
        "-level",
        "4.0",

        // COST OPTIMIZATION: Optimized for processing speed vs quality
        ...(this.env.instanceType === "spot"
          ? [
              "-crf",
              "25", // Slightly lower quality for Spot instances
              "-tune",
              "fastdecode", // Optimize for faster decoding
            ]
          : [
              "-crf",
              "23", // Higher quality for regular instances
            ]),

        // DASH settings - optimized segment size for cost
        "-adaptation_sets",
        this.env.processingPriority === "low"
          ? "id=0,streams=v id=1,streams=a"
          : "id=0,streams=v id=1,streams=a",
        "-f",
        "dash",
        "-seg_duration",
        this.env.enableBatchMode ? "6" : "4", // Longer segments for batch mode
        "-frag_duration",
        this.env.enableBatchMode ? "6" : "4",
        "-min_seg_duration",
        this.env.enableBatchMode ? "6" : "4",
        "-use_template",
        "1",
        "-use_timeline",
        "1",
        "-init_seg_name",
        "init-$RepresentationID$.m4s",
        "-media_seg_name",
        "chunk-$RepresentationID$-$Number$.m4s",

        // Output manifest
        path.join(outputDir, "manifest.mpd"),
      ];

      console.log("FFmpeg command:", ["ffmpeg", ...ffmpegArgs].join(" "));

      const ffmpeg: ChildProcess = spawn("ffmpeg", ffmpegArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      let lastProgressTime = 0;
      const progressInterval = this.env.enableBatchMode ? 10000 : 5000; // Less frequent logging in batch mode

      ffmpeg.stdout?.on("data", (data: Buffer) => {
        // FFmpeg writes progress to stderr, not stdout
      });

      ffmpeg.stderr?.on("data", (data: Buffer) => {
        const output = data.toString();

        // Parse and log progress
        const progress = this.parseFFmpegProgress(output);
        if (progress && Date.now() - lastProgressTime > progressInterval) {
          console.log(`FFmpeg progress (${this.env.instanceType}):`, {
            ...progress,
            preset: this.env.ffmpegPreset,
            threads: this.env.ffmpegThreads,
          });
          lastProgressTime = Date.now();
        }

        // Log errors and warnings
        if (output.includes("Error") || output.includes("error")) {
          console.error(`FFmpeg error: ${output.trim()}`);
        }
      });

      ffmpeg.on("error", (error: Error) => {
        console.error("FFmpeg spawn error:", error);
        reject(new Error(`FFmpeg spawn failed: ${error.message}`));
      });

      ffmpeg.on("close", (code: number | null) => {
        if (code === 0) {
          console.log("FFmpeg processing completed successfully");
          console.log(
            `Processing mode: ${this.env.instanceType} (${this.env.ffmpegPreset} preset)`,
          );
          resolve();
        } else {
          console.error("FFmpeg failed with code:", code);
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      // COST OPTIMIZATION: Set timeout for processing
      setTimeout(() => {
        if (ffmpeg && !ffmpeg.killed) {
          console.warn(
            `FFmpeg timeout reached (${this.env.maxProcessingTime}s), terminating process`,
          );
          ffmpeg.kill("SIGTERM");
          reject(new Error("FFmpeg processing timeout"));
        }
      }, this.env.maxProcessingTime * 1000);
    });
  }

  private async generateThumbnail(inputPath: string): Promise<string> {
    const thumbPath = path.join(this.tempDir, "thumbnail.jpg");
    console.log("Generating thumbnail with FFmpeg...");

    return new Promise((resolve, reject) => {
      // Seek to 3 s, grab 1 frame, scale to 1280 px wide, high JPEG quality
      const args = [
        "-ss",
        "00:00:03",
        "-i",
        inputPath,
        "-vframes",
        "1",
        "-vf",
        "scale=1280:-2",
        "-q:v",
        "3",
        "-y",
        thumbPath,
      ];

      const ffmpeg = spawn("ffmpeg", args);
      const errLines: string[] = [];
      ffmpeg.stderr.on("data", (chunk: Buffer) =>
        errLines.push(chunk.toString()),
      );

      ffmpeg.on("close", (code) => {
        if (code === 0) {
          console.log(`Thumbnail generated: ${thumbPath}`);
          resolve(thumbPath);
        } else {
          // Video may be shorter than 3 s — retry at first frame
          const retry = spawn("ffmpeg", [
            "-i",
            inputPath,
            "-vframes",
            "1",
            "-vf",
            "scale=1280:-2",
            "-q:v",
            "3",
            "-y",
            thumbPath,
          ]);
          const retryErr: string[] = [];
          retry.stderr.on("data", (c: Buffer) => retryErr.push(c.toString()));
          retry.on("close", (rc) => {
            if (rc === 0) {
              console.log("Thumbnail generated (retry at frame 0)");
              resolve(thumbPath);
            } else {
              reject(
                new Error(
                  `FFmpeg thumbnail failed (code ${rc}): ${retryErr.join("")}`,
                ),
              );
            }
          });
          retry.on("error", reject);
        }
      });

      ffmpeg.on("error", reject);
    });
  }

  private async uploadThumbnail(thumbPath: string): Promise<void> {
    const key = `${this.env.videoId}/thumbnail.jpg`;
    const fileContent = await fs.readFile(thumbPath);
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.env.outputBucket,
        Key: key,
        Body: fileContent,
        ContentType: "image/jpeg",
        CacheControl: "max-age=31536000",
        Metadata: {
          "video-id": this.env.videoId,
          "processed-by": "vision-sync-processor",
        },
      }),
    );
    console.log(`Thumbnail uploaded → s3://${this.env.outputBucket}/${key}`);
  }

  private async uploadProcessedFiles(outputDir: string): Promise<any[]> {
    console.log("Uploading processed files to S3...");

    try {
      const files = await fs.readdir(outputDir);
      console.log(`Found ${files.length} files to upload:`, files);

      // Upload in batches of 10 to cap concurrent S3 PutObject calls.
      // A 1080p DASH output can have 200+ chunk files; unlimited concurrency
      // exhausts the AWS SDK connection pool and causes throttling.
      const BATCH_SIZE = 10;
      const results: any[] = [];

      for (let i = 0; i < files.length; i += BATCH_SIZE) {
        const batch = files.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            const filePath = path.join(outputDir, file);
            const fileContent = await fs.readFile(filePath);

            const contentType = file.endsWith(".mpd")
              ? "application/dash+xml"
              : file.endsWith(".m4s")
                ? "video/mp4"
                : "application/octet-stream";

            const key = `${this.env.videoId}/${file}`;

            console.log(
              `Uploading: ${key} (${(fileContent.length / 1024).toFixed(2)} KB)`,
            );

            const command = new PutObjectCommand({
              Bucket: this.env.outputBucket,
              Key: key,
              Body: fileContent,
              ContentType: contentType,
              StorageClass: "STANDARD",
              Metadata: {
                "video-id": this.env.videoId,
                "processed-by": "vision-sync-processor",
                "instance-type": this.env.instanceType,
                "processing-date": new Date().toISOString(),
                "ffmpeg-preset": this.env.ffmpegPreset,
              },
              CacheControl: file.endsWith(".mpd")
                ? "max-age=300"
                : "max-age=31536000",
            });

            const result = await this.s3Client.send(command);
            console.log(`Successfully uploaded: ${key}`);
            return { key, etag: result.ETag, size: fileContent.length };
          }),
        );
        results.push(...batchResults);
      }

      const totalSize = results.reduce((sum, result) => sum + result.size, 0);
      console.log(
        `All files uploaded successfully. Total size: ${(
          totalSize /
          1024 /
          1024
        ).toFixed(2)} MB`,
      );

      return results;
    } catch (error) {
      console.error("Error uploading files:", error);
      throw new Error(
        `Failed to upload processed files: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      );
    }
  }

  private async cleanup(): Promise<void> {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
      console.log("Cleanup completed");
    } catch (error) {
      console.error(
        "Cleanup failed:",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  public async process(): Promise<void> {
    const startTime = Date.now();

    try {
      console.log("=".repeat(50));
      console.log("Starting cost-optimized video processing");
      console.log("=".repeat(50));
      console.log("Configuration:", {
        videoId: this.env.videoId,
        instanceType: this.env.instanceType,
        ffmpegPreset: this.env.ffmpegPreset,
        processingPriority: this.env.processingPriority,
        batchMode: this.env.enableBatchMode,
        maxProcessingTime: `${this.env.maxProcessingTime}s`,
      });

      // Ensure temporary directories exist
      await fs.mkdir(this.tempDir, { recursive: true });
      const inputPath = path.join(this.tempDir, "input.mp4");
      const outputPath = path.join(this.tempDir, "output");
      await fs.mkdir(outputPath, { recursive: true });

      // Download video from S3
      const videoSize = await this.downloadVideo(inputPath);

      // Notify server that processing has started (so UI can update to "processing" state)
      await this.sendWebhook("processing");

      // Process video with FFmpeg
      await this.processVideoWithFFmpeg(inputPath, outputPath);

      // Upload processed files
      const uploadResults = await this.uploadProcessedFiles(outputPath);

      // Generate & upload thumbnail (non-fatal — don't abort if it fails)
      try {
        const thumbPath = await this.generateThumbnail(inputPath);
        await this.uploadThumbnail(thumbPath);
      } catch (thumbErr) {
        console.warn(
          "Thumbnail generation failed (non-fatal):",
          thumbErr instanceof Error ? thumbErr.message : thumbErr,
        );
      }

      // Send success webhook
      const manifestUrl = `${this.env.videoId}/manifest.mpd`;
      await this.sendWebhook("ready", manifestUrl);

      const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const estimatedCost =
        this.env.instanceType === "spot" ? "$0.30" : "$1.00"; // Rough estimate

      console.log("=".repeat(50));
      console.log(
        `Video processing completed successfully in ${processingTime}s`,
      );
      console.log(`Video size: ${(videoSize / 1024 / 1024).toFixed(2)} MB`);
      console.log(`Output files: ${uploadResults.length}`);
      console.log(`Instance type: ${this.env.instanceType}`);
      console.log(
        `Estimated cost: ${estimatedCost} (${
          this.env.instanceType === "spot" ? "70% savings" : "standard rate"
        })`,
      );
      console.log(`Video ID: ${this.env.videoId}`);
      console.log(`Manifest URL: ${manifestUrl}`);
      console.log("=".repeat(50));
    } catch (error) {
      const processingTime = ((Date.now() - startTime) / 1000).toFixed(2);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      console.error("=".repeat(50));
      console.error(`Video processing failed after ${processingTime}s`);
      console.error(`Error: ${errorMessage}`);
      console.error(`Instance type: ${this.env.instanceType}`);
      console.error(`Video ID: ${this.env.videoId}`);
      console.error("=".repeat(50));

      // Send error webhook
      await this.sendWebhook("error");

      throw error;
    } finally {
      // Clean up temporary files
      await this.cleanup();
    }
  }
}

// Initialize the processor
const processor = new VideoProcessor();

// FIX: SIGTERM handler — mandatory for Spot Fargate instances.
// AWS gives ECS tasks a 2-minute warning via SIGTERM before forcibly terminating them.
// Without this handler:
//   - FFmpeg keeps running until the force-kill, wasting CPU
//   - No failure webhook is sent, leaving video stuck in PROCESSING forever
//   - Frontend never receives an error event via Socket.IO
process.on("SIGTERM", async () => {
  console.warn(
    "🚨 SIGTERM received — Spot instance is being reclaimed. Shutting down...",
  );
  try {
    // Notify backend so it can update status to ERROR and emit Socket.IO event
    // @ts-ignore — sendWebhook is private, but critical to call here
    await (processor as any).sendWebhook("error");
    console.log("✅ Failure webhook sent to backend");
  } catch (webhookError) {
    console.error(
      "❌ Failed to send failure webhook during SIGTERM:",
      webhookError,
    );
  } finally {
    process.exit(0);
  }
});

processor.process().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
