import { useMemo, useState } from 'react'
import { Avatar, Box, Button, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material'

type RoomSettingsProps = {
  name: string
  selectedImage?: string
  selectedIndex: number
  totalCharacters: number
}

const TURN_TIME_OPTIONS = [15, 20, 30, 45, 60]
const PLAYER_OPTIONS = [2, 3, 4] as const
const TOTAL_CARD_OPTIONS = [26, 39, 52]

export function RoomSettings({
  name,
  selectedImage,
  selectedIndex,
  totalCharacters,
}: RoomSettingsProps) {
  const [turnSeconds, setTurnSeconds] = useState(30)
  const [players, setPlayers] = useState<2 | 3 | 4>(2)
  const [totalCards, setTotalCards] = useState(26)

  const validTotalCardOptions = useMemo(
    () => TOTAL_CARD_OPTIONS.filter((n) => n >= players * 13),
    [players],
  )

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
      <Stack
        direction="row"
        spacing={1.25}
        sx={{ alignItems: 'center', alignSelf: 'flex-start' }}
      >
        <Avatar src={selectedImage} alt="Selected character" sx={{ width: 44, height: 44 }} />
        <Box>
          <Typography sx={{ color: '#f8fafc', fontWeight: 700, lineHeight: 1.2 }}>
            {name.trim() || 'Player'}
          </Typography>
          <Typography sx={{ color: 'rgba(248, 250, 252, 0.78)', fontSize: '0.85rem' }}>
            Character {Math.min(selectedIndex + 1, Math.max(1, totalCharacters))}/
            {Math.max(1, totalCharacters)}
          </Typography>
        </Box>
      </Stack>

      <Typography variant="h6" sx={{ color: '#f8fafc', m: 0 }}>
        Room Settings
      </Typography>

      <FormControl size="small" fullWidth>
        <InputLabel id="turn-time-label">Turn Time (seconds)</InputLabel>
        <Select
          labelId="turn-time-label"
          value={turnSeconds}
          label="Turn Time (seconds)"
          onChange={(e) => setTurnSeconds(Number(e.target.value))}
        >
          {TURN_TIME_OPTIONS.map((s) => (
            <MenuItem key={s} value={s}>
              {s}s
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" fullWidth>
        <InputLabel id="total-players-label">Total Players</InputLabel>
        <Select
          labelId="total-players-label"
          value={players}
          label="Total Players"
          onChange={(e) => {
            const next = Number(e.target.value) as 2 | 3 | 4
            setPlayers(next)
            const minCards = next * 13
            if (totalCards < minCards) setTotalCards(minCards)
          }}
        >
          {PLAYER_OPTIONS.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
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
          onChange={(e) => setTotalCards(Number(e.target.value))}
        >
          {validTotalCardOptions.map((c) => (
            <MenuItem key={c} value={c}>
              {c}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'flex-end' }}>
        <Button variant="outlined" color="inherit">
          Share
        </Button>
        <Button variant="contained">Start</Button>
      </Stack>
    </Box>
  )
}
