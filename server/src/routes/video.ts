import express from 'express'
import { videoService } from '../services/videoService.js'
import { s3Service } from '../services/s3Service.js'
import { VideoStatus } from '../types/index.js'
import { validateVideoId, validateVideoUpdate, validateSegmentRequest } from '../middleware/validation.js'
import { CacheMiddleware } from '../middleware/caching.js'

const router = express.Router()

// Search videos by title/description (PUT BEFORE /:id routes)
router.get('/search', CacheMiddleware.searchResults, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { q } = req.query
    
    if (!q || typeof q !== 'string') {
      res.status(400).json({
        error: 'Search query is required',
      })
      return
    }

    const videos = await videoService.searchVideos(q)
    
    res.json({
      data: videos,
      message: `Found ${videos.length} videos matching "${q}"`,
    })
  } catch (error) {
    console.error('Search videos error:', error)
    res.status(500).json({
      error: 'Failed to search videos',
    })
  }
})

// Get video statistics (PUT BEFORE /:id routes)
router.get('/stats/overview', CacheMiddleware.videoStats, async (_req: express.Request, res: express.Response): Promise<void> => {
  try {
    const stats = await videoService.getVideoStats()
    
    res.json({
      data: stats,
      message: 'Video statistics retrieved successfully',
    })
  } catch (error) {
    console.error('Get video stats error:', error)
    res.status(500).json({
      error: 'Failed to get video statistics',
    })
  }
})

// Get videos by status (PUT BEFORE /:id routes)
router.get('/status/:status', CacheMiddleware.videosByStatus, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { status } = req.params
    
    if (!Object.values(VideoStatus).includes(status as VideoStatus)) {
      res.status(400).json({
        error: 'Invalid status',
      })
      return
    }

    const videos = await videoService.getVideosByStatus(status as VideoStatus)
    
    res.json({
      data: videos,
      message: `Found ${videos.length} videos with status "${status}"`,
    })
  } catch (error) {
    console.error('Get videos by status error:', error)
    res.status(500).json({
      error: 'Failed to get videos by status',
    })
  }
})

// Get all videos
router.get('/', CacheMiddleware.videoList, async (_req: express.Request, res: express.Response): Promise<void> => {
  try {
    const videos = await videoService.getAllVideos()
    
    res.json({
      data: videos,
      message: 'Videos retrieved successfully',
    })
  } catch (error) {
    console.error('Get videos error:', error)
    res.status(500).json({
      error: 'Failed to retrieve videos',
    })
  }
})

// Get single video by ID
router.get('/:id', validateVideoId, CacheMiddleware.videoMetadata, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params
    const video = await videoService.getVideoById(id)

    if (!video) {
      res.status(404).json({
        error: 'Video not found',
      })
      return
    }

    res.json({
      data: video,
      message: 'Video retrieved successfully',
    })
  } catch (error) {
    console.error('Get video error:', error)
    res.status(500).json({
      error: 'Failed to retrieve video',
    })
  }
})

// Get video status
router.get('/:id/status', validateVideoId, CacheMiddleware.videoStatus, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params
    const video = await videoService.getVideoById(id)

    if (!video) {
      res.status(404).json({
        error: 'Video not found',
      })
      return
    }

    res.json({
      data: {
        status: video.status,
      },
      message: 'Video status retrieved successfully',
    })
  } catch (error) {
    console.error('Get video status error:', error)
    res.status(500).json({
      error: 'Failed to retrieve video status',
    })
  }
})

// Update video (title, description)
router.put('/:id', validateVideoId, validateVideoUpdate, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params
    const updates = req.body

    const video = await videoService.updateVideo(id, updates)

    if (!video) {
      res.status(404).json({
        error: 'Video not found',
      })
      return
    }

    res.json({
      data: video,
      message: 'Video updated successfully',
    })
  } catch (error) {
    console.error('Update video error:', error)
    res.status(500).json({
      error: 'Failed to update video',
    })
  }
})

// Delete video
router.delete('/:id', validateVideoId, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params
    const deleted = await videoService.deleteVideo(id)

    if (!deleted) {
      res.status(404).json({
        error: 'Video not found',
      })
      return
    }

    res.json({
      data: null,
      message: 'Video deleted successfully',
    })
  } catch (error) {
    console.error('Delete video error:', error)
    res.status(500).json({
      error: 'Failed to delete video',
    })
  }
})

// Get DASH manifest
router.get('/:id/manifest.mpd', validateVideoId, CacheMiddleware.manifestUrl, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { id } = req.params
    const video = await videoService.getVideoById(id)

    if (!video) {
      res.status(404).json({
        error: 'Video not found',
      })
      return
    }

    if (video.status !== VideoStatus.READY) {
      res.status(400).json({
        error: 'Video is not ready for streaming',
      })
      return
    }

    // Redirect to S3 manifest URL
    const manifestUrl = s3Service.getManifestUrl(id)
    res.redirect(manifestUrl)
  } catch (error) {
    console.error('Get manifest error:', error)
    res.status(500).json({
      error: 'Failed to retrieve manifest',
    })
  }
})

// Get video segments
router.get('/:id/segments/:segment', validateSegmentRequest, async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const { id, segment } = req.params
    const video = await videoService.getVideoById(id)

    if (!video) {
      res.status(404).json({
        error: 'Video not found',
      })
      return
    }

    if (video.status !== VideoStatus.READY) {
      res.status(400).json({
        error: 'Video is not ready for streaming',
      })
      return
    }

    // Redirect to S3 segment URL
    const segmentUrl = s3Service.getSegmentUrl(id, segment)
    res.redirect(segmentUrl)
  } catch (error) {
    console.error('Get segment error:', error)
    res.status(500).json({
      error: 'Failed to retrieve segment',
    })
  }
})

export default router