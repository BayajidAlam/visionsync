// server/src/socket/socketService.ts - FIXED with memory management
import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { config } from '../config/env.js';

interface RoomStats {
  lastActivity: Date;
  connectionCount: number;
}

interface ConnectionLimits {
  maxConnections: number;
  maxRoomsPerConnection: number;
  roomCleanupInterval: number;
  roomInactivityTimeout: number;
}

class SocketService {
  private io: Server | null = null;
  private roomStats = new Map<string, RoomStats>();
  private connectionRooms = new Map<string, Set<string>>(); // Track rooms per connection
  private cleanupInterval: NodeJS.Timeout | null = null;
  
  private readonly limits: ConnectionLimits = {
    maxConnections: 100, // Budget-friendly connection limit
    maxRoomsPerConnection: 10, // Prevent room spam per user
    roomCleanupInterval: 5 * 60 * 1000, // 5 minutes
    roomInactivityTimeout: 30 * 60 * 1000, // 30 minutes
  };

  initialize(server: HttpServer): void {
    this.io = new Server(server, {
      cors: {
        origin: config.FRONTEND_URL,
        methods: ['GET', 'POST']
      },
      // MEMORY OPTIMIZATION: Enhanced limits
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6, // 1MB
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
        skipMiddlewares: true,
      },
    });

