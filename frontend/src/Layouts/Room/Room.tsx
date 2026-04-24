import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Avatar, Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material'
import { useNavigate, useParams } from 'react-router-dom'
import { CharacterCardSelector } from '../../assets/characters/CharacterCardSelector'
import {
  getCharacterImageUrlByIndex,
} from '../../assets/characters/characterImageSources'
import { theme1 } from '../../theme/theme1'
import { Lobby } from './Lobby'
import { useAppSocket } from '../../state/SocketProvider'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCommentOpen } from '../../store/uiSlice'
import '../../App.css'

type RoomUser = {
  socketId: string
  name: string
  characterIndex: number
}

type RoomState = {
  id: string
  hostSocketId: string
  capacity: number
  users: RoomUser[]
}

type RoomMessage = {
  socketId: string
  name: string
  message: string
  sentAt: number
}

export function Room() {
  const { socket, ensureConnected, disconnect } = useAppSocket()
  const dispatch = useAppDispatch()
  const commentOpen = useAppSelector((state) => state.ui.commentOpen)
  const { roomId } = useParams()
  const previousRouteRoomIdRef = useRef<string | undefined>(roomId)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [themeId] = useState(theme1.pokerFelt.green.characterFolder)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [roomState, setRoomState] = useState<RoomState | null>(null)
  const [lastMessage, setLastMessage] = useState<RoomMessage | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState('')

  const selectedImage = useMemo(
    () => getCharacterImageUrlByIndex(themeId, selectedIndex),
    [themeId, selectedIndex],
  )
  const activeRoomId = roomState?.id ?? roomId ?? ''
  const isJoined = Boolean(roomState)

  useEffect(() => {
    if (!socket) {
      return
    }

    const onRoomCreated = (nextState: RoomState) => {
      console.debug('[socket][room] room:created', nextState)
      setRoomState(nextState)
      setIsPending(false)
      setError('')
      navigate(`/${nextState.id}`)
    }

    const onRoomJoined = (nextState: RoomState) => {
      console.debug('[socket][room] room:joined', nextState)
      setRoomState(nextState)
      setIsPending(false)
      setError('')
    }

    const onRoomState = (nextState: RoomState) => {
      console.debug('[socket][room] room:state', nextState)
      if (nextState.id === roomId || nextState.id === roomState?.id) {
        setRoomState(nextState)
      }
    }

    const onRoomError = (payload: { message?: string }) => {
      console.debug('[socket][room] room:error', payload)
      setError(payload.message ?? 'Something went wrong while processing room request.')
      setIsPending(false)
    }

    const onRoomMessage = (message: RoomMessage) => {
      console.debug('[socket][room] room:message', message)
      setLastMessage(message)
    }

    socket.on('room:created', onRoomCreated)
    socket.on('room:joined', onRoomJoined)
    socket.on('room:state', onRoomState)
    socket.on('room:error', onRoomError)
    socket.on('room:message', onRoomMessage)

    return () => {
      socket.off('room:created', onRoomCreated)
      socket.off('room:joined', onRoomJoined)
      socket.off('room:state', onRoomState)
      socket.off('room:error', onRoomError)
      socket.off('room:message', onRoomMessage)
    }
  }, [socket, navigate, roomId, roomState?.id])

  useEffect(() => {
    if (roomId && roomState && roomState.id !== roomId) {
      setRoomState(null)
    }
  }, [roomId, roomState])

  useEffect(() => {
    const previousRoomId = previousRouteRoomIdRef.current
    // Disconnect only when user transitions from a room route back to home.
    if (previousRoomId && !roomId && !isPending) {
      console.debug('[socket][room] route transition room->home, disconnecting socket')
      if (socket) {
        socket.emit('room:leave')
      }
      dispatch(setCommentOpen(false))
      disconnect()
      setRoomState(null)
    }
    previousRouteRoomIdRef.current = roomId
  }, [roomId, isPending, socket, disconnect, dispatch])

  const handleCreateRoom = () => {
    if (!name.trim()) {
      setError('Please enter your name before creating a room.')
      return
    }
    setIsPending(true)
    setError('')
    console.debug('[socket][room] emit room:create', {
      name: name.trim(),
      characterIndex: selectedIndex,
    })
    ensureConnected().emit('room:create', {
      name: name.trim(),
      characterIndex: selectedIndex,
    })
  }

  const handleJoinRoom = () => {
    if (!name.trim()) {
      setError('Please enter your name before joining a room.')
      return
    }
    if (!roomId) {
      setError('Room id is missing from URL.')
      return
    }
    setIsPending(true)
    setError('')
    console.debug('[socket][room] emit room:join', {
      roomId: roomId.toUpperCase(),
      name: name.trim(),
      characterIndex: selectedIndex,
    })
    ensureConnected().emit('room:join', {
      roomId: roomId.toUpperCase(),
      name: name.trim(),
      characterIndex: selectedIndex,
    })
  }

  const handleLeaveRoom = () => {
    if (socket) {
      console.debug('[socket][room] emit room:leave', { roomId: roomState?.id })
      socket.emit('room:leave')
    }
    dispatch(setCommentOpen(false))
    disconnect()
    setRoomState(null)
    setError('')
    setIsPending(false)
    navigate('/')
  }

  return (
    <Box className="lobby-center">
      <Paper
        elevation={0}
        sx={{
          width: 'min(700px, 100%)',
          borderRadius: '14px',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          background: 'rgba(0, 0, 0, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.18)',
          backdropFilter: 'blur(2px)',
        }}
      >
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="h4" sx={{ color: '#f8fafc', fontWeight: 700 }}>
            Bluff Room
          </Typography>
          {activeRoomId ? <Chip size="small" color="warning" label={`Room: ${activeRoomId}`} /> : null}
        </Stack>

        {!isJoined ? (
          <>
            <CharacterCardSelector
              themeId={themeId}
              selectedIndex={selectedIndex}
              onSelect={setSelectedIndex}
            />

            <Avatar
              src={selectedImage}
              alt="Selected character"
              sx={{ width: 92, height: 92, border: '2px solid rgba(255,255,255,0.25)' }}
            />

            <Box sx={{ width: 'min(420px, 100%)' }}>
              <Typography sx={{ color: '#e5e7eb', fontWeight: 600, mb: 0.75 }}>Name</Typography>
              <TextField
                fullWidth
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your name"
                variant="outlined"
                size="small"
                sx={{
                  '& .MuiInputBase-root': {
                    color: '#f8fafc',
                    background: 'rgba(0, 0, 0, 0.35)',
                    borderRadius: '10px',
                  },
                }}
              />
            </Box>

            {error ? <Alert severity="error">{error}</Alert> : null}
            <Stack direction="row" spacing={1.5}>
              <Button variant="contained" disabled={isPending} onClick={roomId ? handleJoinRoom : handleCreateRoom}>
                {roomId ? 'Join Room' : 'Create New Room'}
              </Button>
            </Stack>
          </>
        ) : (
          <Lobby
            room={roomState!}
            currentName={name.trim() || 'Player'}
            lastMessage={lastMessage}
            commentOpen={commentOpen}
            onCommentToggle={(open) => dispatch(setCommentOpen(open))}
            onLeave={handleLeaveRoom}
          />
        )}
      </Paper>
    </Box>
  )
}
