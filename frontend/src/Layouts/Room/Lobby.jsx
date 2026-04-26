import { useEffect, useState } from 'react'
import { Avatar, Box, Typography } from '@mui/material'
import crownImg from '../../assets/crown.png'
import { getCharacterImageUrlByIndex, getCharacterCount } from '../../assets/characters/characterImageSources'
import { theme1 } from '../../theme/theme1'

export function Lobby({
  room,
  lastMessage,
  gameActionToast = null,
  currentTurnPlayerId,
  turnSecondsLeft,
  gameEnded = false,
  playerCardCounts,
}) {
  const themeId = theme1.pokerFelt.green.characterFolder
  const totalCharacters = getCharacterCount(themeId)
  const [messageBubbles, setMessageBubbles] = useState({})
  const [actionBubbles, setActionBubbles] = useState({})

  const bubbleTimeoutMs = 1000
  const actionBubbleTimeoutMs = 1000
  const maxBubbleChars = 50

  useEffect(() => {
    if (!lastMessage?.socketId || !lastMessage.message) return
    const normalizedMessage = lastMessage.message.trim().slice(0, maxBubbleChars)
    if (!normalizedMessage) return
    setMessageBubbles((prev) => ({
      ...prev,
      [lastMessage.socketId]: normalizedMessage,
    }))
    const timeout = setTimeout(() => {
      setMessageBubbles((prev) => {
        const next = { ...prev }
        delete next[lastMessage.socketId]
        return next
      })
    }, bubbleTimeoutMs)
    return () => clearTimeout(timeout)
  }, [lastMessage])

  useEffect(() => {
    if (!gameActionToast?.socketId || !gameActionToast.text) return
    const { socketId, text } = gameActionToast
    const normalized = String(text).trim().slice(0, maxBubbleChars) || '—'
    setActionBubbles((prev) => ({ ...prev, [socketId]: normalized }))
    const timeout = setTimeout(() => {
      setActionBubbles((prev) => {
        const next = { ...prev }
        delete next[socketId]
        return next
      })
    }, actionBubbleTimeoutMs)
    return () => clearTimeout(timeout)
  }, [gameActionToast])

  return (
    <Box className="lobby-layout">
      <Box className="lobby-top">
        {room.users.map((user) => {
          const avatarUrl = getCharacterImageUrlByIndex(themeId, Math.min(user.characterIndex, totalCharacters - 1))
          const isHost = user.socketId === room.hostSocketId
          const isCurrentTurn = Boolean(!gameEnded && currentTurnPlayerId && user.socketId === currentTurnPlayerId)
          const actionMessage = actionBubbles[user.socketId]
          const chatMessage = messageBubbles[user.socketId]
          const bubbleMessage = actionMessage || chatMessage
          const bubbleIsAction = Boolean(actionMessage)
          const hasTurnTimer = (room.turnSeconds ?? 0) > 0
          const totalTurnSeconds = Math.max(1, room.turnSeconds || 1)
          const currentSeconds =
            hasTurnTimer && typeof turnSecondsLeft === 'number' && turnSecondsLeft >= 0
              ? Math.max(0, turnSecondsLeft)
              : hasTurnTimer
                ? totalTurnSeconds
                : 0
          const timeRemainingRatio = hasTurnTimer
            ? Math.max(0, Math.min(1, currentSeconds / totalTurnSeconds))
            : 0
          const turnProgressPercent = timeRemainingRatio * 100
          // Full time: yellow (hue 48). Near zero: red (hue 0).
          const turnFillColor = `hsl(${48 * timeRemainingRatio}deg 92% 50%)`
          return (
            <Box key={user.socketId} className="lobby-seat">
              <Box sx={{ position: 'relative' }}>
                {bubbleMessage ? (
                  <Box
                    className={
                      bubbleIsAction
                        ? 'lobby-seat__message-tooltip lobby-seat__message-tooltip--action'
                        : 'lobby-seat__message-tooltip'
                    }
                    role="status"
                    aria-live="polite"
                  >
                    <Typography
                      className={
                        bubbleIsAction ? 'lobby-seat__message lobby-seat__message--action' : 'lobby-seat__message'
                      }
                    >
                      {bubbleMessage}
                    </Typography>
                  </Box>
                ) : null}
                <Avatar
                  src={avatarUrl}
                  alt={user.name}
                  sx={{
                    width: 64,
                    height: 64,
                    border: isCurrentTurn ? '3px solid #22c55e' : '2px solid #cbd5e1',
                    boxShadow: isCurrentTurn ? '0 0 0 3px rgba(34, 197, 94, 0.25)' : 'none',
                  }}
                />
                {isHost ? (
                  <Box className="lobby-seat__host-crown">
                    <img src={crownImg} alt="" className="lobby-seat__host-crown-img" />
                  </Box>
                ) : null}
                {playerCardCounts && typeof playerCardCounts[user.socketId] === 'number' ? (
                  <span className="lobby-seat__card-count" title="Cards in hand" aria-label={`${playerCardCounts[user.socketId]} cards`}>
                    {playerCardCounts[user.socketId]}
                  </span>
                ) : null}
              </Box>
              <Typography className="lobby-seat__name">{user.name}</Typography>
              {isCurrentTurn && hasTurnTimer ? (
                <Box className="lobby-seat__turn-progress-row" aria-label="Turn progress">
                  <Box className="lobby-seat__turn-progress">
                    <Box
                      className="lobby-seat__turn-progress-fill"
                      sx={{
                        width: `${turnProgressPercent}%`,
                        backgroundColor: turnFillColor,
                        boxShadow: `0 0 8px hsla(${48 * timeRemainingRatio}deg 90% 45% / 0.45)`,
                      }}
                    />
                  </Box>
                </Box>
              ) : null}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
