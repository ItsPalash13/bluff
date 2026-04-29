import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type AnimationEvent,
} from 'react'
import {
  Avatar,
  Alert,
  Box,
  Button,
  Dialog,
  IconButton,
  Paper,
  Snackbar,
  TextField,
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
import { getCharacterCount, getCharacterImageUrlByIndex } from '../../assets/characters/characterImageSources'
import { CharacterCardSelector } from '../../assets/characters/CharacterCardSelector'
import { theme1 } from '../../theme/theme1'
import backMaroon from '../../assets/card/png/2x/back-maroon.png'
import type {
  BluffResultPayload,
  GameCard,
  RoomMessage,
  RoomSession,
  RoomState,
  TurnUpdatePayload,
} from '../roomTypes'
import { HandDockDesktop } from './HandCards/HandDockDesktop'
import { HandRackMobile } from './HandCards/HandRackMobile'
import { OpenRevealModal, type OpenReveal } from './OpenRevealModal'
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

// How long to show the post-Open reveal modal before the safety timer clears it,
// in case the backend's deferred turn_update never reaches this client.
const OPEN_REVEAL_SAFETY_MS = 8000

/** must match @keyframes name in `App.css` for `onAnimationEnd` */
const PILE_STACK_FLUSH_RIGHT_NAME = 'pile-stack-flush-right'

function intFromJson(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return Math.trunc(n)
  }
  return undefined
}

