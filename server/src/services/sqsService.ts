import { SendMessageCommand } from '@aws-sdk/client-sqs'
import { sqsClient } from '../config/aws.js'
import { config } from '../config/env.js'

export class SQSService {
  async sendVideoProcessingMessage(bucketName: string, fileName: string, videoId: string): Promise<void> {
    const message = {
      bucketName,
      fileName,
      videoId,
      timestamp: new Date().toISOString(),
    }

    const command = new SendMessageCommand({
      QueueUrl: config.SQS_QUEUE_URL,
      MessageBody: JSON.stringify(message),
      MessageAttributes: {
        videoId: {
          DataType: 'String',
          StringValue: videoId,
        },
      },
    })

    try {
      const result = await sqsClient.send(command)
      console.log('✅ Video processing message sent to SQS:', result.MessageId)
    } catch (error) {
      console.error('❌ Error sending message to SQS:', error)
      throw new Error('Failed to queue video for processing')
    }
  }
}

export const sqsService = new SQSService()