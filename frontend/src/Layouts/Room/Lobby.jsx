import { useEffect, useState } from 'react'
import { Avatar, Box, Typography } from '@mui/material'
import crownImg from '../../assets/crown.png'
import { getCharacterImageUrlByIndex, getCharacterCount } from '../../assets/characters/characterImageSources'
import { theme1 } from '../../theme/theme1'

export function Lobby({ room, lastMessage, currentTurnPlayerId, turnSecondsLeft }) {
  const themeId = theme1.pokerFelt.green.characterFolder
  const totalCharacters = getCharacterCount(themeId)
  const [messageBubbles, setMessageBubbles] = useState({})

  const bubbleTimeoutMs = 1000

  useEffect(() => {
    if (!lastMessage?.socketId || !lastMessage.message) return
    setMessageBubbles((prev) => ({
      ...prev,
      [lastMessage.socketId]: lastMessage.message,
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

  return (
    <Box className="lobby-layout">
      <Box className="lobby-top">
        {room.users.map((user) => {
          const avatarUrl = getCharacterImageUrlByIndex(themeId, Math.min(user.characterIndex, totalCharacters - 1))
          const isHost = user.socketId === room.hostSocketId
          const isCurrentTurn = Boolean(currentTurnPlayerId && user.socketId === currentTurnPlayerId)
          return (
            <Box key={user.socketId} className="lobby-seat">
              <Box sx={{ position: 'relative' }}>
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
              </Box>
              <Typography className="lobby-seat__name">{user.name}</Typography>
              {isCurrentTurn ? (
                <Typography className="lobby-seat__turn-indicator">
                  Turn{typeof turnSecondsLeft === 'number' ? ` - ${Math.max(0, turnSecondsLeft)}s` : ''}
                </Typography>
              ) : null}
              {messageBubbles[user.socketId] ? (
                <Typography className="lobby-seat__message">{messageBubbles[user.socketId]}</Typography>
              ) : null}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}
