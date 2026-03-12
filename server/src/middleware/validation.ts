import { body, param, validationResult } from 'express-validator'
import express from 'express'

export const handleValidationErrors = (
  req: express.Request, 
  res: express.Response, 
  next: express.NextFunction
): void => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    })
    return
  }
  next()
}

export const validateUploadRequest = [
  body('fileName')
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('File name must be between 1 and 255 characters'),
  
  body('fileType')
    .isString()
    .matches(/^video\/(mp4|mov|avi|quicktime)$/)
    .withMessage('File type must be a valid video format (mp4, mov, avi)'),
  
  body('fileSize')
    .optional()
    .isInt({ min: 1, max: 5 * 1024 * 1024 * 1024 }) // 5GB max
    .withMessage('File size must be between 1 byte and 5GB'),
  
  handleValidationErrors,
]

export const validateVideoUpdate = [
  body('title')
    .optional()
    .isString()
    .isLength({ min: 1, max: 255 })
    .withMessage('Title must be between 1 and 255 characters'),
  
  body('description')
    .optional()
    .isString()
    .isLength({ max: 1000 })
    .withMessage('Description must be less than 1000 characters'),
  
  handleValidationErrors,
]

export const validateVideoId = [
  param('id')
    .isUUID()
    .withMessage('Video ID must be a valid UUID'),
  
  handleValidationErrors,
]

export const validateSegmentRequest = [
  param('id')
    .isUUID()
    .withMessage('Video ID must be a valid UUID'),
  
  param('segment')
    .matches(/^[a-zA-Z0-9\-_.]+\.(m4s|mpd)$/)
    .withMessage('Segment must be a valid DASH segment file'),
  
  handleValidationErrors,
]