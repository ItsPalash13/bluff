import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  IconButton,
  Paper,
  Typography,
} from '@mui/material'
import ChatIcon from '@mui/icons-material/Chat'
import { useMatch } from 'react-router-dom'
import { Lobby } from './Lobby'
import { RoomSettings } from './RoomSettings'
import { RankingBoard } from '../../components/RankingBoard'
import { useAppSocket } from '../../state/SocketProvider'
import { useAppDispatch, useAppSelector } from '../../store/hooks'
import { setCommentOpen } from '../../store/uiSlice'
import backMaroon from '../../assets/card/png/2x/back-maroon.png'
import type { RoomMessage, RoomSession, RoomState, TurnUpdatePayload } from '../roomTypes'
import { HandDockDesktop } from './HandCards/HandDockDesktop'
import { HandRackMobile } from './HandCards/HandRackMobile'
import '../../App.css'

type RoomProps = {
  roomSession: RoomSession
}

const RANK_ORDER = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2']

const PILE_ROTATIONS = [-12, 7, -3, 14, -8, 4, -15, 9]
const PILE_OFFSETS: Array<[number, number]> = [
  [0, 0],
  [-4, 2],
  [3, -2],
  [-2, 4],
  [5, 1],
  [-5, -3],
  [2, 5],
  [-3, -2],
]

