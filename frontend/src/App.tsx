import { useCallback, useEffect, useRef, useState } from 'react'
import { Route, Routes, useMatch, useNavigate } from 'react-router-dom'
import { CreateNJoin } from './Layouts/CreateNJoin/CreateNJoin'
import { Room } from './Layouts/Room/Room'
import { SocketProvider, useAppSocket } from './state/SocketProvider'
import { CommentBox } from './Layouts/Room/CommentBox'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { setCommentOpen } from './store/uiSlice'
import type { RoomSession, RoomState } from './Layouts/roomTypes'

export default function App() {
  return (
    <SocketProvider>
      <AppShell />
    </SocketProvider>
  )
}

function AppShell() {
  const { ensureConnected, isConnected, disconnect, socket } = useAppSocket()
  const dispatch = useAppDispatch()
  const commentOpen = useAppSelector((state) => state.ui.commentOpen)
  const [roomSession, setRoomSession] = useState<RoomSession | null>(null)
  const navigate = useNavigate()
  const roomMatch = useMatch('/:roomId')
  const roomId = roomMatch?.params.roomId
  const previousRoomIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    ensureConnected()
  }, [ensureConnected])

  const handleJoined = useCallback(
    (room: RoomState, name: string) => {
      setRoomSession({ room, name })
      navigate(`/${room.id}`, { replace: true })
    },
    [navigate],
  )

  useEffect(() => {
    const previous = previousRoomIdRef.current
    if (previous && !roomId && roomSession) {
      console.debug('[socket][room] route transition room->home, disconnecting socket')
      if (socket) {
        socket.emit('room:leave')
      }
      dispatch(setCommentOpen(false))
      disconnect()
      setRoomSession(null)
    }
    previousRoomIdRef.current = roomId
  }, [roomId, roomSession, socket, disconnect, dispatch])

  const handleCommentSend = (message: string) => {
    const nextMessage = message.trim()
    if (!nextMessage) return
    const activeSocket = ensureConnected()
    activeSocket.emit('room:message', { message: nextMessage })
  }

  const shouldShowCommentBox = commentOpen && isConnected

  if (!isConnected) {
    return <CreateNJoin connecting onJoined={handleJoined} />
  }

  if (!roomSession) {
    return (
      <Routes>
        <Route path="/" element={<CreateNJoin connecting={false} onJoined={handleJoined} />} />
        <Route path="/:roomId" element={<CreateNJoin connecting={false} onJoined={handleJoined} />} />
      </Routes>
    )
  }

  return (
    <>
      <Room roomSession={roomSession} />
      <CommentBox
        open={shouldShowCommentBox}
        onClose={() => dispatch(setCommentOpen(false))}
        onSend={handleCommentSend}
      />
    </>
  )
}