function parseBluffResultPayload(raw: unknown): BluffResultPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const callerId = typeof r.callerId === 'string' ? r.callerId : ''
  const targetId = typeof r.targetId === 'string' ? r.targetId : ''
  const pileReceiver = typeof r.pileReceiver === 'string' ? r.pileReceiver : ''
  const bluffCaught = Boolean(r.bluffCaught)
  const claimedRank = typeof r.claimedRank === 'string' ? r.claimedRank : ''
  const claimedCount = typeof r.claimedCount === 'number' ? r.claimedCount : 0
  const rawCards = Array.isArray(r.lastPlayedCards) ? r.lastPlayedCards : []
  const lastPlayedCards: GameCard[] = rawCards
    .map((c) => {
      if (!c || typeof c !== 'object') return null
      const cr = c as Record<string, unknown>
      const id = typeof cr.id === 'string' ? cr.id : ''
      const rank = typeof cr.rank === 'string' ? cr.rank : ''
      const suit = typeof cr.suit === 'string' ? cr.suit : ''
      if (!id || !rank || !suit) return null
      return { id, rank, suit }
    })
    .filter((c): c is GameCard => c !== null)
  if (!callerId) return null
  const callerNameRaw = r.callerName
  const targetNameRaw = r.targetName
  return {
    callerId,
    targetId,
    callerName: typeof callerNameRaw === 'string' && callerNameRaw.trim() !== '' ? callerNameRaw.trim() : undefined,
    callerCharacterIndex: intFromJson(r.callerCharacterIndex),
    targetName: typeof targetNameRaw === 'string' && targetNameRaw.trim() !== '' ? targetNameRaw.trim() : undefined,
    targetCharacterIndex: intFromJson(r.targetCharacterIndex),
    bluffCaught,
    pileReceiver,
    lastPlayedCards,
    claimedRank,
    claimedCount,
  }
}

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
  const [openCallReveal, setOpenCallReveal] = useState<OpenReveal | null>(null)
  const [gameActionToast, setGameActionToast] = useState<{
    id: number
    playerId: string
    text: string
  } | null>(null)
  const gameToastIdRef = useRef(0)
  const [profileEditOpen, setProfileEditOpen] = useState(false)
  const [profileEditName, setProfileEditName] = useState('')
  const [profileEditCharacterIndex, setProfileEditCharacterIndex] = useState(0)
  const [profileEditError, setProfileEditError] = useState('')
  const [shareToastOpen, setShareToastOpen] = useState(false)
  const [socketDisconnectModalOpen, setSocketDisconnectModalOpen] = useState(false)
  const match = useMatch('/:roomId')
  const roomId = match?.params.roomId
  const shareUrl = `${window.location.origin}/${roomState.id}`
  const isHost = Boolean(socket && roomState.hostSocketId === socket.id)
  const roomStatus = gameStatus || roomState.status || 'waiting'
  const canEdit = isHost && roomStatus === 'waiting'
  const myPlayerId = roomSession.playerId
  const myUser = useMemo(
    () => roomState.users.find((user) => user.playerId === myPlayerId),
    [roomState.users, myPlayerId],
  )
  const rankOptions = useMemo(() => {
    const hand = turnUpdate?.yourHand ?? []
    const uniqueRanks = new Set(hand.map((card) => card.rank))
    return RANK_ORDER.filter((rank) => uniqueRanks.has(rank))
  }, [turnUpdate])

  const isMyTurn = Boolean(turnUpdate && myPlayerId && turnUpdate.currentPlayerId === myPlayerId)
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
    return turnUpdate.lastBetPlayerId !== myPlayerId
  }, [turnUpdate, isInRound, hasCurrentBet, myPlayerId])
  const nameBySocketId = useMemo(
    () =>
      roomState.users.reduce<Record<string, string>>((acc, user) => {
        acc[user.playerId] = user.name
        return acc
      }, {}),
    [roomState.users],
  )

  const nameBySocketIdRef = useRef(nameBySocketId)
  const roomUsersRef = useRef(roomState.users)
  const roomStatusRef = useRef(roomStatus)
  useEffect(() => {
    nameBySocketIdRef.current = nameBySocketId
  }, [nameBySocketId])
  useEffect(() => {
    roomUsersRef.current = roomState.users
  }, [roomState.users])
  useEffect(() => {
    roomStatusRef.current = roomStatus
  }, [roomStatus])

  const lastBettorId = turnUpdate?.lastBetPlayerId ?? ''
  const lastBettorName = lastBettorId ? nameBySocketId[lastBettorId] ?? '' : ''
  const lastBettorUser = useMemo(
    () => (lastBettorId ? roomState.users.find((u) => u.playerId === lastBettorId) : undefined),
    [lastBettorId, roomState.users],
  )
  const handThemeId = theme1.pokerFelt.green.characterFolder
  const handThemeCharacterCount = getCharacterCount(handThemeId)
  const profileEditPreviewUrl = useMemo(
    () =>
      getCharacterImageUrlByIndex(
        handThemeId,
        Math.min(Math.max(0, profileEditCharacterIndex), Math.max(0, handThemeCharacterCount - 1)),
      ),
    [handThemeId, handThemeCharacterCount, profileEditCharacterIndex],
  )
  const lastBettorAvatarUrl = useMemo(() => {
    if (!lastBettorUser) return ''
    const n = getCharacterCount(handThemeId)
    return getCharacterImageUrlByIndex(
      handThemeId,
      Math.min(Math.max(0, lastBettorUser.characterIndex), n - 1),
    )
  }, [lastBettorUser, handThemeId])
  const hasLastBettorUi = Boolean(
    lastBettorId && (lastBettorName || lastBettorUser?.name),
  )
  const currentBet = turnUpdate?.currentBet
  const hasLastBetUi = Boolean(
    currentBet && currentBet.count > 0 && currentBet.rank,
  )
  const pileCount = turnUpdate?.pileCount ?? 0
  const pileVisualCount = pileCount === 0 ? 1 : Math.min(8, Math.max(1, pileCount))

  const lastKnownPileCountRef = useRef(0)
  const [pileFlushExit, setPileFlushExit] = useState<{ from: number } | null>(null)
  useLayoutEffect(() => {
    lastKnownPileCountRef.current = pileCount
  }, [pileCount])

  const handlePileFlushAnimEnd = (e: AnimationEvent<HTMLDivElement>) => {
    if (e.animationName !== PILE_STACK_FLUSH_RIGHT_NAME) {
      return
    }
    setPileFlushExit(null)
  }

  // If animation is skipped (e.g. some browsers with reduced motion), still clear the flush layer.
  useEffect(() => {
    if (!pileFlushExit) return
    const t = window.setTimeout(() => setPileFlushExit(null), 700)
    return () => window.clearTimeout(t)
  }, [pileFlushExit])

  useEffect(() => {
    if (isInRound) return
    setPileFlushExit(null)
    lastKnownPileCountRef.current = 0
  }, [isInRound])

  useEffect(() => {
    if (!socket) {
      return
    }

    const showSocketDisconnectModal = () => {
      if (roomStatusRef.current === 'waiting') return
      setSocketDisconnectModalOpen(true)
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
    const onTurnUpdate = (payload: TurnUpdatePayload) => {
      setOpenCallReveal(null)
      if (payload.pileCount > 0) {
        setPileFlushExit(null)
      }
      setTurnUpdate(payload)
      setGameStatus(payload.status || 'in_round')
    }
    socket.on('turn_update', onTurnUpdate)
    const onRoundReset = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      const reason = (raw as { reason?: string }).reason
      if (reason !== 'pass_flush') return
      const n = lastKnownPileCountRef.current
      if (n > 0) {
        setPileFlushExit({ from: n })
      }
    }
    socket.on('round_reset', onRoundReset)
    const onPlayerMove = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      const p = raw as { playerId?: string; count?: number; rank?: string }
      const id = p.playerId
      if (typeof id !== 'string' || !id) return
      const count = typeof p.count === 'number' && Number.isFinite(p.count) ? p.count : 0
      const rank = typeof p.rank === 'string' && p.rank ? p.rank : '?'
      const text = `Bluff ${count} ${rank}`.trim()
      gameToastIdRef.current += 1
      setGameActionToast({ id: gameToastIdRef.current, playerId: id, text })
    }
    const onPlayerPass = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      const p = raw as { playerId?: string }
      const id = p.playerId
      if (typeof id !== 'string' || !id) return
      gameToastIdRef.current += 1
      setGameActionToast({ id: gameToastIdRef.current, playerId: id, text: 'Pass' })
    }
    const onBluffCalled = (raw: unknown) => {
      if (!raw || typeof raw !== 'object') return
      const p = raw as { callerId?: string }
      const id = p.callerId
      if (typeof id !== 'string' || !id) return
      gameToastIdRef.current += 1
      setGameActionToast({ id: gameToastIdRef.current, playerId: id, text: 'Call' })
    }
    socket.on('player_move', onPlayerMove)
    socket.on('player_pass', onPlayerPass)
    socket.on('bluff_called', onBluffCalled)
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
    const onBluffResult = (raw: unknown) => {
      const payload = parseBluffResultPayload(raw)
      if (!payload) return
      const callerUser = roomUsersRef.current.find((u) => u.playerId === payload.callerId)
      const targetUser = roomUsersRef.current.find((u) => u.playerId === payload.targetId)
      const callerName =
        payload.callerName ?? nameBySocketIdRef.current[payload.callerId] ?? callerUser?.name ?? 'Player'
      const targetName =
        payload.targetName ?? nameBySocketIdRef.current[payload.targetId] ?? targetUser?.name ?? 'Player'
      const callerCharacterIndex =
        payload.callerCharacterIndex !== undefined
          ? payload.callerCharacterIndex
          : (callerUser?.characterIndex ?? 0)
      const targetCharacterIndex =
        payload.targetCharacterIndex !== undefined
          ? payload.targetCharacterIndex
          : (targetUser?.characterIndex ?? 0)
      setOpenCallReveal({
        callerId: payload.callerId,
        callerName,
        callerCharacterIndex,
        targetId: payload.targetId,
        targetName,
        targetCharacterIndex,
        wasRight: payload.bluffCaught,
        cards: payload.lastPlayedCards,
        claimedRank: payload.claimedRank,
        claimedCount: payload.claimedCount,
      })
    }
    socket.on('bluff_result', onBluffResult)
    const onDisconnect = () => showSocketDisconnectModal()
    const onConnectError = () => showSocketDisconnectModal()
    const onReconnectFailed = () => showSocketDisconnectModal()
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onConnectError)
    socket.io.on('reconnect_failed', onReconnectFailed)
    socket.on(
      'game_end',
      (payload: { finishedPlayers?: string[]; playerNames?: Record<string, string> }) => {
        setOpenCallReveal(null)
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
      socket.off('turn_update', onTurnUpdate)
      socket.off('round_reset', onRoundReset)
      socket.off('player_move', onPlayerMove)
      socket.off('player_pass', onPlayerPass)
      socket.off('bluff_called', onBluffCalled)
      socket.off('timer_tick')
      socket.off('bluff_result', onBluffResult)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onConnectError)
      socket.io.off('reconnect_failed', onReconnectFailed)
      socket.off('game_end')
    }
  }, [socket, roomId, roomState.id])

  const handleSettingsChange = (p: { turnSeconds: number; totalCards: number }) => {
    if (!socket) return
    socket.emit('room:updateSettings', p)
  }

  const handleStart = (p: { turnSeconds: number; totalCards: number }) => {
    if (!socket) return
    socket.emit('room:start', p)
  }

  const handleRestart = () => {
    if (!socket || !isHost || roomStatus !== 'game_end') return
    socket.emit('room:restart')
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
    const showCopiedToast = () => setShareToastOpen(true)
    const fallbackCopy = (text: string): boolean => {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        return ok
      } catch {
        return false
      }
    }

    try {
      await navigator.clipboard.writeText(shareUrl)
      showCopiedToast()
    } catch (error) {
      if (!fallbackCopy(shareUrl)) {
        console.error('Failed to share/copy room link', error)
      } else {
        showCopiedToast()
      }
    }
  }

  const handleOpenProfileEdit = () => {
    if (!myUser || roomStatus !== 'waiting') return
    setProfileEditName(myUser.name)
    setProfileEditCharacterIndex(myUser.characterIndex)
    setProfileEditError('')
    setProfileEditOpen(true)
  }

  const handleCloseProfileEdit = () => {
    setProfileEditOpen(false)
    setProfileEditError('')
  }

  const handleSaveProfileEdit = () => {
    if (!socket || roomStatus !== 'waiting') return
    const trimmedName = profileEditName.trim()
    if (!trimmedName) {
      setProfileEditError('Name is required.')
      return
    }
    socket.emit('room:updateProfile', {
      name: trimmedName,
      characterIndex: profileEditCharacterIndex,
    })
    setProfileEditOpen(false)
  }

  const handleSocketDisconnectAcknowledge = () => {
    setSocketDisconnectModalOpen(false)
    window.location.href = '/'
  }

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize, { passive: true })
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Safety net: if the deferred turn_update never reaches the client (e.g. dropped
  // socket event), clear the reveal modal after OPEN_REVEAL_SAFETY_MS so the UI
  // does not get stuck.
  useEffect(() => {
    if (!openCallReveal) return
    const timer = window.setTimeout(() => {
      setOpenCallReveal(null)
    }, OPEN_REVEAL_SAFETY_MS)
    return () => window.clearTimeout(timer)
  }, [openCallReveal])

  // When the room flips back to `waiting` (e.g. host pressed Play Again), wipe
  // any stale game-side state so the lobby is pristine for the next round.
  useEffect(() => {
    if (roomStatus !== 'waiting') return
    setTurnUpdate(null)
    setGameEndSummary(null)
    setOpenCallReveal(null)
    setPileFlushExit(null)
    setSelectedCardIds([])
    setGameActionToast(null)
    setRankModalOpen(false)
    lastKnownPileCountRef.current = 0
  }, [roomStatus])

  const hand = turnUpdate?.yourHand ?? []

  return (
    <Box className={`lobby-center room-stage${showGameUi ? ' room-stage--in-game' : ''}`}>
      <Lobby
        room={roomState}
        lastMessage={lastMessage}
        gameActionToast={gameActionToast}
        currentTurnPlayerId={turnUpdate?.currentPlayerId ?? ''}
        turnSecondsLeft={turnUpdate?.secondsLeft}
        gameEnded={isGameEnd}
        playerCardCounts={turnUpdate?.playerCardCounts}
        canEditProfile={roomStatus === 'waiting'}
        myPlayerId={myPlayerId}
        onEditProfile={handleOpenProfileEdit}
      />

      {roomStatus === 'waiting' ? (
        <Box className="room-settings-anchor">
          <RoomSettings
            canEdit={canEdit}
            roomStatus={roomStatus}
            turnSeconds={roomState.turnSeconds ?? 0}
            totalCards={roomState.totalCards ?? 26}
            onSettingsChange={handleSettingsChange}
            onStart={handleStart}
            onShare={handleCopyLink}
          />
        </Box>
      ) : isGameEnd ? (
        <>
          <RankingBoard
            ranking={gameEndSummary?.finishedPlayers ?? []}
            nameBySocketId={nameBySocketId}
            playerNamesFromGame={gameEndSummary?.playerNames}
            users={roomState.users}
          />
          <Box className="game-end-restart">
            {isHost ? (
              <Button
                className="game-end-restart__btn"
                variant="contained"
                color="success"
                onClick={handleRestart}
              >
                Play Again!
              </Button>
            ) : (
              <Typography className="game-end-restart__waiting" component="p">
                Waiting for host to restart…
              </Typography>
            )}
          </Box>
        </>
      ) : (
        <>
        <Paper
          className="game-shell"
          elevation={0}
          square
          sx={{ background: 'transparent', backgroundImage: 'none', boxShadow: 'none' }}
        >
          <Box className="game-center">
            {hasLastBettorUi ? (
              <Box
                className="last-bettor-panel"
                aria-label={lastBettorName || lastBettorUser?.name}
              >
                <Avatar
                  className="last-bettor-panel__avatar"
                  src={lastBettorAvatarUrl || undefined}
                  alt=""
                >
                  {(lastBettorName || lastBettorUser?.name || '?')
                    .trim()
                    .charAt(0)
                    .toUpperCase()}
                </Avatar>
                <Typography className="last-bettor-panel__name" component="span" noWrap title={lastBettorName || lastBettorUser?.name}>
                  {lastBettorName || lastBettorUser?.name}
                </Typography>
              </Box>
            ) : null}

            {pileFlushExit ? (
              <Box
                className="pile-stack pile-stack--flush-exit"
                onAnimationEnd={handlePileFlushAnimEnd}
                aria-label={`Pile of ${pileFlushExit.from} cards, clearing off table`}
              >
                {Array.from({ length: Math.min(8, Math.max(1, pileFlushExit.from)) }).map(
                  (_, i) => {
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
                  },
                )}
                <Box className="pile-count-badge" aria-label={`${pileFlushExit.from} cards in pile`}>
                  {pileFlushExit.from}
                </Box>
              </Box>
            ) : (
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
            )}

            {hasLastBetUi && currentBet ? (
              <Box
                className="last-bet-tile"
                aria-label={`${currentBet.count} times ${currentBet.rank}`}
              >
                <Box className="last-bet-tile__stack">
                  <span className="last-bet-tile__rank-box">{currentBet.rank}</span>
                  <span className="last-bet-tile__mult-badge" aria-hidden>
                    x{currentBet.count}
                  </span>
                </Box>
              </Box>
            ) : null}
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

      <OpenRevealModal
        reveal={openCallReveal}
        themeId={handThemeId}
        cardThemeId={theme1.pokerFelt.green.cardFolder}
      />

      <Dialog
        open={profileEditOpen}
        onClose={handleCloseProfileEdit}
        classes={{ paper: 'rank-modal profile-edit-modal' }}
        slotProps={{ backdrop: { className: 'rank-modal__backdrop' } }}
      >
        <Typography className="rank-modal__title">EDIT PROFILE</Typography>
        <CharacterCardSelector
          themeId={handThemeId}
          selectedIndex={profileEditCharacterIndex}
          onSelect={(idx) => {
            setProfileEditCharacterIndex(idx)
            if (profileEditError) setProfileEditError('')
          }}
        />
        <Box sx={{ mt: 1, display: 'grid', placeItems: 'center' }}>
          <Avatar
            src={profileEditPreviewUrl}
            alt="Selected character"
            sx={{ width: 92, height: 92, border: '2px solid rgba(255,255,255,0.25)' }}
          />
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <TextField
            fullWidth
            value={profileEditName}
            onChange={(e) => {
              setProfileEditName(e.target.value)
              if (profileEditError) setProfileEditError('')
            }}
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
        {profileEditError ? (
          <Typography sx={{ mt: 1, color: '#fca5a5', fontWeight: 600 }}>{profileEditError}</Typography>
        ) : null}
        <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'center', gap: 1.25 }}>
          <Button variant="outlined" onClick={handleCloseProfileEdit}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handleSaveProfileEdit}>
            Save
          </Button>
        </Box>
      </Dialog>

      <Dialog
        open={socketDisconnectModalOpen}
        onClose={handleSocketDisconnectAcknowledge}
        classes={{ paper: 'rank-modal profile-edit-modal' }}
        slotProps={{ backdrop: { className: 'rank-modal__backdrop' } }}
      >
        <Typography className="rank-modal__title">Oops! Socket disconnected</Typography>
        <Typography sx={{ mt: 1, textAlign: 'center', color: '#f1f5f9' }}>
          Connection was lost during the game. You will be taken to home.
        </Typography>
        <Box sx={{ mt: 1.5, display: 'flex', justifyContent: 'center' }}>
          <Button variant="contained" onClick={handleSocketDisconnectAcknowledge}>
            Go Home
          </Button>
        </Box>
      </Dialog>

      <IconButton
        className="room-comment-fab"
        aria-label="Comments"
        onClick={() => dispatch(setCommentOpen(!commentOpen))}
      >
        <ChatIcon />
      </IconButton>
      <Snackbar
        open={shareToastOpen}
        autoHideDuration={1600}
        onClose={() => setShareToastOpen(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" variant="filled" sx={{ py: 0 }}>
          Link copied
        </Alert>
      </Snackbar>
    </Box>
  )
}
