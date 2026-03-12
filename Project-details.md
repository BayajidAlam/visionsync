This is a video streaming application. here are folder details
ansible - container necessary configuration file like ssh to redis instance and redis installation using docker, ssh and setting up mongodb one write and two read replica in 3 instance of my private subnet etc

client - It is the frontend folder build using react-shadcn-ui and ts. it has a dockerfile to dockerize the app and run on frontend instance. 

container - it is the container file that will download and process the vide using ffmpeg on ecs/fargate

doc - it will contain the documentation of the project how different parts are working, example of critical implementation etc

Iac - It is the code of infrastructure of the whole system.
Client will be in public subne, server and db, and redis will be in private subnet. all will be ssh and setup using ansible.

lambda - This is lambda function file, the function are written here

server - This is the backend of the application, will be dockerize and ssh using ansible and setup using ansible. it will be in autoscaling group. will have a health route. client will connect with it using alb.

      - User will upload video using presigned url, when the video will be uploaded to s3, a lambda function will be triggered and a ecs container will lunch. Ecs will download the the video s3 and the video will be compressed and convert to different resolation(1080, 720, 460 etc) and convert each video in many chunks(each 6s or 10s). finally create a master mpd file that will be dash playable and dynamic adaptive. and save the mpd, chunks into s3 and will be server using cloudfront. Video status will be track and update using socket.io. There are different rate limiting implemented in server for different algorithm.

      -I am using ansible to ssh into private instance make necessary setup, like installing docker in backend instance, pull the image from ecr and run it etc. This way for all necessary place i am using ansible.

      -Using make file to automate the process, makefile and ansible making my process easy. 




      // Main modular infrastructure definition
// This file imports all the infrastructure modules and exports key resources

// Networking
export * from "./networking/vpc";
export * from "./networking/alb";

// Storage
export * from "./storage/s3";

// Database
export * from "./database/mongodb";
export * from "./database/redis";

// Messaging
export * from "./messaging/sqs";

// Monitoring
export * from "./monitoring/alarms";
export * from "./monitoring/logs";

// Security
export * from "./security/iam";

// Config
export * from "./config/index";

// Compute - explicit exports to avoid ubuntu AMI conflicts
export {
  bastionSg,
  bastionKey,
  bastionRole,
  bastionPolicy,
  bastionPolicyAttachment,
  bastionProfile,
  bastionInstance,
  bastionEip,
} from "./compute/bastion";

export * from "./compute/ecr";
export * from "./compute/ecs";
export * from "./compute/lambda";

// Backend - explicit exports to avoid ubuntu AMI conflicts
export {
  backendSg,
  backendKey,
  backendRole,
  backendPolicy,
  backendPolicyAttachment,
  backendProfile,
  userData,
  backendInstance,
  backendEip,
} from "./backend/ec2";

// Key exports for convenience
import { bastionInstance, bastionEip } from "./compute/bastion";
import { backendInstance } from "./backend/ec2";
import { albDnsName, backendUrl } from "./networking/alb";
import { mongodbInstance1, mongodbInstance2, mongodbInstance3 } from "./database/mongodb";
import { redisInstance } from "./database/redis";

// Export important connection information
export const bastionPublicIp = bastionEip.publicIp;
export const backendPrivateIp = backendInstance.privateIp;
export const loadBalancerDnsName = albDnsName;
export const applicationUrl = backendUrl;

// Database connection info
export const mongodbNodes = {
  primary: mongodbInstance1.privateIp,
  secondary1: mongodbInstance2.privateIp,
  secondary2: mongodbInstance3.privateIp,
};

export const redisEndpoint = redisInstance.privateIp;
