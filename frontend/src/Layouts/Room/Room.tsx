import { useEffect, useState } from 'react'
import { Box, Button } from '@mui/material'
import ChatIcon from '@mui/icons-material/Chat'
import { useMatch } from 'react-router-dom'
import { Lobby } from './Lobby'
import { RoomSettings } from './RoomSettings'
import { useAppSocket } from '../../state/SocketProvider'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCommentOpen } from '../../store/uiSlice'
import type { RoomMessage, RoomSession, RoomState } from '../roomTypes'
import '../../App.css'

type RoomProps = {
  roomSession: RoomSession
}

export function Room({ roomSession }: RoomProps) {
  const { socket } = useAppSocket()
  const dispatch = useAppDispatch()
  const commentOpen = useAppSelector((state) => state.ui.commentOpen)
  const [roomState, setRoomState] = useState<RoomState>(roomSession.room)
  const [lastMessage, setLastMessage] = useState<RoomMessage | null>(null)
  const match = useMatch('/:roomId')
  const roomId = match?.params.roomId
  const shareUrl = `${window.location.origin}/${roomState.id}`
  const isHost = Boolean(socket && roomState.hostSocketId === socket.id)
  const roomStatus = roomState.status || 'waiting'
  const canEdit = isHost && roomStatus === 'waiting'
  const minPlayers = Math.min(4, Math.max(2, roomState.users.length)) as 2 | 3 | 4

  useEffect(() => {
    if (!socket) {
      return
    }

    const onRoomState = (nextState: RoomState) => {
      console.debug('[socket][room] room:state', nextState)
      if (nextState.id === roomId || nextState.id === roomState.id) {
        setRoomState(nextState)
      }
    }

    const onRoomMessage = (message: RoomMessage) => {
      console.debug('[socket][room] room:message', message)
      setLastMessage(message)
    }

    socket.on('room:state', onRoomState)
    socket.on('room:message', onRoomMessage)

    return () => {
      socket.off('room:state', onRoomState)
      socket.off('room:message', onRoomMessage)
    }
  }, [socket, roomId, roomState.id])

  const handleSettingsChange = (p: { turnSeconds: number; capacity: number; totalCards: number }) => {
    if (!socket) return
    socket.emit('room:updateSettings', p)
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch (error) {
      console.error('Failed to copy room link', error)
    }
  }

  return (
    <Box className="lobby-center room-stage">
      <Lobby
        room={roomState}
        lastMessage={lastMessage}
      />

      <Box className="room-settings-anchor">
        <RoomSettings
          canEdit={canEdit}
          roomStatus={roomStatus}
          turnSeconds={roomState.turnSeconds ?? 30}
          totalCards={roomState.totalCards ?? 26}
          capacity={roomState.capacity ?? 2}
          minPlayers={minPlayers}
          onSettingsChange={handleSettingsChange}
          onShare={handleCopyLink}
        />
      </Box>

      <Button
        className="room-comment-fab"
        variant="contained"
        startIcon={<ChatIcon />}
        onClick={() => dispatch(setCommentOpen(!commentOpen))}
      >
        Comments
      </Button>
    </Box>
  )
}
