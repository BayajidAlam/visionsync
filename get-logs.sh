#!/bin/bash
TASK_ID="${1:-ebf14eb93107494da37ff7bf3871136d}"
echo "=== CloudWatch logs for task: $TASK_ID ==="
aws logs get-log-events \
  --region ap-southeast-1 \
  --log-group-name /ecs/vision-sync-video-processing-dev \
  --log-stream-name "ecs/video-processor/$TASK_ID" \
  --limit 60 \
  --output text 2>&1 | tail -80
