import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags } from "../config";

// S3 bucket for raw video uploads
export const rawVideosBucket = new aws.s3.Bucket("raw-videos", {
  // FIX: Removed Date.now() — it caused bucket destroy+recreate on every pulumi up
  bucket: `vision-sync-raw-videos-${pulumi.getStack()}`,
  tags: {
    ...commonTags,
    Purpose: "raw-video-storage",
  },
});

// S3 bucket for processed videos
export const processedVideosBucket = new aws.s3.Bucket("processed-videos", {
  // FIX: Removed Date.now() — stable name required for CloudFront OAC policy
  bucket: `vision-sync-processed-videos-${pulumi.getStack()}`,
  tags: {
    ...commonTags,
    Purpose: "processed-video-storage",
  },
});

// FIX: Disabled versioning on raw bucket — raw videos are temporary (deleted after 7 days)
// Versioning would double storage costs for short-lived uploads
new aws.s3.BucketVersioningV2("raw-videos-versioning", {
  bucket: rawVideosBucket.id,
  versioningConfiguration: {
    status: "Suspended",
  },
});

// Processed videos versioning — kept enabled for content integrity
new aws.s3.BucketVersioningV2("processed-videos-versioning", {
  bucket: processedVideosBucket.id,
  versioningConfiguration: {
    status: "Enabled",
  },
});

// Public access block for raw videos bucket
new aws.s3.BucketPublicAccessBlock("raw-videos-pab", {
  bucket: rawVideosBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

// FIX: Processed bucket must be PRIVATE — all access goes through CloudFront OAC
// Previously all flags were false (public), which is a critical security vulnerability
new aws.s3.BucketPublicAccessBlock("processed-videos-pab", {
  bucket: processedVideosBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

// CORS for raw videos bucket is defined in ./s3-cors.ts to avoid a circular import:
//   s3.ts → alb.ts → backend/ec2.ts → s3.ts

// CORS configuration for processed videos (for CloudFront)
new aws.s3.BucketCorsConfigurationV2("processed-videos-cors", {
  bucket: processedVideosBucket.id,
  corsRules: [
    {
      allowedHeaders: ["*"],
      allowedMethods: ["GET", "HEAD"],
      allowedOrigins: ["*"],
      exposeHeaders: ["ETag"],
      maxAgeSeconds: 3000,
    },
  ],
});

// FIX: Reduced from 30 to 7 days — matches CONTEXT.md architecture spec
// Raw videos are temporary; once processed, the source is no longer needed
new aws.s3.BucketLifecycleConfigurationV2("raw-videos-lifecycle", {
  bucket: rawVideosBucket.id,
  rules: [
    {
      id: "delete-raw-after-processing",
      status: "Enabled",
      expiration: {
        days: 7,
      },
    },
  ],
});

// CloudFront Origin Access Control
const oac = new aws.cloudfront.OriginAccessControl("processed-videos-oac", {
  name: `vision-sync-oac-${pulumi.getStack()}`,
  description: "OAC for processed videos bucket",
  originAccessControlOriginType: "s3",
  signingBehavior: "always",
  signingProtocol: "sigv4",
});

// CloudFront Distribution
export const distribution = new aws.cloudfront.Distribution(
  "processed-videos-cdn",
  {
    origins: [
      {
        domainName: processedVideosBucket.bucketRegionalDomainName,
        originId: processedVideosBucket.id,
        originAccessControlId: oac.id,
      },
    ],

    enabled: true,
    isIpv6Enabled: true,
    comment: "Vision Sync processed videos distribution",

    defaultCacheBehavior: {
      allowedMethods: [
        "DELETE",
        "GET",
        "HEAD",
        "OPTIONS",
        "PATCH",
        "POST",
        "PUT",
      ],
      cachedMethods: ["GET", "HEAD"],
      targetOriginId: processedVideosBucket.id,

      forwardedValues: {
        queryString: false,
        cookies: {
          forward: "none",
        },
      },

      viewerProtocolPolicy: "redirect-to-https",
      minTtl: 0,
      defaultTtl: 3600,
      maxTtl: 86400,

      compress: true,
    },

    orderedCacheBehaviors: [
      {
        // FIX: Changed from *.m3u8 (HLS) to *.mpd (MPEG-DASH manifest)
        // VisionSync uses DASH, not HLS — manifests change frequently, short TTL
        pathPattern: "*.mpd",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
        targetOriginId: processedVideosBucket.id,
        compress: true,
        viewerProtocolPolicy: "redirect-to-https",

        forwardedValues: {
          queryString: false,
          headers: [
            "Origin",
            "Access-Control-Request-Headers",
            "Access-Control-Request-Method",
          ],
          cookies: {
            forward: "none",
          },
        },

        minTtl: 0,
        defaultTtl: 300, // Short TTL — manifests can change during ABR adaptation
        maxTtl: 1200,
      },
      {
        // FIX: Changed from *.ts (HLS segments) to *.m4s (MPEG-DASH segments)
        // DASH uses fragmented MP4 (.m4s) not MPEG-TS (.ts) — long TTL, immutable chunks
        pathPattern: "*.m4s",
        allowedMethods: ["GET", "HEAD", "OPTIONS"],
        cachedMethods: ["GET", "HEAD"],
        targetOriginId: processedVideosBucket.id,
        compress: true,
        viewerProtocolPolicy: "redirect-to-https",

        forwardedValues: {
          queryString: false,
          headers: [
            "Origin",
            "Access-Control-Request-Headers",
            "Access-Control-Request-Method",
          ],
          cookies: {
            forward: "none",
          },
        },

        minTtl: 0,
        defaultTtl: 86400,
        maxTtl: 31536000, // 1 year — DASH segments are immutable once written
      },
    ],

    restrictions: {
      geoRestriction: {
        restrictionType: "none",
      },
    },

    viewerCertificate: {
      cloudfrontDefaultCertificate: true,
    },

    tags: {
      ...commonTags,
      Purpose: "video-cdn",
    },
  },
);

// Bucket policy for CloudFront access to processed videos
const bucketPolicy = new aws.s3.BucketPolicy("processed-videos-policy", {
  bucket: processedVideosBucket.id,
  policy: pulumi
    .all([processedVideosBucket.arn, distribution.arn])
    .apply(([bucketArn, distributionArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "AllowCloudFrontServicePrincipal",
            Effect: "Allow",
            Principal: {
              Service: "cloudfront.amazonaws.com",
            },
            Action: "s3:GetObject",
            Resource: `${bucketArn}/*`,
            Condition: {
              StringEquals: {
                "AWS:SourceArn": distributionArn,
              },
            },
          },
        ],
      }),
    ),
});
