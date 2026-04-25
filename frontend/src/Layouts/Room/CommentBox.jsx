import { useMemo, useState } from 'react'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import { IconButton, InputBase, Paper, Stack, useMediaQuery } from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
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
    <ClickAwayListener onClickAway={handleClose}>
      <Paper
        elevation={0}
        sx={{
          position: 'fixed',
          left: isMobile ? 0 : '50%',
          transform: isMobile ? 'none' : 'translateX(-50%)',
          bottom: 16,
          width: isMobile ? '100vw' : 400,
          maxWidth: '100%',
          borderRadius: isMobile ? '14px 14px 0 0' : 14,
          p: 1.5,
          zIndex: 1400,
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
        }}
      >
        <Stack spacing={1}>
          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
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

          <Paper
            component="form"
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            sx={{
              p: '2px 4px',
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              borderRadius: '10px',
              background: '#ffffff',
            }}
          >
            <InputBase
              sx={{ ml: 1, flex: 1, color: '#0f172a' }}
              placeholder="Type a comment..."
              value={draftMessage}
              onChange={(e) => setDraftMessage(e.target.value)}
              inputProps={{ 'aria-label': 'type a comment' }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <IconButton
              type="button"
              color="primary"
              sx={{ p: '10px' }}
              aria-label="Send comment"
              disabled={!canSend}
              onClick={handleSend}
            >
              <SendIcon />
            </IconButton>
          </Paper>
        </Stack>
      </Paper>
    </ClickAwayListener>
  )
}
