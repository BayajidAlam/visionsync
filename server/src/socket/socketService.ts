import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { redisClient } from '../config/redis.js';

const BUFFER_KEY_PREFIX = 'video:msgbuf:';
const BUFFER_TTL_SECONDS = 1800; // 30 minutes
const MAX_BUFFERED_MESSAGES = 20;

interface RoomStats {
  lastActivity: Date;
  connectionCount: number;
}

interface ConnectionLimits {
  maxConnections: number;
  maxConnectionsPerIp: number;
  maxRoomsPerConnection: number;
  roomCleanupInterval: number;
  roomInactivityTimeout: number;
}

class SocketService {
  private io: Server | null = null;
  private roomStats = new Map<string, RoomStats>();
  private connectionRooms = new Map<string, Set<string>>();
  private ipConnections = new Map<string, number>();
  private cleanupInterval: NodeJS.Timeout | null = null;

  private readonly limits: ConnectionLimits = {
    maxConnections: 100,
    maxConnectionsPerIp: 5,
    maxRoomsPerConnection: 10,
    roomCleanupInterval: 5 * 60 * 1000,
    roomInactivityTimeout: 30 * 60 * 1000,
  };

  initialize(server: HttpServer): void {
    this.io = new Server(server, {
      cors: {
        origin: config.FRONTEND_URL,
        methods: ['GET', 'POST'],
      },
      transports: ['websocket', 'polling'],
      pingTimeout: 60000,
      pingInterval: 25000,
      maxHttpBufferSize: 1e6,
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000,
        skipMiddlewares: true,
      },
    });

