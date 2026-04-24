import { Room } from './Layouts/Room/Room'
import { Route, Routes } from 'react-router-dom'
import { SocketProvider, useAppSocket } from './state/SocketProvider'
import { CommentBox } from './Layouts/Room/CommentBox'
import { useAppDispatch, useAppSelector } from './store/hooks'
import { setCommentOpen } from './store/uiSlice'

export default function App() {
  return (
    <SocketProvider>
      <AppShell />
    </SocketProvider>
  )
}

function AppShell() {
  const { ensureConnected, isConnected } = useAppSocket()
  const dispatch = useAppDispatch()
  const commentOpen = useAppSelector((state) => state.ui.commentOpen)

  const handleCommentSend = (message: string) => {
    const nextMessage = message.trim()
    if (!nextMessage) return
    const activeSocket = ensureConnected()
    activeSocket.emit('room:message', { message: nextMessage })
  }

  const shouldShowCommentBox = commentOpen && isConnected

  return (
    <>
      <Routes>
        <Route path="/" element={<Room />} />
        <Route path="/:roomId" element={<Room />} />
      </Routes>

      <CommentBox
        open={shouldShowCommentBox}
        onClose={() => dispatch(setCommentOpen(false))}
        onSend={handleCommentSend}
      />
    </>
  )
}
