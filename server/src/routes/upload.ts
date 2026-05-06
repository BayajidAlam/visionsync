import express from 'express'
import { s3Service } from '../services/s3Service.js'
import { videoService } from '../services/videoService.js'
import { validateUploadRequest, validateVideoId } from '../middleware/validation.js'
import { ApiError } from '../types/index.js'
import { logger } from '../config/logger.js'

const router = express.Router()

router.post(
  '/generate-presigned-url',
  validateUploadRequest,
  async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
    try {
      const { fileName, fileType, fileSize } = req.body

      const { presignedUrl, videoId, expiresAt } = await s3Service.generatePresignedUrl(fileName, fileType)

      await videoService.createVideo(videoId, {
        fileName,
        fileType,
        fileSize: fileSize || 0,
      })

      res.json({
        data: { presignedUrl, videoId, expiresAt },
        message: 'Presigned URL generated successfully',
      })
    } catch (error) {
      logger.error('Failed to generate presigned URL', { error: (error as Error).message })
      next(ApiError.internal('Failed to generate upload URL'))
    }
  },
)

router.post(
  '/confirm/:id',
  validateVideoId,
  async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
    try {
      const { id } = req.params

      const video = await videoService.markVideoAsUploaded(id)

      if (!video) {
        next(ApiError.notFound('Video not found'))
        return
      }

      res.json({
        data: video,
        message: 'Upload confirmed, video queued for processing',
      })
    } catch (error) {
      logger.error('Failed to confirm upload', { videoId: req.params.id, error: (error as Error).message })
      next(ApiError.internal('Failed to confirm upload'))
    }
  },
)

export default router
