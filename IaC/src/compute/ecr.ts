import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { commonTags } from "../config";

// Create ECR repository for client (frontend)
export const clientEcrRepository = new aws.ecr.Repository("client-repo", {
  name: `vision-sync-client-${pulumi.getStack()}`,
  imageTagMutability: "MUTABLE",

  imageScanningConfiguration: {
    scanOnPush: true,
  },

  encryptionConfigurations: [
    {
      encryptionType: "AES256",
    },
  ],

  tags: {
    ...commonTags,
    Purpose: "client-frontend-container",
  },
});

// Create ECR repository for server (backend)
export const serverEcrRepository = new aws.ecr.Repository("server-repo", {
  name: `vision-sync-server-${pulumi.getStack()}`,
  imageTagMutability: "MUTABLE",

  imageScanningConfiguration: {
    scanOnPush: true,
  },

  encryptionConfigurations: [
    {
      encryptionType: "AES256",
    },
  ],

  tags: {
    ...commonTags,
    Purpose: "server-backend-container",
  },
});

// Create ECR repository for video processing container
export const ecrRepository = new aws.ecr.Repository("video-processor-repo", {
  name: `vision-sync-video-processor-${pulumi.getStack()}`,
  imageTagMutability: "MUTABLE",

  imageScanningConfiguration: {
    scanOnPush: true,
  },

  encryptionConfigurations: [
    {
      encryptionType: "AES256",
    },
  ],

  tags: {
    ...commonTags,
    Purpose: "video-processing-container",
  },
});

// Lifecycle policy for client repository
new aws.ecr.LifecyclePolicy("client-lifecycle", {
  repository: clientEcrRepository.name,
  policy: pulumi.jsonStringify({
    rules: [
      {
        rulePriority: 1,
        description: "Delete untagged images after 1 day",
        selection: {
          tagStatus: "untagged",
          countType: "sinceImagePushed",
          countUnit: "days",
          countNumber: 1,
        },
        action: {
          type: "expire",
        },
      },
      {
        rulePriority: 2,
        description: "Keep only latest 10 tagged images",
        selection: {
          tagStatus: "tagged",
          tagPrefixList: ["latest", "v"],
          countType: "imageCountMoreThan",
          countNumber: 10,
        },
        action: {
          type: "expire",
        },
      },
    ],
  }),
});

// Lifecycle policy for server repository
new aws.ecr.LifecyclePolicy("server-lifecycle", {
  repository: serverEcrRepository.name,
  policy: pulumi.jsonStringify({
    rules: [
      {
        rulePriority: 1,
        description: "Delete untagged images after 1 day",
        selection: {
          tagStatus: "untagged",
          countType: "sinceImagePushed",
          countUnit: "days",
          countNumber: 1,
        },
        action: {
          type: "expire",
        },
      },
      {
        rulePriority: 2,
        description: "Keep only latest 10 tagged images",
        selection: {
          tagStatus: "tagged",
          tagPrefixList: ["latest", "v"],
          countType: "imageCountMoreThan",
          countNumber: 10,
        },
        action: {
          type: "expire",
        },
      },
    ],
  }),
});

// Lifecycle policy for video processor repository

// Lifecycle policy for video processor repository
new aws.ecr.LifecyclePolicy("video-processor-lifecycle", {
  repository: ecrRepository.name,
  policy: pulumi.jsonStringify({
    rules: [
      {
        rulePriority: 1,
        description: "Delete untagged images after 1 day",
        selection: {
          tagStatus: "untagged",
          countType: "sinceImagePushed",
          countUnit: "days",
          countNumber: 1,
        },
        action: {
          type: "expire",
        },
      },
      {
        rulePriority: 2,
        description: "Keep only latest 10 tagged images",
        selection: {
          tagStatus: "tagged",
          tagPrefixList: ["latest", "v"],
          countType: "imageCountMoreThan",
          countNumber: 10,
        },
        action: {
          type: "expire",
        },
      },
    ],
  }),
});
