import { useEffect, useState } from 'react'
import { Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material'
import type { SelectChangeEvent } from '@mui/material/Select'

type RoomSettingsProps = {
  canEdit: boolean
  roomStatus: string
  turnSeconds: number
  totalCards: number
  capacity: number
  onSettingsChange: (p: { turnSeconds: number; capacity: number; totalCards: number }) => void
  onStart: (p: { turnSeconds: number; totalCards: number }) => void
  onShare: () => void
}

const TURN_TIME_OPTIONS = [0, 15, 20, 30, 45, 60] as const
const TOTAL_CARD_OPTIONS = [
  { value: 26, label: '1/2 deck' },
  { value: 39, label: '3/4 deck' },
  { value: 52, label: 'Full deck' },
] as const

export function RoomSettings({
  canEdit,
  roomStatus,
  turnSeconds: turnSecondsProp,
  totalCards: totalCardsProp,
  capacity: capacityProp,
  onSettingsChange,
  onStart,
  onShare,
}: RoomSettingsProps) {
  const [turnSeconds, setTurnSeconds] = useState(turnSecondsProp)
  const [totalCards, setTotalCards] = useState(totalCardsProp)

  const isWaiting = roomStatus === 'waiting'
  const disabled = !canEdit || !isWaiting

  useEffect(() => {
    setTurnSeconds(turnSecondsProp)
  }, [turnSecondsProp])

  useEffect(() => {
    setTotalCards(totalCardsProp)
  }, [totalCardsProp])

  const pushUpdate = (next: { turnSeconds: number; capacity: number; totalCards: number }) => {
    if (disabled) return
    onSettingsChange(next)
  }

  const handleTurnChange = (e: SelectChangeEvent<number>) => {
    const v = Number(e.target.value)
    setTurnSeconds(v)
    pushUpdate({ turnSeconds: v, capacity: capacityProp, totalCards })
  }

  const handleTotalCardsChange = (e: SelectChangeEvent<number>) => {
    const v = Number(e.target.value)
    setTotalCards(v)
    pushUpdate({ turnSeconds, capacity: capacityProp, totalCards: v })
  }

  return (
    <Box
      sx={{
        width: 'min(460px, 100%)',
        borderRadius: '14px',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        background: 'rgba(0, 0, 0, 0.38)',
        border: '1px solid rgba(255, 255, 255, 0.22)',
      }}
    >
      <Typography variant="h6" sx={{ color: '#f8fafc', m: 0 }}>
        Room Settings
      </Typography>

      {!isWaiting ? (
        <Typography sx={{ color: 'rgba(252, 211, 77, 0.95)', fontSize: '0.9rem' }}>
          Settings are locked while the game is in progress.
        </Typography>
      ) : !canEdit ? (
        <Typography sx={{ color: 'rgba(203, 213, 225, 0.95)', fontSize: '0.9rem' }}>
          Waiting for the host to start the game.
        </Typography>
      ) : null}

      <FormControl size="small" fullWidth>
        <InputLabel id="turn-time-label">Turn time</InputLabel>
        <Select
          labelId="turn-time-label"
          value={turnSeconds}
          label="Turn time"
          disabled={disabled}
          onChange={handleTurnChange}
        >
          {TURN_TIME_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              {s === 0 ? 'No timer' : `${s}s`}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth>
        <InputLabel id="total-cards-label">Total Cards</InputLabel>
        <Select
          labelId="total-cards-label"
          value={totalCards}
          label="Total Cards"
          disabled={disabled}
          onChange={handleTotalCardsChange}
        >
          {TOTAL_CARD_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>
              {option.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
        <Button variant="outlined" color="inherit" onClick={onShare}>
          Share
        </Button>
        <Button
          variant="contained"
          disabled={!canEdit || !isWaiting}
          onClick={() => onStart({ turnSeconds, totalCards })}
        >
          Start
        </Button>
      </Stack>
    </Box>
  )
}
