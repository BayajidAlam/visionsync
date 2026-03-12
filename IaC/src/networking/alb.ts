import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { commonTags } from "../config";
import { vpc } from "./vpc";
import { backendInstance, backendSg } from "../backend/ec2";
import { frontendInstance } from "../frontend/ec2";

// Security group for ALB - allow public HTTP/HTTPS access
export const albSg = new aws.ec2.SecurityGroup("alb-sg", {
  name: `vision-sync-alb-sg-${pulumi.getStack()}`,
  vpcId: vpc.vpcId,
  ingress: [
    {
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      cidrBlocks: ["0.0.0.0/0"],
      description: "HTTP access from internet",
    },
    {
      protocol: "tcp",
      fromPort: 443,
      toPort: 443,
      cidrBlocks: ["0.0.0.0/0"],
      description: "HTTPS access from internet",
    },
  ],
  egress: [
    {
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
      description: "All outbound traffic",
    },
  ],
  tags: {
    ...commonTags,
    Name: "alb-security-group",
    Purpose: "public-web-access",
  },
});

// Application Load Balancer
export const alb = new aws.lb.LoadBalancer("vision-sync-alb", {
  name: `vision-sync-alb-${pulumi.getStack()}`,
  loadBalancerType: "application",
  securityGroups: [albSg.id],
  subnets: vpc.publicSubnetIds,
  enableDeletionProtection: false, // For development

  tags: {
    ...commonTags,
    Name: "vision-sync-alb",
    Purpose: "backend-load-balancer",
  },
});

// Target group for backend instances
export const backendTargetGroup = new aws.lb.TargetGroup("backend-tg", {
  name: `vision-sync-backend-tg-${pulumi.getStack()}`,
  port: 5000,
  protocol: "HTTP",
  vpcId: vpc.vpcId,

  healthCheck: {
    enabled: true,
    healthyThreshold: 2,
    interval: 30,
    matcher: "200",
    path: "/health", // Backend health endpoint
    port: "traffic-port",
    protocol: "HTTP",
    timeout: 5,
    unhealthyThreshold: 2,
  },

  tags: { ...commonTags, Name: "backend-target-group" },
});

// Attach backend instance to target group
export const backendTargetAttachment = new aws.lb.TargetGroupAttachment(
  "backend-tg-attachment",
  {
    targetGroupArn: backendTargetGroup.arn,
    targetId: backendInstance.id,
    port: 5000,
  },
);

// Target group for frontend instances
export const frontendTargetGroup = new aws.lb.TargetGroup("frontend-tg", {
  name: `vision-sync-frontend-tg-${pulumi.getStack()}`,
  port: 80,
  protocol: "HTTP",
  vpcId: vpc.vpcId,

  healthCheck: {
    enabled: true,
    healthyThreshold: 2,
    interval: 30,
    matcher: "200",
    path: "/", // Frontend serves on root
    port: "traffic-port",
    protocol: "HTTP",
    timeout: 5,
    unhealthyThreshold: 2,
  },

  tags: { ...commonTags, Name: "frontend-target-group" },
});

// Attach frontend instance to target group
export const frontendTargetAttachment = new aws.lb.TargetGroupAttachment(
  "frontend-tg-attachment",
  {
    targetGroupArn: frontendTargetGroup.arn,
    targetId: frontendInstance.id,
    port: 80,
  },
);

// HTTP listener with routing rules
export const httpListener = new aws.lb.Listener("http-listener", {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: "HTTP",

  // Default action: forward to frontend
  defaultActions: [
    {
      type: "forward",
      targetGroupArn: frontendTargetGroup.arn,
    },
  ],

  tags: { ...commonTags, Name: "http-listener" },
});

// Listener rule for API routes - forward /api/* to backend
export const apiListenerRule = new aws.lb.ListenerRule("api-listener-rule", {
  listenerArn: httpListener.arn,
  priority: 100,

  actions: [
    {
      type: "forward",
      targetGroupArn: backendTargetGroup.arn,
    },
  ],

  conditions: [
    {
      pathPattern: {
        values: ["/api/*"],
      },
    },
  ],

  tags: { ...commonTags, Name: "api-routing-rule" },
});

// Listener rule for health check and Socket.IO - route to backend
export const backendDirectRule = new aws.lb.ListenerRule(
  "backend-direct-rule",
  {
    listenerArn: httpListener.arn,
    priority: 90,

    actions: [
      {
        type: "forward",
        targetGroupArn: backendTargetGroup.arn,
      },
    ],

    conditions: [
      {
        pathPattern: {
          values: ["/health", "/socket.io/*"],
        },
      },
    ],

    tags: { ...commonTags, Name: "backend-direct-rule" },
  },
);

// Allow ALB to access backend on port 5000
export const albToBackendRule = new aws.ec2.SecurityGroupRule(
  "alb-to-backend",
  {
    type: "ingress",
    fromPort: 5000,
    toPort: 5000,
    protocol: "tcp",
    securityGroupId: backendSg.id,
    sourceSecurityGroupId: albSg.id,
    description: "Allow ALB to access backend API",
  },
);

// Export ALB DNS name for client access
export const albDnsName = alb.dnsName;
export const backendUrl = pulumi.interpolate`http://${alb.dnsName}`;
