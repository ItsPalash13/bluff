import { useEffect, useState } from 'react'
import {
  Avatar,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ExitToAppIcon from '@mui/icons-material/ExitToApp'
import ChatIcon from '@mui/icons-material/Chat'
import { getCharacterImageUrlByIndex, getCharacterCount } from '../../assets/characters/characterImageSources'
import { theme1 } from '../../theme/theme1'

export function Lobby({ room, currentName, lastMessage, commentOpen, onCommentToggle, onLeave }) {
  const themeId = theme1.pokerFelt.green.characterFolder
  const totalCharacters = getCharacterCount(themeId)
  const shareUrl = `${window.location.origin}/${room.id}`
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

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch (error) {
      console.error('Failed to copy room link', error)
    }
  }

  return (
    <Box
      sx={{
        width: 'min(500px, 100%)',
        borderRadius: '14px',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        background: 'rgba(0, 0, 0, 0.38)',
        border: '1px solid rgba(255, 255, 255, 0.22)',
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6" sx={{ color: '#f8fafc' }}>
          Lobby
        </Typography>
        <Chip color="primary" label={`${room.users.length}/${room.capacity}`} />
      </Stack>

      <Typography sx={{ color: '#cbd5e1' }}>
        Welcome, <strong>{currentName}</strong>. Share this room code: <strong>{room.id}</strong>
      </Typography>

      <Stack direction="row" spacing={1}>
        <Button variant="outlined" startIcon={<ChatIcon />} onClick={() => onCommentToggle(!commentOpen)}>
          Comments
        </Button>
        <Button variant="outlined" startIcon={<ContentCopyIcon />} onClick={handleCopyLink}>
          Copy Link
        </Button>
        <Button variant="outlined" color="inherit" startIcon={<ExitToAppIcon />} onClick={onLeave}>
          Leave
        </Button>
      </Stack>

      <List dense sx={{ bgcolor: 'rgba(15, 23, 42, 0.35)', borderRadius: 2 }}>
        {room.users.map((user) => {
          const avatarUrl = getCharacterImageUrlByIndex(themeId, Math.min(user.characterIndex, totalCharacters - 1))
          const isHost = user.socketId === room.hostSocketId
          return (
            <ListItem
              key={user.socketId}
              secondaryAction={isHost ? <Chip size="small" color="warning" label="Host" /> : null}
            >
              <ListItemAvatar>
                <Tooltip
                  open={Boolean(messageBubbles[user.socketId])}
                  title={messageBubbles[user.socketId] ?? ''}
                  placement="top"
                  arrow
                >
                  <Avatar src={avatarUrl} alt={user.name} />
                </Tooltip>
              </ListItemAvatar>
              <ListItemText
                primary={<Typography sx={{ color: '#f8fafc', fontWeight: 600 }}>{user.name}</Typography>}
                secondary={
                  <Typography sx={{ color: '#cbd5e1' }}>
                    {`Character ${Math.max(1, user.characterIndex + 1)}`}
                  </Typography>
                }
              />
            </ListItem>
          )
        })}
      </List>

    </Box>
  )
}
