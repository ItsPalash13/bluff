import { useMemo, useState } from 'react'
import { IconButton, Paper, Stack, TextField, useMediaQuery } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import ChatIcon from '@mui/icons-material/Chat'
import { useTheme } from '@mui/material/styles'

const QUICK_EMOJIS = ['😀', '😂', '👍', '🔥', '🎉']

export function CommentBox({ open, onClose, onSend }) {
  const [draftMessage, setDraftMessage] = useState('')
  const muiTheme = useTheme()
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'))
  const canSend = useMemo(() => draftMessage.trim().length > 0, [draftMessage])

  if (!open) return null

  const handleSend = () => {
    const message = draftMessage.trim()
    if (!message) return
    onSend(message)
    setDraftMessage('')
  }

  const handleClose = () => {
    setDraftMessage('')
    onClose()
  }

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'fixed',
        left: isMobile ? 0 : '50%',
        transform: isMobile ? 'none' : 'translateX(-50%)',
        bottom: 16,
        width: isMobile ? '100vw' : 460,
        borderRadius: isMobile ? '14px 14px 0 0' : '14px',
        p: 1.5,
        zIndex: 1400,
        background: 'transparent',
        border: 'none',
        boxShadow: 'none',
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={0.5}>
          {QUICK_EMOJIS.map((emoji) => (
            <IconButton
              key={emoji}
              size="small"
              onClick={() => setDraftMessage((prev) => `${prev}${emoji}`)}
              sx={{ color: '#f8fafc' }}
            >
              <span>{emoji}</span>
            </IconButton>
          ))}
        </Stack>

        <Stack direction="row" spacing={1}>
          <IconButton aria-label="Cancel comment" sx={{ color: '#f8fafc' }} onClick={handleClose}>
            <CloseIcon />
          </IconButton>
          <TextField
            fullWidth
            size="small"
            value={draftMessage}
            onChange={(e) => setDraftMessage(e.target.value)}
            placeholder="Type a comment..."
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleSend()
              }
            }}
            sx={{
              '& .MuiInputBase-root': {
                color: '#0f172a',
                background: '#ffffff',
                borderRadius: '10px',
              },
            }}
          />
          <IconButton aria-label="Send comment" sx={{ color: '#f8fafc' }} disabled={!canSend} onClick={handleSend}>
            <ChatIcon />
          </IconButton>
        </Stack>
      </Stack>
    </Paper>
  )
}
