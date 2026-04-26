import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Chip,
  Typography,
  Checkbox,
} from '@mui/material'
import ChatIcon from '@mui/icons-material/Chat'
import { useMatch } from 'react-router-dom'
import { Lobby } from './Lobby'
import { RoomSettings } from './RoomSettings'
import { RankingBoard } from '../../components/RankingBoard'
import { useAppSocket } from '../../state/SocketProvider'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCommentOpen } from '../../store/uiSlice'
import type { RoomMessage, RoomSession, RoomState, TurnUpdatePayload } from '../roomTypes'
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
  const [turnUpdate, setTurnUpdate] = useState<TurnUpdatePayload | null>(null)
  const [gameStatus, setGameStatus] = useState(roomSession.room.status || 'waiting')
  const [selectedRank, setSelectedRank] = useState('Q')
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [gameEndSummary, setGameEndSummary] = useState<{
    finishedPlayers: string[]
    playerNames?: Record<string, string>
  } | null>(null)
  const match = useMatch('/:roomId')
  const roomId = match?.params.roomId
  const shareUrl = `${window.location.origin}/${roomState.id}`
  const isHost = Boolean(socket && roomState.hostSocketId === socket.id)
  const roomStatus = gameStatus || roomState.status || 'waiting'
  const canEdit = isHost && roomStatus === 'waiting'
  const mySocketId = socket?.id ?? ''
  const rankOrder = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']
  const rankOptions = useMemo(() => {
    const hand = turnUpdate?.yourHand ?? []
    const uniqueRanks = new Set(hand.map((card) => card.rank))
    return rankOrder.filter((rank) => uniqueRanks.has(rank))
  }, [turnUpdate])

  const isMyTurn = Boolean(turnUpdate && mySocketId && turnUpdate.currentPlayerId === mySocketId)
  const hasCurrentBet = Boolean(turnUpdate?.currentBet)
  const isSetup = roomStatus === 'setup'
  const isInRound = roomStatus === 'in_round'
  const isGameEnd = roomStatus === 'game_end'

  const selectedCount = selectedCardIds.length
  const roundRank = turnUpdate?.currentBet?.rank ?? ''
  const effectiveRank = roundRank || selectedRank
  const canSubmitBet = isInRound && isMyTurn && selectedCount > 0 && selectedCount <= 4
  const canPass = isInRound && isMyTurn && hasCurrentBet
  const canCallBluff = useMemo(() => {
    if (!turnUpdate || !isInRound || !hasCurrentBet) return false
    return turnUpdate.lastBetPlayerId !== mySocketId
  }, [turnUpdate, isInRound, hasCurrentBet, mySocketId])
  const nameBySocketId = useMemo(
    () =>
      roomState.users.reduce<Record<string, string>>((acc, user) => {
        acc[user.socketId] = user.name
        return acc
      }, {}),
    [roomState.users],
  )
  useEffect(() => {
    if (rankOptions.length === 0) return
    if (!rankOptions.includes(selectedRank)) {
      setSelectedRank(rankOptions[0])
    }
  }, [rankOptions, selectedRank])

  useEffect(() => {
    if (!socket) {
      return
    }

    const onRoomState = (nextState: RoomState) => {
      console.debug('[socket][room] room:state', nextState)
      if (nextState.id === roomId || nextState.id === roomState.id) {
        setRoomState(nextState)
        setGameStatus(nextState.status || 'waiting')
      }
    }

    const onRoomMessage = (message: RoomMessage) => {
      console.debug('[socket][room] room:message', message)
      setLastMessage(message)
    }

    socket.on('room:state', onRoomState)
    socket.on('room:message', onRoomMessage)
    socket.on('setup_start', () => {
      setGameStatus('setup')
      setGameEndSummary(null)
    })
    socket.on('game_start', () => {
      setGameStatus('in_round')
      setGameEndSummary(null)
    })
    socket.on('turn_update', (payload: TurnUpdatePayload) => {
      setTurnUpdate(payload)
      setGameStatus(payload.status || 'in_round')
    })
    socket.on('timer_tick', (payload: { playerId?: string; secondsLeft?: number }) => {
      setTurnUpdate((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          currentPlayerId: payload.playerId ?? prev.currentPlayerId,
          secondsLeft: typeof payload.secondsLeft === 'number' ? payload.secondsLeft : prev.secondsLeft,
        }
      })
    })
    socket.on(
      'game_end',
      (payload: { finishedPlayers?: string[]; playerNames?: Record<string, string> }) => {
        setGameStatus('game_end')
        setGameEndSummary({
          finishedPlayers: payload.finishedPlayers ?? [],
          playerNames: payload.playerNames,
        })
      },
    )

    return () => {
      socket.off('room:state', onRoomState)
      socket.off('room:message', onRoomMessage)
      socket.off('setup_start')
      socket.off('game_start')
      socket.off('turn_update')
      socket.off('timer_tick')
      socket.off('game_end')
    }
  }, [socket, roomId, roomState.id])

  const handleSettingsChange = (p: { turnSeconds: number; capacity: number; totalCards: number }) => {
    if (!socket) return
    socket.emit('room:updateSettings', p)
  }

  const handleStart = (p: { turnSeconds: number; totalCards: number }) => {
    if (!socket) return
    socket.emit('room:start', p)
  }

  const handleToggleCard = (cardId: string) => {
    setSelectedCardIds((prev) => {
      if (prev.includes(cardId)) {
        return prev.filter((id) => id !== cardId)
      }
      if (prev.length >= 4) return prev
      return [...prev, cardId]
    })
  }

  const handleSubmitBet = () => {
    if (!socket || !canSubmitBet) return
    socket.emit('game:play_bet', {
      cardIds: selectedCardIds,
      rank: effectiveRank,
      count: selectedCount,
    })
    setSelectedCardIds([])
  }

  const handlePass = () => {
    if (!socket || !canPass) return
    socket.emit('game:pass')
  }

  const handleCallBluff = () => {
    if (!socket || !canCallBluff) return
    socket.emit('game:call_bluff')
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
        currentTurnPlayerId={turnUpdate?.currentPlayerId ?? ''}
        turnSecondsLeft={turnUpdate?.secondsLeft}
        gameEnded={isGameEnd}
      />

      {roomStatus === 'waiting' ? (
        <Box className="room-settings-anchor">
          <RoomSettings
            canEdit={canEdit}
            roomStatus={roomStatus}
            turnSeconds={roomState.turnSeconds ?? 0}
            totalCards={roomState.totalCards ?? 26}
            capacity={roomState.capacity ?? 2}
            onSettingsChange={handleSettingsChange}
            onStart={handleStart}
            onShare={handleCopyLink}
          />
        </Box>
      ) : isGameEnd ? (
        <RankingBoard
          ranking={gameEndSummary?.finishedPlayers ?? []}
          nameBySocketId={nameBySocketId}
          playerNamesFromGame={gameEndSummary?.playerNames}
        />
      ) : (
        <Paper className="game-shell" elevation={0}>
          <Box className="game-top">
            <Typography className="game-title">Game Status: {roomStatus.toUpperCase()}</Typography>
            {isSetup ? <Typography className="game-note">Setting up game...</Typography> : null}
            {turnUpdate ? (
              <>
                <Typography>Current Turn: {turnUpdate.currentPlayerId || '-'}</Typography>
                <Typography>
                  Timer:{' '}
                  {roomState.turnSeconds <= 0 || (turnUpdate.secondsLeft ?? 0) < 0
                    ? 'Off'
                    : `${Math.max(0, turnUpdate.secondsLeft ?? 0)}s`}
                </Typography>
                {turnUpdate.currentBet ? (
                  <Typography>
                    Current Bet: {turnUpdate.currentBet.count} x {turnUpdate.currentBet.rank} by {turnUpdate.currentBet.playerId}
                  </Typography>
                ) : (
                  <Typography>No active bet. Current player must initiate a new bet.</Typography>
                )}
                <Typography>Pile Cards: {turnUpdate.pileCount ?? 0}</Typography>
                <Typography>
                  Last Bet: {turnUpdate.currentBet ? `${turnUpdate.currentBet.count} x ${turnUpdate.currentBet.rank}` : 'None'}
                </Typography>
              </>
            ) : (
              <Typography>Waiting for game updates...</Typography>
            )}
          </Box>

          <Box className="game-middle">
            <Box
              sx={{
                display: 'flex',
                gap: 1.5,
                flexDirection: { xs: 'column', md: 'row' },
                alignItems: { xs: 'stretch', md: 'center' },
              }}
            >
              {roundRank ? (
                <Box className="game-fixed-value">
                  <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                    Round Rank
                  </Typography>
                  <Chip size="small" color="success" label={roundRank} />
                </Box>
              ) : (
                <FormControl size="small" className="game-control">
                  <InputLabel id="rank-label">Rank</InputLabel>
                  <Select
                    labelId="rank-label"
                    value={rankOptions.includes(selectedRank) ? selectedRank : ''}
                    label="Rank"
                    onChange={(event) => setSelectedRank(event.target.value)}
                    disabled={!isMyTurn || !isInRound}
                  >
                    {rankOptions.length === 0 ? (
                      <MenuItem disabled value="">
                        No ranks available
                      </MenuItem>
                    ) : null}
                    {rankOptions.map((rank) => (
                      <MenuItem key={rank} value={rank}>
                        {rank}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              <Box className="game-fixed-value">
                <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                  Selected Count
                </Typography>
                <Chip
                  size="small"
                  label={selectedCount || 0}
                  color={selectedCount > 0 ? 'primary' : 'default'}
                />
              </Box>

              <Button variant="contained" onClick={handleSubmitBet} disabled={!canSubmitBet}>
                Submit Bet
              </Button>
              <Button variant="outlined" onClick={handlePass} disabled={!canPass}>
                Pass
              </Button>
              <Button variant="outlined" color="warning" onClick={handleCallBluff} disabled={!canCallBluff}>
                Call Bluff
              </Button>
            </Box>
          </Box>

          <Box className="game-bottom">
            <Typography>
              Your Cards: {turnUpdate?.yourHand?.length ?? 0}
            </Typography>
            <Box className="hand-list">
              {(turnUpdate?.yourHand ?? []).map((card) => (
                <FormControlLabel
                  key={card.id}
                  control={
                    <Checkbox
                      checked={selectedCardIds.includes(card.id)}
                      onChange={() => handleToggleCard(card.id)}
                      disabled={!isMyTurn || !isInRound || (!selectedCardIds.includes(card.id) && selectedCardIds.length >= 4)}
                    />
                  }
                  label={`${card.rank}${card.suit}`}
                />
              ))}
            </Box>
          </Box>
        </Paper>
      )}

      <IconButton
        className="room-comment-fab"
        aria-label="Comments"
        onClick={() => dispatch(setCommentOpen(!commentOpen))}
      >
        <ChatIcon />
      </IconButton>
    </Box>
  )
}
