import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client } from '../config/aws.js'
import { config } from '../config/env.js'
import { logger } from '../config/logger.js'
import { s3Breaker } from '../config/circuitBreaker.js'
import { v4 as uuidv4 } from 'uuid'

const PRESIGNED_URL_TTL = 900 // 15 minutes

export class S3Service {
  async generatePresignedUrl(
    fileName: string,
    fileType: string,
  ): Promise<{ presignedUrl: string; videoId: string; expiresAt: string }> {
    return s3Breaker.execute(async () => {
      const videoId = uuidv4()
      const key = `videos/${videoId}/${fileName}`

      const command = new PutObjectCommand({
        Bucket: config.S3_BUCKET_RAW,
        Key: key,
        ContentType: fileType,
      })

      try {
        const presignedUrl = await getSignedUrl(s3Client, command, {
          expiresIn: PRESIGNED_URL_TTL,
        })
        const expiresAt = new Date(Date.now() + PRESIGNED_URL_TTL * 1000).toISOString()
        return { presignedUrl, videoId, expiresAt }
      } catch (error) {
        logger.error('Error generating presigned URL', { error: (error as Error).message })
        throw new Error('Failed to generate presigned URL')
      }
    })
  }

  async getVideoUrl(videoId: string, fileName: string): Promise<string> {
    const key = `videos/${videoId}/${fileName}`

    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET_RAW,
      Key: key,
    })

    try {
      return await getSignedUrl(s3Client, command, { expiresIn: 3600 })
    } catch (error) {
      logger.error('Error getting video URL', { error: (error as Error).message })
      throw new Error('Failed to get video URL')
    }
  }

  async getProcessedVideoUrl(videoId: string, fileName: string): Promise<string> {
    const key = `${videoId}/${fileName}`

    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET_PROCESSED,
      Key: key,
    })

    try {
      return await getSignedUrl(s3Client, command, { expiresIn: 3600 })
    } catch (error) {
      logger.error('Error getting processed video URL', { error: (error as Error).message })
      throw new Error('Failed to get processed video URL')
    }
  }

  async deleteVideo(videoId: string, fileName: string): Promise<void> {
    const key = `videos/${videoId}/${fileName}`

    const command = new DeleteObjectCommand({
      Bucket: config.S3_BUCKET_RAW,
      Key: key,
    })

    try {
      await s3Breaker.execute(() => s3Client.send(command))
    } catch (error) {
      logger.error('Error deleting video from S3', { error: (error as Error).message })
      throw new Error('Failed to delete video from S3')
    }
  }

  getManifestUrl(videoId: string): string {
    const domain = config.CLOUDFRONT_DOMAIN || `${config.S3_BUCKET_PROCESSED}.s3.${config.AWS_REGION}.amazonaws.com`
    return `https://${domain}/${videoId}/manifest.mpd`
  }

  getSegmentUrl(videoId: string, segment: string): string {
    const domain = config.CLOUDFRONT_DOMAIN || `${config.S3_BUCKET_PROCESSED}.s3.${config.AWS_REGION}.amazonaws.com`
    return `https://${domain}/${videoId}/${segment}`
  }
}

export const s3Service = new S3Service()