export function Room({ roomSession }: RoomProps) {
  const { socket } = useAppSocket()
  const dispatch = useAppDispatch()
  const commentOpen = useAppSelector((state) => state.ui.commentOpen)
  const [roomState, setRoomState] = useState<RoomState>(roomSession.room)
  const [lastMessage, setLastMessage] = useState<RoomMessage | null>(null)
  const [turnUpdate, setTurnUpdate] = useState<TurnUpdatePayload | null>(null)
  const [gameStatus, setGameStatus] = useState(roomSession.room.status || 'waiting')
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [rankModalOpen, setRankModalOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 1024 : window.innerWidth,
  )
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
  const rankOptions = useMemo(() => {
    const hand = turnUpdate?.yourHand ?? []
    const uniqueRanks = new Set(hand.map((card) => card.rank))
    return RANK_ORDER.filter((rank) => uniqueRanks.has(rank))
  }, [turnUpdate])

  const isMyTurn = Boolean(turnUpdate && mySocketId && turnUpdate.currentPlayerId === mySocketId)
  const hasCurrentBet = Boolean(turnUpdate?.currentBet)
  const isInRound = roomStatus === 'in_round'
  const isGameEnd = roomStatus === 'game_end'
  const showGameUi = roomStatus !== 'waiting' && !isGameEnd

  const selectedCount = selectedCardIds.length
  const roundRank = turnUpdate?.currentBet?.rank ?? ''
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

  const lastBettorId = turnUpdate?.lastBetPlayerId ?? ''
  const lastBettorName = lastBettorId ? nameBySocketId[lastBettorId] ?? '' : ''
  const pileCount = turnUpdate?.pileCount ?? 0
  const pileVisualCount = pileCount === 0 ? 1 : Math.min(8, Math.max(1, pileCount))

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

  const handleSubmitBet = (rank: string) => {
    if (!socket || !canSubmitBet || !rank) return
    socket.emit('game:play_bet', {
      cardIds: selectedCardIds,
      rank,
      count: selectedCount,
    })
    setSelectedCardIds([])
    setRankModalOpen(false)
  }

  const handleBluffClick = () => {
    if (!canSubmitBet) return
    if (roundRank) {
      handleSubmitBet(roundRank)
      return
    }
    if (rankOptions.length === 0) return
    setRankModalOpen(true)
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

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize, { passive: true })
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const hand = turnUpdate?.yourHand ?? []

  return (
    <Box className={`lobby-center room-stage${showGameUi ? ' room-stage--in-game' : ''}`}>
      <Lobby
        room={roomState}
        lastMessage={lastMessage}
        currentTurnPlayerId={turnUpdate?.currentPlayerId ?? ''}
        turnSecondsLeft={turnUpdate?.secondsLeft}
        gameEnded={isGameEnd}
        playerCardCounts={turnUpdate?.playerCardCounts}
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
        <>
        <Paper
          className="game-shell"
          elevation={0}
          square
          sx={{ background: 'transparent', backgroundImage: 'none', boxShadow: 'none' }}
        >
          <Box className="game-center">
            <Box
              className={`last-bettor-circle${lastBettorId ? '' : ' last-bettor-circle--empty'}`}
            >
              <Typography className="last-bettor-circle__label">Last Bettor</Typography>
              <Typography className="last-bettor-circle__value" component="div">
                {lastBettorId && lastBettorName ? lastBettorName : '--'}
              </Typography>
            </Box>

            <Box className="pile-stack" aria-label={`Pile of ${pileCount} cards`}>
              {pileCount === 0 ? (
                <img
                  src={backMaroon}
                  alt=""
                  className="pile-stack__card pile-stack__card--placeholder"
                  draggable={false}
                />
              ) : (
                Array.from({ length: pileVisualCount }).map((_, i) => {
                  const rot = PILE_ROTATIONS[i % PILE_ROTATIONS.length]
                  const [dx, dy] = PILE_OFFSETS[i % PILE_OFFSETS.length]
                  return (
                    <img
                      key={i}
                      src={backMaroon}
                      alt=""
                      className="pile-stack__card"
                      draggable={false}
                      style={{
                        transform: `translate(${dx}px, ${dy}px) rotate(${rot}deg)`,
                        zIndex: i,
                      }}
                    />
                  )
                })
              )}
              <Box className="pile-count-badge" aria-label={`${pileCount} cards in pile`}>
                {pileCount}
              </Box>
            </Box>

            <Box
              className={`last-bet-circle${turnUpdate?.currentBet ? '' : ' last-bet-circle--empty'}`}
            >
              <Typography className="last-bet-circle__label">Last Bet</Typography>
              {turnUpdate?.currentBet ? (
                <>
                  <Typography className="last-bet-circle__count">
                    {turnUpdate.currentBet.count}
                  </Typography>
                  <Typography className="last-bet-circle__rank">
                    {turnUpdate.currentBet.rank}
                  </Typography>
                </>
              ) : (
                <Typography className="last-bet-circle__count">--</Typography>
              )}
            </Box>
          </Box>

          <HandRackMobile
            hand={hand}
            selectedCardIds={selectedCardIds}
            isMyTurn={isMyTurn}
            isInRound={isInRound}
            onToggle={handleToggleCard}
            viewportWidth={viewportWidth}
          />
        </Paper>

        <Box className="game-actions-wrap">
          <Box className="game-actions-row" role="toolbar" aria-label="Game actions">
            <Button
              className="game-action-btn game-action-btn--open"
              variant="contained"
              color="warning"
              onClick={handleCallBluff}
              disabled={!canCallBluff}
            >
              Open
            </Button>
            <Button
              className="game-action-btn game-action-btn--bluff"
              variant="contained"
              onClick={handleBluffClick}
              disabled={!canSubmitBet}
            >
              BLUFF
            </Button>
            <Button
              className="game-action-btn game-action-btn--pass"
              variant="contained"
              onClick={handlePass}
              disabled={!canPass}
            >
              Pass
            </Button>
          </Box>
        </Box>

        <HandDockDesktop
          hand={hand}
          selectedCardIds={selectedCardIds}
          isMyTurn={isMyTurn}
          isInRound={isInRound}
          onToggle={handleToggleCard}
          viewportWidth={viewportWidth}
        />
        </>
      )}

      <Dialog
        open={rankModalOpen}
        onClose={() => setRankModalOpen(false)}
        classes={{ paper: 'rank-modal' }}
        slotProps={{ backdrop: { className: 'rank-modal__backdrop' } }}
      >
        <Typography className="rank-modal__title">SELECT CARD SERIES</Typography>
        <Box className="rank-modal__tiles">
          {rankOptions.length === 0 ? (
            <Typography className="rank-modal__empty">No ranks available</Typography>
          ) : (
            rankOptions.map((r) => (
              <button
                key={r}
                type="button"
                className="rank-tile"
                onClick={() => handleSubmitBet(r)}
              >
                {r}
              </button>
            ))
          )}
        </Box>
      </Dialog>

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
