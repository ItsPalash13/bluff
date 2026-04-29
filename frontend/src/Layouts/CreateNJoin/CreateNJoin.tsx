import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Avatar, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import { useParams } from 'react-router-dom'
import { CharacterCardSelector } from '../../assets/characters/CharacterCardSelector'
import { getCharacterImageUrlByIndex } from '../../assets/characters/characterImageSources'
import { apiUrl } from '../../config/apiBase'
import { roomSessionStorageKey } from '../../session/roomSessionStorage'
import { theme1 } from '../../theme/theme1'
import { useAppSocket } from '../../state/SocketProvider'
import type { RoomState } from '../roomTypes'
import '../../App.css'

type CreateNJoinProps = {
  /** True while the websocket is not connected yet: show a minimal “connecting” state. */
  readonly connecting: boolean
  readonly onJoined: (room: RoomState, name: string, playerId: string) => void
}

type JoinAckPayload = {
  room?: RoomState
  playerId?: string
}

type JoinEligibilityPhase = 'loading' | 'eligible' | 'manual'

function initialJoinEligibilityPhase(roomIdFromPath: string | undefined): JoinEligibilityPhase {
  if (typeof window === 'undefined' || !roomIdFromPath) return 'manual'
  const norm = roomIdFromPath.trim().toUpperCase()
  try {
    const raw = window.localStorage.getItem(roomSessionStorageKey(norm))
    if (!raw) return 'manual'
    // Reconnect bootstrap: session must carry room instance version + reconnect identity.
    const parsed = JSON.parse(raw) as { playerId?: string; name?: string; version?: number }
    if (
      parsed.playerId &&
      parsed.name &&
      typeof parsed.version === 'number' &&
      Number.isFinite(parsed.version) &&
      parsed.version > 0
    ) {
      return 'loading'
    }
  } catch {
    /* empty */
  }
  return 'manual'
}

