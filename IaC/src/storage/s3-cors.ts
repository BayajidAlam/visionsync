import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { rawVideosBucket } from "./s3";
import { albDnsName } from "../networking/alb";
import { frontendInstanceIp } from "../frontend/ec2";

// Patch the raw-videos CORS rule with the actual ALB DNS and frontend EC2 IP.
// This lives in a separate file to avoid the circular import:
//   s3.ts → alb.ts → backend/ec2.ts → s3.ts
new aws.s3.BucketCorsConfigurationV2("raw-videos-cors", {
  bucket: rawVideosBucket.id,
  corsRules: [
    {
      allowedHeaders: ["*"],
      allowedMethods: ["PUT", "POST", "GET", "HEAD"],
      allowedOrigins: pulumi.all([albDnsName, frontendInstanceIp]).apply(([dns, ip]) => [
        `http://${dns}`,
        `http://${ip}`,
        "http://localhost:5173",
        "http://localhost:3000",
      ]),
      exposeHeaders: ["ETag"],
      maxAgeSeconds: 3000,
    },
  ],
});