    this.setupEventHandlers();
    this.startRoomCleanup();
    console.log('📡 Socket.IO initialized with memory management');
  }

  private setupEventHandlers(): void {
    if (!this.io) return;

    // CONNECTION LIMITING
    this.io.engine.on('connection_error', (err) => {
      console.log('Connection error:', err.req?.url, err.code, err.message);
    });

    this.io.on('connection', (socket) => {
      // Check connection limit
      if (this.getConnectionCount() > this.limits.maxConnections) {
        console.warn(`⚠️ Connection limit exceeded. Rejecting ${socket.id}`);
        socket.emit('error', 'Server capacity reached. Try again later.');
        socket.disconnect(true);
        return;
      }

      console.log(`🔌 Client connected: ${socket.id} (${this.getConnectionCount()}/${this.limits.maxConnections})`);
      
      // Initialize connection room tracking
      this.connectionRooms.set(socket.id, new Set());

      // Enhanced room management
      socket.on('join-user', (userId: string) => {
        this.joinRoom(socket, `user-${userId}`, 'user');
      });

      socket.on('join-video', (videoId: string) => {
        this.joinRoom(socket, `video-${videoId}`, 'video');
      });

      socket.on('leave-video', (videoId: string) => {
        this.leaveRoom(socket, `video-${videoId}`);
      });

      // MEMORY FIX: Cleanup on disconnect
      socket.on('disconnect', (reason) => {
        console.log(`🔌 Client disconnected: ${socket.id} (reason: ${reason})`);
        this.handleDisconnection(socket);
      });

      // Add connection timeout for inactive clients
      const inactivityTimeout = setTimeout(() => {
        if (socket.connected) {
          console.log(`⏰ Disconnecting inactive client: ${socket.id}`);
          socket.emit('error', 'Connection timeout due to inactivity');
          socket.disconnect(true);
        }
      }, 10 * 60 * 1000); // 10 minutes

      socket.on('disconnect', () => {
        clearTimeout(inactivityTimeout);
      });

      // Reset inactivity timer on any message
      socket.onAny(() => {
        clearTimeout(inactivityTimeout);
      });
    });
  }

  // Smart room joining with limits
  private joinRoom(socket: Socket, roomName: string, roomType: 'user' | 'video'): void {
    const socketRooms = this.connectionRooms.get(socket.id);
    if (!socketRooms) return;

    // Check room limit per connection
    if (socketRooms.size >= this.limits.maxRoomsPerConnection) {
      console.warn(`⚠️ Room limit exceeded for ${socket.id}. Cannot join ${roomName}`);
      socket.emit('error', `Too many rooms joined. Leave some rooms first.`);
      return;
    }

    // Join the room
    socket.join(roomName);
    socketRooms.add(roomName);

    // Update room stats
    this.updateRoomStats(roomName);
    
    console.log(`${roomType === 'video' ? '🎬' : '👤'} ${socket.id} joined ${roomName} (${socketRooms.size}/${this.limits.maxRoomsPerConnection} rooms)`);
  }

  // Leave room and cleanup
  private leaveRoom(socket: Socket, roomName: string): void {
    const socketRooms = this.connectionRooms.get(socket.id);
    if (!socketRooms) return;

    socket.leave(roomName);
    socketRooms.delete(roomName);
    
    // Check if room is now empty
    const room = this.io?.sockets.adapter.rooms.get(roomName);
    if (!room || room.size === 0) {
      this.roomStats.delete(roomName);
      console.log(`🧹 Cleaned up empty room: ${roomName}`);
    }
    
    console.log(`👋 ${socket.id} left ${roomName}`);
  }

  // Handle client disconnection cleanup
  private handleDisconnection(socket: Socket): void {
    const socketRooms = this.connectionRooms.get(socket.id);
    
    if (socketRooms) {
      // Leave all rooms and check for cleanup
      for (const roomName of socketRooms) {
        socket.leave(roomName);
        
        // Check if room is empty after this client leaves
        const room = this.io?.sockets.adapter.rooms.get(roomName);
        if (!room || room.size === 0) {
          this.roomStats.delete(roomName);
          console.log(`🧹 Auto-cleaned empty room: ${roomName}`);
        }
      }
      
      // Remove connection tracking
      this.connectionRooms.delete(socket.id);
    }
  }

  // Update room activity stats
  private updateRoomStats(roomName: string): void {
    const existing = this.roomStats.get(roomName);
    this.roomStats.set(roomName, {
      lastActivity: new Date(),
      connectionCount: (existing?.connectionCount || 0) + 1
    });
  }

  // Periodic cleanup of inactive rooms
  private startRoomCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveRooms();
    }, this.limits.roomCleanupInterval);

    console.log(`🧹 Room cleanup scheduled every ${this.limits.roomCleanupInterval / 1000}s`);
  }

  private cleanupInactiveRooms(): void {
    if (!this.io) return;

    const now = new Date();
    const roomsToClean: string[] = [];

    // Find inactive rooms
    for (const [roomName, stats] of this.roomStats.entries()) {
      const inactiveTime = now.getTime() - stats.lastActivity.getTime();
      
      if (inactiveTime > this.limits.roomInactivityTimeout) {
        // Check if room actually exists and is empty
        const room = this.io.sockets.adapter.rooms.get(roomName);
        if (!room || room.size === 0) {
          roomsToClean.push(roomName);
        }
      }
    }

    // Clean up inactive rooms
    if (roomsToClean.length > 0) {
      console.log(`🧹 Cleaning up ${roomsToClean.length} inactive rooms`);
      roomsToClean.forEach(roomName => {
        this.roomStats.delete(roomName);
        // Force cleanup any remaining sockets
        this.io?.in(roomName).disconnectSockets(true);
      });
    }

    // Log stats periodically
    if (roomsToClean.length > 0) {
      console.log(`📊 Room stats: ${this.roomStats.size} active rooms, ${this.getConnectionCount()} connections`);
    }
  }

  // Enhanced emit with room validation
  emitVideoStatus(videoId: string, status: string, data?: any): void {
    if (!this.io) return;

    const roomName = `video-${videoId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);

    // Only emit if room exists and has listeners
    if (!room || room.size === 0) {
      console.log(`📡 No listeners for ${roomName}, skipping emission`);
      return;
    }

    const payload = {
      videoId,
      status,
      timestamp: new Date().toISOString(),
      ...data
    };

    this.io.to(roomName).emit('video-status', payload);
    this.updateRoomStats(roomName);
    
    console.log(`📡 Emitted video-status for ${videoId}: ${status} (${room.size} listeners)`);
  }

  // Enhanced progress emission with throttling
  emitProgress(videoId: string, progress: number): void {
    if (!this.io) return;

    const roomName = `video-${videoId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);

    // Only emit if room exists and at 10% intervals
    if ((!room || room.size === 0) || progress % 10 !== 0) {
      return;
    }

    this.io.to(roomName).emit('processing-progress', {
      videoId,
      progress,
      timestamp: new Date().toISOString()
    });

    this.updateRoomStats(roomName);
  }

  // Memory and performance monitoring
  getStats() {
    const rooms = this.io?.sockets.adapter.rooms || new Map();
    const activeRooms = Array.from(rooms.entries())
      .filter(([name, room]) => !this.io?.sockets.sockets.has(name)) // Filter out socket IDs
      .map(([name, room]) => ({
        name,
        size: room.size,
        lastActivity: this.roomStats.get(name)?.lastActivity || new Date()
      }));

    return {
      connections: this.getConnectionCount(),
      rooms: activeRooms.length,
      roomDetails: activeRooms,
      memoryUsage: {
        roomStats: this.roomStats.size,
        connectionTracking: this.connectionRooms.size
      }
    };
  }

  // Connection count (existing)
  getConnectionCount(): number {
    return this.io?.engine.clientsCount || 0;
  }

  // Graceful shutdown
  shutdown(): void {
    console.log('📴 Shutting down Socket service...');
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.io) {
      // Notify all clients
      this.io.emit('server-shutdown', { 
        message: 'Server is shutting down. Please refresh to reconnect.' 
      });
      
      // Close all connections
      this.io.close((err) => {
        if (err) {
          console.error('Error closing Socket.IO:', err);
        } else {
          console.log('✅ Socket.IO server closed');
        }
      });
    }

    // Clear memory
    this.roomStats.clear();
    this.connectionRooms.clear();
  }

  // Force cleanup command (for admin/debugging)
  forceCleanup(): void {
    console.log('🔧 Force cleanup requested');
    this.cleanupInactiveRooms();
    
    // Remove orphaned rooms (rooms with no actual connections)
    if (this.io) {
      const allRooms = this.io.sockets.adapter.rooms;
      for (const [roomName, room] of allRooms.entries()) {
        // Skip socket ID rooms
        if (!this.io.sockets.sockets.has(roomName) && room.size === 0) {
          this.roomStats.delete(roomName);
        }
      }
    }
  }
}

export const socketService = new SocketService();