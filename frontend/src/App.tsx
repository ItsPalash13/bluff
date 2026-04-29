import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Route, Routes, useMatch, useNavigate } from 'react-router-dom'
import { CreateNJoin } from './Layouts/CreateNJoin/CreateNJoin'
import { Room } from './Layouts/Room/Room'
import { SocketProvider, useAppSocket } from './state/SocketProvider'
import { CommentBox } from './Layouts/Room/CommentBox'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { setCommentOpen } from './store/uiSlice'
import type { RoomSession, RoomState } from './Layouts/roomTypes'
import './App.css'
import logo from './assets/logo.png'

const roomSessionStorageKey = (roomId: string) => `bluff:session:${roomId.toUpperCase()}`

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

  const handleJoined = useCallback(
    (room: RoomState, name: string, playerId: string) => {
      setRoomSession({ room, name, playerId })
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
      window.localStorage.removeItem(roomSessionStorageKey(roomSession.room.id))
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
    dispatch(setCommentOpen(false))
  }

  const shouldShowCommentBox = commentOpen && isConnected

  const content = !roomSession ? (
    <Routes>
      <Route path="/" element={<CreateNJoin connecting={false} onJoined={handleJoined} />} />
      <Route path="/:roomId" element={<CreateNJoin connecting={false} onJoined={handleJoined} />} />
    </Routes>
  ) : (
    <>
      <Room roomSession={roomSession} />
      {shouldShowCommentBox ? (
        <div className="comment-box-overlay" role="dialog" aria-label="Chat">
          <div
            className="comment-box-overlay__backdrop"
            role="presentation"
            onClick={() => dispatch(setCommentOpen(false))}
          />
          <div className="comment-box-overlay__slot">
            <CommentBox
              open
              onClose={() => dispatch(setCommentOpen(false))}
              onSend={handleCommentSend}
            />
          </div>
        </div>
      ) : null}
    </>
  )

  return (
    <>
      <div className="app-logo-tab-wrap">
        <Link to="/" className="app-logo-tab" aria-label="Go to home">
          <img src={logo} alt="" className="app-logo-tab__img" />
        </Link>
      </div>
      {content}
    </>
  )
}
