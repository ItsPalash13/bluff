import { useEffect, useState } from 'react'
import { Avatar, Box, Typography } from '@mui/material'
import crownImg from '../../assets/crown.png'
import { getCharacterImageUrlByIndex, getCharacterCount } from '../../assets/characters/characterImageSources'
import { theme1 } from '../../theme/theme1'

export function Lobby({ room, lastMessage }) {
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

  const getSeatStyle = (index, total) => {
    const safeTotal = Math.max(1, total)
    const t = safeTotal === 1 ? 0.5 : index / (safeTotal - 1)
    const start = -70
    const end = 70
    const angleDeg = start + (end - start) * t
    const radians = (angleDeg * Math.PI) / 180
    const radiusX = 38
    const radiusY = 28
    const left = 50 + radiusX * Math.sin(radians)
    const top = 40 - radiusY * Math.cos(radians)
    return {
      left: `${left}%`,
      top: `${top}%`,
    }
  }

  return (
    <Box className="lobby-layout">
      <Box className="lobby-arc">
        {room.users.map((user, index) => {
          const avatarUrl = getCharacterImageUrlByIndex(themeId, Math.min(user.characterIndex, totalCharacters - 1))
          const isHost = user.socketId === room.hostSocketId
          return (
            <Box key={user.socketId} className="lobby-seat" sx={getSeatStyle(index, room.users.length)}>
              <Box sx={{ position: 'relative' }}>
                <Avatar src={avatarUrl} alt={user.name} sx={{ width: 72, height: 72, border: '2px solid #cbd5e1' }} />
                {isHost ? (
                  <Box className="lobby-seat__host-crown">
                    <img src={crownImg} alt="" className="lobby-seat__host-crown-img" />
                  </Box>
                ) : null}
              </Box>
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
