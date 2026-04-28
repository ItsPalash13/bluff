import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Avatar, Box, Button, Dialog, Paper, Stack, TextField, Typography } from '@mui/material'
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
  const [roomCode, setRoomCode] = useState('')
  const [mobileNoticeOpen, setMobileNoticeOpen] = useState(false)

  const selectedImage = useMemo(
    () => getCharacterImageUrlByIndex(themeId, selectedIndex),
    [themeId, selectedIndex],
  )

  const isMobileClient = useMemo(() => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
    const ua = navigator.userAgent || ''
    const isMobileUa = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua)
    const isSmallViewport = window.innerWidth <= 500
    return isMobileUa || isSmallViewport
  }, [])

  const isJoinMode = Boolean(roomIdFromPath) || isMobileClient
  const joinRoomCode = (roomIdFromPath ?? roomCode).trim().toUpperCase()

  useEffect(() => {
    if (isMobileClient) {
      setMobileNoticeOpen(true)
    }
  }, [isMobileClient])

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
    if (!joinRoomCode) {
      setError('Please enter a room code.')
      return
    }
    setIsPending(true)
    setError('')
    console.debug('[socket][room] emit room:join', {
      roomId: joinRoomCode,
      name: name.trim(),
      characterIndex: selectedIndex,
    })
    ensureConnected().emit('room:join', {
      roomId: joinRoomCode,
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
          {isMobileClient && !roomIdFromPath ? (
            <>
              <Typography sx={{ color: '#e5e7eb', fontWeight: 600, mb: 0.75 }}>Room code</Typography>
              <TextField
                fullWidth
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder="Enter room code"
                variant="outlined"
                size="small"
                sx={{
                  mb: 1.2,
                  '& .MuiInputBase-root': {
                    color: '#f8fafc',
                    background: 'rgba(0, 0, 0, 0.35)',
                    borderRadius: '10px',
                  },
                }}
              />
            </>
          ) : null}
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
      <Dialog
        open={mobileNoticeOpen}
        onClose={() => setMobileNoticeOpen(false)}
        classes={{ paper: 'rank-modal profile-edit-modal' }}
        slotProps={{ backdrop: { className: 'rank-modal__backdrop' } }}
      >
        <Typography className="rank-modal__title">MOBILE NOTICE</Typography>
        <Typography sx={{ color: '#f8fafc', textAlign: 'center', mb: 1.5, maxWidth: 460 }}>
          Hi Mobile User! You can join and play existing rooms, but creating a new room isn’t available right now.
          <br />
          <br />
          For the full experience, please use a laptop or desktop.
        </Typography>
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
          <Button variant="contained" color="success" onClick={() => setMobileNoticeOpen(false)}>
            Continue to Join
          </Button>
        </Box>
      </Dialog>
    </Box>
  )
}
