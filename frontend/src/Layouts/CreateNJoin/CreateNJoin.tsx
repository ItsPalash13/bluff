import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Avatar, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { useParams } from 'react-router-dom'
import { CharacterCardSelector } from '../../assets/characters/CharacterCardSelector'
import { getCharacterImageUrlByIndex } from '../../assets/characters/characterImageSources'
import { theme1 } from '../../theme/theme1'
import { useAppSocket } from '../../state/SocketProvider'
import type { RoomState } from '../roomTypes'
import '../../App.css'

type CreateNJoinProps = {
  /** True while the websocket is not connected yet: show a minimal “connecting” state. */
  readonly connecting: boolean
  readonly onJoined: (room: RoomState, name: string) => void
}

export function CreateNJoin({ connecting, onJoined }: CreateNJoinProps) {
  const { socket, ensureConnected } = useAppSocket()
  const { roomId: roomIdFromPath } = useParams()
  const [name, setName] = useState('')
  const nameRef = useRef(name)
  nameRef.current = name
  const [themeId] = useState(theme1.pokerFelt.green.characterFolder)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isPending, setIsPending] = useState(false)
  const [connectHint, setConnectHint] = useState<'idle' | 'trying' | 'slow'>('idle')
  const [loadingDots, setLoadingDots] = useState('.')
  const [error, setError] = useState('')

  const selectedImage = useMemo(
    () => getCharacterImageUrlByIndex(themeId, selectedIndex),
    [themeId, selectedIndex],
  )

  const isJoinMode = Boolean(roomIdFromPath)

  useEffect(() => {
    if (!isPending) {
      setConnectHint('idle')
      return
    }

    const tryingTimer = window.setTimeout(() => {
      setConnectHint('trying')
    }, 1000)

    const slowTimer = window.setTimeout(() => {
      setConnectHint('slow')
    }, 5000)

    return () => {
      window.clearTimeout(tryingTimer)
      window.clearTimeout(slowTimer)
    }
  }, [isPending])

  useEffect(() => {
    if (!isPending) {
      setLoadingDots('.')
      return
    }

    const frames = ['.', '..', '...']
    let frameIndex = 0
    const dotsTimer = window.setInterval(() => {
      frameIndex = (frameIndex + 1) % frames.length
      setLoadingDots(frames[frameIndex])
    }, 700)

    return () => {
      window.clearInterval(dotsTimer)
    }
  }, [isPending])

  useEffect(() => {
    if (!socket || connecting) {
      return
    }

    const onRoomCreated = (nextState: RoomState) => {
      console.debug('[socket][room] room:created', nextState)
      setIsPending(false)
      setError('')
      onJoined(nextState, nameRef.current.trim() || 'Player')
    }

    const onRoomJoined = (nextState: RoomState) => {
      console.debug('[socket][room] room:joined', nextState)
      setIsPending(false)
      setError('')
      onJoined(nextState, nameRef.current.trim() || 'Player')
    }

    const onRoomError = (payload: { message?: string }) => {
      console.debug('[socket][room] room:error', payload)
      setError(payload.message ?? 'Something went wrong while processing room request.')
      setIsPending(false)
    }

    socket.on('room:created', onRoomCreated)
    socket.on('room:joined', onRoomJoined)
    socket.on('room:error', onRoomError)

    return () => {
      socket.off('room:created', onRoomCreated)
      socket.off('room:joined', onRoomJoined)
      socket.off('room:error', onRoomError)
    }
  }, [socket, connecting, onJoined, roomIdFromPath])

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
    if (!roomIdFromPath) {
      setError('Room id is missing from URL.')
      return
    }
    setIsPending(true)
    setError('')
    console.debug('[socket][room] emit room:join', {
      roomId: roomIdFromPath.toUpperCase(),
      name: name.trim(),
      characterIndex: selectedIndex,
    })
    ensureConnected().emit('room:join', {
      roomId: roomIdFromPath.toUpperCase(),
      name: name.trim(),
      characterIndex: selectedIndex,
    })
  }

  if (connecting) {
    return (
      <Box className="lobby-center">
        <Paper
          elevation={0}
          sx={{
            width: 'min(700px, 100%)',
            borderRadius: '14px',
            p: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            background: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            backdropFilter: 'blur(2px)',
          }}
        >
          <Typography variant="h5" sx={{ color: '#f8fafc', fontWeight: 700 }}>
            Bluff
          </Typography>
          <Typography sx={{ color: '#e5e7eb' }}>Connecting to server…</Typography>
        </Paper>
      </Box>
    )
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
        <Typography variant="h4" sx={{ color: '#f8fafc', fontWeight: 700 }}>
          {isJoinMode ? 'Join a room' : 'Create a room'}
        </Typography>

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
          <Button
            variant="contained"
            disabled={isPending}
            onClick={isJoinMode ? handleJoinRoom : handleCreateRoom}
          >
            {isJoinMode ? 'Join room' : 'Create new room'}
          </Button>
        </Stack>
        {connectHint === 'trying' ? (
          <Typography sx={{ color: '#e5e7eb' }}>
            {`Trying to connect to server${loadingDots}`}
          </Typography>
        ) : null}
        {connectHint === 'slow' ? (
          <Typography sx={{ color: '#facc15', fontWeight: 600 }}>
            {`Taking longer than usual${loadingDots}`}
          </Typography>
        ) : null}
      </Paper>
    </Box>
  )
}
