import mongoose from 'mongoose'
import { config } from './env.js'

// Connect to MongoDB with cost optimizations
export async function connectDatabase() {
  try {
    console.log('🗄️  Connecting to MongoDB...')
    
    // COST OPTIMIZATION: Connection options for better resource management
    const options: mongoose.ConnectOptions = {
      maxPoolSize: config.MONGODB_CONNECTION_POOL_SIZE,        // From config (default: 5)
      minPoolSize: 1,                                          // Minimum connections
      maxIdleTimeMS: config.MONGODB_MAX_IDLE_TIME,            // From config (default: 30000)
      serverSelectionTimeoutMS: config.MONGODB_SERVER_SELECTION_TIMEOUT, // From config (default: 5000)
      socketTimeoutMS: 45000,                                  // 45 seconds
      connectTimeoutMS: 10000,                                 // 10 seconds
    }

    await mongoose.connect(config.MONGODB_URI, options)
    console.log('✅ MongoDB connected successfully with cost optimizations')
    console.log(`📊 Pool size: ${config.MONGODB_CONNECTION_POOL_SIZE} connections (cost optimized)`)
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error)
    process.exit(1)
  }
}

// MongoDB connection event handlers
mongoose.connection.on('connected', () => {
  console.log('📦 Mongoose connected to MongoDB')
})

mongoose.connection.on('error', (error) => {
  console.error('❌ Mongoose connection error:', error)
})

mongoose.connection.on('disconnected', () => {
  console.log('📤 Mongoose disconnected from MongoDB')
})

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🛑 Received SIGINT, closing MongoDB connection...')
  await mongoose.connection.close()
  console.log('📴 MongoDB connection closed through app termination')
  process.exit(0)
})

process.on('SIGTERM', async () => {
  console.log('🛑 Received SIGTERM, closing MongoDB connection...')
  await mongoose.connection.close()
  console.log('✅ MongoDB connection closed')
  process.exit(0)
})

export async function initializeDatabase() {
  console.log('✅ MongoDB initialized (collections will be created automatically)')
}