    this.setupEventHandlers();
    this.startRoomCleanup();
    logger.info('Socket.IO initialized');
  }

  private getClientIp(socket: Socket): string {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    return socket.handshake.address;
  }

  private async bufferMessage(videoId: string, payload: object): Promise<void> {
    if (!redisClient.isOpen) return;
    try {
      const key = `${BUFFER_KEY_PREFIX}${videoId}`;
      await redisClient.rPush(key, JSON.stringify(payload));
      await redisClient.lTrim(key, -MAX_BUFFERED_MESSAGES, -1);
      await redisClient.expire(key, BUFFER_TTL_SECONDS);
    } catch {
      // Non-fatal — buffer best-effort
    }
  }

  private async replayBufferedMessages(socket: Socket, videoId: string): Promise<void> {
    if (!redisClient.isOpen) return;
    try {
      const key = `${BUFFER_KEY_PREFIX}${videoId}`;
      const messages = await redisClient.lRange(key, 0, -1);
      if (messages.length === 0) return;
      messages.forEach((raw) => {
        try { socket.emit('video-status', JSON.parse(raw)); } catch { /* skip malformed */ }
      });
      logger.info('Replayed buffered messages', { videoId, count: messages.length });
    } catch {
      // Non-fatal
    }
  }

  private setupEventHandlers(): void {
    if (!this.io) return;

    this.io.engine.on('connection_error', (err) => {
      logger.warn('Socket connection error', { url: err.req?.url, code: err.code, message: err.message });
    });

    this.io.on('connection', (socket) => {
      const ip = this.getClientIp(socket);

      // Global connection limit
      if (this.getConnectionCount() > this.limits.maxConnections) {
        logger.warn('Global connection limit exceeded', { socketId: socket.id });
        socket.emit('error', 'Server capacity reached. Try again later.');
        socket.disconnect(true);
        return;
      }

      // Per-IP connection limit
      const ipCount = this.ipConnections.get(ip) ?? 0;
      if (ipCount >= this.limits.maxConnectionsPerIp) {
        logger.warn('Per-IP connection limit exceeded', { ip, count: ipCount });
        socket.emit('error', 'Too many connections from your network.');
        socket.disconnect(true);
        return;
      }
      this.ipConnections.set(ip, ipCount + 1);

      this.connectionRooms.set(socket.id, new Set());
      logger.info('Client connected', { socketId: socket.id, ip, total: this.getConnectionCount() });

      socket.on('join-user', (userId: string) => {
        this.joinRoom(socket, `user-${userId}`, 'user');
      });

      socket.on('join-video', async (videoId: string) => {
        this.joinRoom(socket, `video-${videoId}`, 'video');
        await this.replayBufferedMessages(socket, videoId);
      });

      socket.on('leave-video', (videoId: string) => {
        this.leaveRoom(socket, `video-${videoId}`);
      });

      socket.on('disconnect', (reason) => {
        logger.info('Client disconnected', { socketId: socket.id, reason });
        this.handleDisconnection(socket, ip);
      });

      const inactivityTimeout = setTimeout(() => {
        if (socket.connected) {
          socket.emit('error', 'Connection timeout due to inactivity');
          socket.disconnect(true);
        }
      }, 10 * 60 * 1000);

      socket.on('disconnect', () => clearTimeout(inactivityTimeout));
      socket.onAny(() => clearTimeout(inactivityTimeout));
    });
  }

  private joinRoom(socket: Socket, roomName: string, roomType: 'user' | 'video'): void {
    const socketRooms = this.connectionRooms.get(socket.id);
    if (!socketRooms) return;

    if (socketRooms.size >= this.limits.maxRoomsPerConnection) {
      socket.emit('error', 'Too many rooms joined. Leave some rooms first.');
      return;
    }

    socket.join(roomName);
    socketRooms.add(roomName);
    this.updateRoomStats(roomName);
    logger.info('Client joined room', { socketId: socket.id, room: roomName, type: roomType });
  }

  private leaveRoom(socket: Socket, roomName: string): void {
    const socketRooms = this.connectionRooms.get(socket.id);
    if (!socketRooms) return;

    socket.leave(roomName);
    socketRooms.delete(roomName);

    const room = this.io?.sockets.adapter.rooms.get(roomName);
    if (!room || room.size === 0) {
      this.roomStats.delete(roomName);
    }
  }

  private handleDisconnection(socket: Socket, ip: string): void {
    const socketRooms = this.connectionRooms.get(socket.id);
    if (socketRooms) {
      for (const roomName of socketRooms) {
        socket.leave(roomName);
        const room = this.io?.sockets.adapter.rooms.get(roomName);
        if (!room || room.size === 0) {
          this.roomStats.delete(roomName);
        }
      }
      this.connectionRooms.delete(socket.id);
    }

    const ipCount = this.ipConnections.get(ip) ?? 1;
    if (ipCount <= 1) this.ipConnections.delete(ip);
    else this.ipConnections.set(ip, ipCount - 1);
  }

  private updateRoomStats(roomName: string): void {
    const existing = this.roomStats.get(roomName);
    this.roomStats.set(roomName, {
      lastActivity: new Date(),
      connectionCount: (existing?.connectionCount ?? 0) + 1,
    });
  }

  private startRoomCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveRooms();
    }, this.limits.roomCleanupInterval);
  }

  private cleanupInactiveRooms(): void {
    if (!this.io) return;

    const now = Date.now();
    const toClean: string[] = [];

    for (const [roomName, stats] of this.roomStats.entries()) {
      const inactive = now - stats.lastActivity.getTime() > this.limits.roomInactivityTimeout;
      const room = this.io.sockets.adapter.rooms.get(roomName);
      if (inactive && (!room || room.size === 0)) {
        toClean.push(roomName);
      }
    }

    if (toClean.length > 0) {
      toClean.forEach((r) => {
        this.roomStats.delete(r);
        this.io?.in(r).disconnectSockets(true);
      });
      logger.info('Cleaned inactive rooms', { count: toClean.length });
    }
  }

  emitVideoStatus(videoId: string, status: string, data?: Record<string, unknown>): void {
    if (!this.io) return;

    const roomName = `video-${videoId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);

    const payload = {
      videoId,
      status,
      timestamp: new Date().toISOString(),
      ...data,
    };

    if (!room || room.size === 0) {
      // No active listeners — buffer for replay on reconnect
      this.bufferMessage(videoId, payload).catch(() => { /* swallow */ });
      return;
    }

    this.io.to(roomName).emit('video-status', payload);
    this.updateRoomStats(roomName);
    logger.info('Emitted video status', { videoId, status, listeners: room.size });
  }

  emitProgress(videoId: string, progress: number): void {
    if (!this.io) return;
    const roomName = `video-${videoId}`;
    const room = this.io.sockets.adapter.rooms.get(roomName);
    if (!room || room.size === 0 || progress % 10 !== 0) return;

    this.io.to(roomName).emit('processing-progress', {
      videoId,
      progress,
      timestamp: new Date().toISOString(),
    });
    this.updateRoomStats(roomName);
  }

  getStats() {
    const rooms = this.io?.sockets.adapter.rooms ?? new Map();
    const activeRooms = Array.from(rooms.entries())
      .filter(([name]) => !this.io?.sockets.sockets.has(name))
      .map(([name, room]) => ({
        name,
        size: room.size,
        lastActivity: this.roomStats.get(name)?.lastActivity ?? new Date(),
      }));

    return {
      connections: this.getConnectionCount(),
      rooms: activeRooms.length,
      roomDetails: activeRooms,
      memoryUsage: {
        roomStats: this.roomStats.size,
        connectionTracking: this.connectionRooms.size,
        ipTracking: this.ipConnections.size,
      },
    };
  }

  getConnectionCount(): number {
    return this.io?.engine.clientsCount ?? 0;
  }

  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    if (this.io) {
      this.io.emit('server-shutdown', { message: 'Server is shutting down. Please refresh to reconnect.' });
      this.io.close((err) => {
        if (err) logger.error('Error closing Socket.IO', { error: err.message });
        else logger.info('Socket.IO server closed');
      });
    }

    this.roomStats.clear();
    this.connectionRooms.clear();
    this.ipConnections.clear();
  }

  forceCleanup(): void {
    this.cleanupInactiveRooms();
    if (this.io) {
      const allRooms = this.io.sockets.adapter.rooms;
      for (const [roomName, room] of allRooms.entries()) {
        if (!this.io.sockets.sockets.has(roomName) && room.size === 0) {
          this.roomStats.delete(roomName);
        }
      }
    }
  }
}

export const socketService = new SocketService();
