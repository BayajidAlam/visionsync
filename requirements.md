## 📹 Video Streaming Application Overview

This project is a video streaming application with real-time processing updates and scalable infrastructure using AWS and Pulumi.

### requirements

- Allow users to upload videos using a pre-signed URL  
- Upload the video directly to an S3 bucket  
- Trigger a container (ECS task) after upload to perform the following tasks:
  - Compress the video using FFmpeg  
  - Convert the video to multiple resolutions (e.g., 1080p, 720p, 480p)  
  - Split each resolution into multiple chunks(each 10s)  
  - Store all chunks of all resolutions in another S3 bucket (or separate buckets)  
  - Generate a master MPD file to serve the video using MPEG-DASH  
- Amazon S3 (for video and chunk storage)  
- AWS lambda (to trigger processing pipeline)  
- Amazon SQS (for queueing video processing jobs)  
- Amazon ECS (to run FFmpeg processing containers)  
- Amazon CloudFront (CDN for video delivery)  
- Use redis for rate limiting and redis as socket backplane
- full set up of pulumi so that i don't need a make any setup on any service. if need automate using ansible.
- Provide API for fetching the video  
- Serve videos through an AWS CloudFront CDN, which pulls from S3  
- Show real-time upload and processing status using Socket.IO  
-  Use signed CloudFront URLs for secured video access

### 🛠️ Tech Stack

- **Frontend**: React (TypeScript), Tailwind CSS, shadcnui  
- **Backend**: Node.js (TypeScript), express js
- **Database**: MongoDB  
- **Real-time Communication**: Socket.IO  
- **Infrastructure as Code**: Pulumi  

