import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { io, type Socket } from 'socket.io-client'

type SocketContextValue = {
  socket: Socket | null
  isConnected: boolean
  ensureConnected: () => Socket
  disconnect: () => void
}

const SocketContext = createContext<SocketContextValue | null>(null)

export function SocketProvider({ children }: { children: ReactNode }) {
  const socketRef = useRef<Socket | null>(null)
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  const getOrCreateSocket = useCallback(() => {
    if (socketRef.current) {
      console.debug('[socket][provider] reuse socket', {
        id: socketRef.current.id,
        connected: socketRef.current.connected,
      })
      return socketRef.current
    }

    console.debug('[socket][provider] creating socket instance')
    const nextSocket = io('http://localhost:8080', {
      path: '/socket.io/',
      autoConnect: false,
    })
    nextSocket.on('connect', () => {
      console.debug('[socket][provider] connected', { id: nextSocket.id })
      setIsConnected(true)
    })
    nextSocket.on('disconnect', (reason) => {
      console.debug('[socket][provider] disconnected', { id: nextSocket.id, reason })
      setIsConnected(false)
    })
    nextSocket.on('connect_error', (error) => {
      console.debug('[socket][provider] connect_error', {
        message: error.message,
        name: error.name,
      })
    })
    socketRef.current = nextSocket
    setSocket(nextSocket)
    return nextSocket
  }, [])

  const ensureConnected = useCallback(() => {
    const current = getOrCreateSocket()
    if (!current.connected) {
      console.debug('[socket][provider] connecting socket...')
      current.connect()
    } else {
      console.debug('[socket][provider] already connected', { id: current.id })
    }
    return current
  }, [getOrCreateSocket])

  const disconnect = useCallback(() => {
    const current = socketRef.current
    if (current) {
      console.debug('[socket][provider] disconnect() called', { id: current.id, connected: current.connected })
      current.disconnect()
      setIsConnected(false)
    }
  }, [])

  const value = useMemo(
    () => ({
      socket,
      isConnected,
      ensureConnected,
      disconnect,
    }),
    [socket, isConnected, ensureConnected, disconnect],
  )

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
}

export function useAppSocket() {
  const ctx = useContext(SocketContext)
  if (!ctx) {
    throw new Error('useAppSocket must be used inside SocketProvider')
  }
  return ctx
}
