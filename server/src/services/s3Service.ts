import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client } from '../config/aws.js'
import { config } from '../config/env.js'
import { v4 as uuidv4 } from 'uuid'

export class S3Service {
  async generatePresignedUrl(
    fileName: string,
    fileType: string
  ): Promise<{ presignedUrl: string; videoId: string }> {
    const videoId = uuidv4()
    const key = `videos/${videoId}/${fileName}`

    const command = new PutObjectCommand({
      Bucket: config.S3_BUCKET_RAW,
      Key: key,
      ContentType: fileType,
    })

    try {
      // FIX: Reduced from 3600s to 900s (15 min) per CONTEXT.md security spec.
      // A leaked presigned URL should have a minimal exploitation window.
      const presignedUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 900,
      })

      return { presignedUrl, videoId }
    } catch (error) {
      console.error('Error generating presigned URL:', error)
      throw new Error('Failed to generate presigned URL')
    }
  }

  async getVideoUrl(videoId: string, fileName: string): Promise<string> {
    const key = `videos/${videoId}/${fileName}`

    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET_RAW,
      Key: key,
    })

    try {
      return await getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      })
    } catch (error) {
      console.error('Error getting video URL:', error)
      throw new Error('Failed to get video URL')
    }
  }

  async getProcessedVideoUrl(
    videoId: string,
    fileName: string
  ): Promise<string> {
    const key = `${videoId}/${fileName}`

    const command = new GetObjectCommand({
      Bucket: config.S3_BUCKET_PROCESSED,
      Key: key,
    })

    try {
      return await getSignedUrl(s3Client, command, {
        expiresIn: 3600,
      })
    } catch (error) {
      console.error('Error getting processed video URL:', error)
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
      await s3Client.send(command)
    } catch (error) {
      console.error('Error deleting video from S3:', error)
      throw new Error('Failed to delete video from S3')
    }
  }

  // FIX: Use CloudFront domain instead of direct S3 URL.
  // The processed bucket is now fully private (blockPublicPolicy: true).
  // Direct S3 URLs return 403 — all delivery must go through CloudFront.
  getManifestUrl(videoId: string): string {
    const domain = config.CLOUDFRONT_DOMAIN || `${config.S3_BUCKET_PROCESSED}.s3.${config.AWS_REGION}.amazonaws.com`;
    return `https://${domain}/${videoId}/manifest.mpd`;
  }

  // FIX: Same — use CloudFront for segment URLs
  getSegmentUrl(videoId: string, segment: string): string {
    const domain = config.CLOUDFRONT_DOMAIN || `${config.S3_BUCKET_PROCESSED}.s3.${config.AWS_REGION}.amazonaws.com`;
    return `https://${domain}/${videoId}/${segment}`;
  }
}

export const s3Service = new S3Service()
