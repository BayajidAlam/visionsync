// client/src/hooks/useSocket.ts - FIXED VERSION with proper cleanup
import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

interface VideoStatusEvent {
  videoId: string;
  status: string;
  timestamp: string;
  manifestUrl?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  message?: string;
}

interface ProgressEvent {
  videoId: string;
  progress: number;
  timestamp: string;
}

interface ConnectionState {
  isConnected: boolean;
  isConnecting: boolean;
  connectionError: string | null;
  reconnectAttempt: number;
}

const DEFAULT_SERVER_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

export const useSocket = (serverUrl: string = DEFAULT_SERVER_URL) => {
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isUnmountedRef = useRef(false);
  
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    isConnected: false,
    isConnecting: false,
    connectionError: null,
    reconnectAttempt: 0
  });
  
  const [videoStatus, setVideoStatus] = useState<VideoStatusEvent | null>(null);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socketRef.current) {
      console.log('🧹 Cleaning up socket connection');
      
      // Remove all listeners to prevent memory leaks
      socketRef.current.removeAllListeners();
      
      // Disconnect and cleanup
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    // Reset state
    setConnectionState({
      isConnected: false,
      isConnecting: false,
      connectionError: null,
      reconnectAttempt: 0
    });
    setVideoStatus(null);
    setProgress(null);
  }, []);

  // Connect function with retry logic
  const connect = useCallback(() => {
    if (isUnmountedRef.current || socketRef.current?.connected) {
      return;
    }

    setConnectionState(prev => ({
      ...prev,
      isConnecting: true,
      connectionError: null
    }));

    console.log('🔌 Connecting to Socket.IO server:', serverUrl);
    
    socketRef.current = io(serverUrl, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
      reconnection: false, // Handle manually for better control
      forceNew: true, // Ensure clean connection
    });

    const socket = socketRef.current;

    // Connection success
    socket.on('connect', () => {
      if (isUnmountedRef.current) {
        socket.disconnect();
        return;
      }

      console.log('✅ Connected to Socket.IO server');
      setConnectionState({
        isConnected: true,
        isConnecting: false,
        connectionError: null,
        reconnectAttempt: 0
      });
    });

    // Connection lost
    socket.on('disconnect', (reason) => {
      console.log('❌ Disconnected from Socket.IO server:', reason);
      
      setConnectionState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false
      }));

      // Only auto-reconnect for certain disconnect reasons
      if (!isUnmountedRef.current && 
          reason === 'io server disconnect' || 
          reason === 'transport close' ||
          reason === 'transport error') {
        
        scheduleReconnect();
      }
    });

    // Connection error
    socket.on('connect_error', (error) => {
      console.error('🔴 Socket connection error:', error.message);
      
      setConnectionState(prev => ({
        ...prev,
        isConnected: false,
        isConnecting: false,
        connectionError: error.message
      }));

      if (!isUnmountedRef.current) {
        scheduleReconnect();
      }
    });

    // Video status updates
    socket.on('video-status', (data: VideoStatusEvent) => {
      if (!isUnmountedRef.current) {
        console.log('📡 Received video status:', data);
        setVideoStatus(data);
      }
    });

    // Processing progress updates  
    socket.on('processing-progress', (data: ProgressEvent) => {
      if (!isUnmountedRef.current) {
        console.log('📊 Received progress:', data);
        setProgress(data);
      }
    });

    // General error handling
    socket.on('error', (error: any) => {
      console.error('Socket error:', error);
    });

  }, [serverUrl]);

  // Smart reconnect with exponential backoff
  const scheduleReconnect = useCallback(() => {
    if (isUnmountedRef.current || reconnectTimeoutRef.current) {
      return;
    }

    setConnectionState(prev => {
      const newAttempt = prev.reconnectAttempt + 1;
      
      // Give up after 5 attempts
      if (newAttempt > 5) {
        console.log('🔴 Max reconnection attempts reached');
        return {
          ...prev,
          connectionError: 'Connection failed after multiple attempts'
        };
      }

      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = Math.pow(2, newAttempt - 1) * 1000;
      
      console.log(`🔄 Scheduling reconnect attempt ${newAttempt} in ${delay}ms`);
      
      reconnectTimeoutRef.current = setTimeout(() => {
        reconnectTimeoutRef.current = null;
        if (!isUnmountedRef.current) {
          cleanup();
          connect();
        }
      }, delay);

      return {
        ...prev,
        reconnectAttempt: newAttempt,
        isConnecting: true
      };
    });
  }, [cleanup, connect]);

  // Manual reconnect function
  const reconnect = useCallback(() => {
    console.log('🔄 Manual reconnect requested');
    cleanup();
    setConnectionState(prev => ({ ...prev, reconnectAttempt: 0 }));
    connect();
  }, [cleanup, connect]);

  // Initialize connection
  useEffect(() => {
    isUnmountedRef.current = false;
    connect();

    // Cleanup on unmount
    return () => {
      console.log('🧹 Component unmounting, cleaning up socket');
      isUnmountedRef.current = true;
      cleanup();
    };
  }, [connect, cleanup]);

  // Room management functions
  const joinVideo = useCallback((videoId: string) => {
    if (socketRef.current?.connected && !isUnmountedRef.current) {
      socketRef.current.emit('join-video', videoId);
      console.log(`🎬 Joined video room: ${videoId}`);
    } else {
      console.warn('Cannot join video room - socket not connected');
    }
  }, []);

  const leaveVideo = useCallback((videoId: string) => {
    if (socketRef.current?.connected && !isUnmountedRef.current) {
      socketRef.current.emit('leave-video', videoId);
      console.log(`👋 Left video room: ${videoId}`);
    }
  }, []);

  const joinUser = useCallback((userId: string) => {
    if (socketRef.current?.connected && !isUnmountedRef.current) {
      socketRef.current.emit('join-user', userId);
      console.log(`👤 Joined user room: ${userId}`);
    }
  }, []);

  // Clear status when needed (e.g., when navigating away from video)
  const clearVideoStatus = useCallback(() => {
    setVideoStatus(null);
  }, []);

  const clearProgress = useCallback(() => {
    setProgress(null);  
  }, []);

  return {
    // Connection state
    ...connectionState,
    
    // Event data
    videoStatus,
    progress,
    
    // Actions
    joinVideo,
    leaveVideo, 
    joinUser,
    reconnect,
    clearVideoStatus,
    clearProgress,
    
    // Direct socket access (use sparingly)
    socket: socketRef.current,
  };
};