export function CreateNJoin({ connecting, onJoined }: CreateNJoinProps) {
  const { socket, ensureConnected } = useAppSocket()
  const { roomId: roomIdFromPath } = useParams()
  const [joinEligibility, setJoinEligibility] = useState<JoinEligibilityPhase>(() =>
    initialJoinEligibilityPhase(roomIdFromPath),
  )
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
  const autoJoinAttemptedRef = useRef<string>('')

  const selectedImage = useMemo(
    () => getCharacterImageUrlByIndex(themeId, selectedIndex),
    [themeId, selectedIndex],
  )

  const isJoinMode = Boolean(roomIdFromPath)
  const joinRoomCode = (roomIdFromPath ?? roomCode).trim().toUpperCase()

  const showJoinRouteGateLoader = useMemo(
    () =>
      isJoinMode &&
      (joinEligibility === 'loading' || (joinEligibility === 'eligible' && isPending)),
    [isJoinMode, joinEligibility, isPending],
  )

  useEffect(() => {
    autoJoinAttemptedRef.current = ''
    if (!roomIdFromPath) {
      setJoinEligibility('manual')
      return
    }
    const norm = roomIdFromPath.trim().toUpperCase()
    // Route re-entry reconnect flow starts from persisted session lookup.
    const rawSession = window.localStorage.getItem(roomSessionStorageKey(norm))
    if (!rawSession) {
      setJoinEligibility('manual')
      return
    }
    let parsed: {
      name?: string
      characterIndex?: number
      playerId?: string
      version?: number
    }
    try {
      parsed = JSON.parse(rawSession) as typeof parsed
    } catch {
      window.localStorage.removeItem(roomSessionStorageKey(norm))
      setJoinEligibility('manual')
      return
    }
    if (
      !parsed.playerId ||
      !parsed.name ||
      typeof parsed.version !== 'number' ||
      !Number.isFinite(parsed.version) ||
      parsed.version <= 0
    ) {
      setJoinEligibility('manual')
      return
    }
    // Reconnect gating loader while backend validates roomId + playerId + version.
    setJoinEligibility('loading')
    let cancelled = false
    ;(async () => {
      try {
        const params = new URLSearchParams({
          roomId: norm,
          playerId: parsed.playerId ?? '',
          version: String(parsed.version),
        })
        const res = await fetch(`${apiUrl('/api/rooms/eligibility')}?${params}`)
        const data = (await res.json()) as { eligible?: boolean }
        if (cancelled) return
        if (data.eligible === true) {
          // Reconnect eligible: prepare one auto room:join emit.
          setName(parsed.name ?? '')
          setSelectedIndex(
            typeof parsed.characterIndex === 'number' && Number.isFinite(parsed.characterIndex)
              ? parsed.characterIndex
              : 0,
          )
          setJoinEligibility('eligible')
        } else {
          // Reconnect not eligible (stale identity/version/room mismatch): clear session.
          window.localStorage.removeItem(roomSessionStorageKey(norm))
          setJoinEligibility('manual')
        }
      } catch {
        if (!cancelled) setJoinEligibility('manual')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [roomIdFromPath])

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

    // Persist reconnect identity for next route refresh/background recovery.
    const persistSession = (room: RoomState, playerId?: string) => {
      if (!playerId) return
      window.localStorage.setItem(
        roomSessionStorageKey(room.id),
        JSON.stringify({
          roomId: room.id,
          playerId,
          version: room.version,
          name: nameRef.current.trim() || 'Player',
          characterIndex: selectedIndex,
          savedAt: Date.now(),
        }),
      )
    }
    const normalizeJoinAck = (payload: RoomState | JoinAckPayload): JoinAckPayload => {
      if ('users' in (payload as RoomState)) {
        return { room: payload as RoomState }
      }
      return payload as JoinAckPayload
    }

    const onRoomCreated = (payload: RoomState | JoinAckPayload) => {
      const nextPayload = normalizeJoinAck(payload)
      const nextState = nextPayload.room
      if (!nextState) return
      console.debug('[socket][room] room:created', nextPayload)
      setIsPending(false)
      setError('')
      persistSession(nextState, nextPayload.playerId)
      onJoined(
        nextState,
        nameRef.current.trim() || 'Player',
        nextPayload.playerId ?? '',
      )
    }

    const onRoomJoined = (payload: RoomState | JoinAckPayload) => {
      const nextPayload = normalizeJoinAck(payload)
      const nextState = nextPayload.room
      if (!nextState) return
      console.debug('[socket][room] room:joined', nextPayload)
      setIsPending(false)
      setError('')
      persistSession(nextState, nextPayload.playerId)
      onJoined(
        nextState,
        nameRef.current.trim() || 'Player',
        nextPayload.playerId ?? '',
      )
    }

    const onRoomError = (payload: { code?: string; message?: string }) => {
      console.debug('[socket][room] room:error', payload)
      if (
        (payload.code === 'RECONNECT_WINDOW_EXPIRED' || payload.code === 'ROOM_NOT_JOINABLE') &&
        joinRoomCode
      ) {
        // Server rejected reconnect identity for this route; clear stale session.
        window.localStorage.removeItem(roomSessionStorageKey(joinRoomCode))
      }
      setJoinEligibility('manual')
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
  }, [socket, connecting, onJoined, roomIdFromPath, joinRoomCode, selectedIndex])

  useEffect(() => {
    if (!roomIdFromPath || connecting) return
    if (joinEligibility !== 'eligible') return
    const normalizedRoom = roomIdFromPath.trim().toUpperCase()
    if (!normalizedRoom || autoJoinAttemptedRef.current === normalizedRoom) return
    autoJoinAttemptedRef.current = normalizedRoom
    const rawSession = window.localStorage.getItem(roomSessionStorageKey(normalizedRoom))
    if (!rawSession) {
      setJoinEligibility('manual')
      return
    }
    try {
      const parsed = JSON.parse(rawSession) as {
        name?: string
        characterIndex?: number
        playerId?: string
        version?: number
      }
      if (
        !parsed.playerId ||
        !parsed.name ||
        typeof parsed.version !== 'number' ||
        !Number.isFinite(parsed.version) ||
        parsed.version <= 0
      ) {
        return
      }
      setIsPending(true)
      setError('')
      // Reconnect claim emit: playerId maps this socket to prior room slot.
      ensureConnected().emit('room:join', {
        roomId: normalizedRoom,
        name: parsed.name,
        characterIndex:
          typeof parsed.characterIndex === 'number' && Number.isFinite(parsed.characterIndex)
            ? parsed.characterIndex
            : 0,
        playerId: parsed.playerId,
      })
    } catch {
      window.localStorage.removeItem(roomSessionStorageKey(normalizedRoom))
      setJoinEligibility('manual')
    }
  }, [roomIdFromPath, connecting, ensureConnected, joinEligibility])

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
      // If a reconnect session exists for this room code, include playerId/version.
      ...(window.localStorage.getItem(roomSessionStorageKey(joinRoomCode))
        ? (() => {
            try {
              const parsed = JSON.parse(
                window.localStorage.getItem(roomSessionStorageKey(joinRoomCode)) ?? '{}',
              ) as { playerId?: string; version?: number }
              return {
                playerId: parsed.playerId ?? '',
                version:
                  typeof parsed.version === 'number' && Number.isFinite(parsed.version)
                    ? parsed.version
                    : 0,
              }
            } catch {
              return {}
            }
          })()
        : {}),
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

  if (showJoinRouteGateLoader) {
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
          <Typography sx={{ color: '#e5e7eb' }}>
            {joinEligibility === 'loading'
              ? 'Checking your session…'
              : 'Reconnecting to room…'}
          </Typography>
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
          {isJoinMode && !roomIdFromPath ? (
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
    </Box>
  )
}
