import express from 'express'
import { s3Service } from '../services/s3Service.js'
import { videoService } from '../services/videoService.js'
import { validateUploadRequest } from '../middleware/validation.js'

const router = express.Router()

// Generate presigned URL for video upload
router.post('/generate-presigned-url', validateUploadRequest, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { fileName, fileType, fileSize } = req.body

    // Generate presigned URL and video ID
    const { presignedUrl, videoId } = await s3Service.generatePresignedUrl(fileName, fileType)

    // Create video record in database
    await videoService.createVideo(videoId, {
      fileName,
      fileType,
      fileSize: fileSize || 0,
    })

    res.json({
      data: {
        presignedUrl,
        videoId,
      },
      message: 'Presigned URL generated successfully',
    })
  } catch (error) {
    console.error('Upload presigned URL error:', error)
    res.status(500).json({
      error: 'Failed to generate upload URL',
    })
  }
})

// Confirm video upload completion
router.post('/confirm/:id', async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params

    // Mark video as uploaded and queue for processing
    const video = await videoService.markVideoAsUploaded(id)

    if (!video) {
      res.status(404).json({
        error: 'Video not found',
      })
      return
    }

    res.json({
      data: video,
      message: 'Upload confirmed, video queued for processing',
    })
  } catch (error) {
    console.error('Upload confirmation error:', error)
    res.status(500).json({
      error: 'Failed to confirm upload',
    })
  }
})

export default router