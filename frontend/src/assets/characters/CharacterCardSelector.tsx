import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded'
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import {
  getCharacterCount,
  getCharacterImageUrlByIndex,
} from './characterImageSources'

const PAGE_SIZE = 5

export type CharacterCardSelectorProps = {
  themeId: string
  selectedIndex: number
  onSelect: (index: number) => void
}

function clamp(i: number): number {
  return Math.max(0, i)
}

export function CharacterCardSelector({
  themeId,
  selectedIndex,
  onSelect,
}: CharacterCardSelectorProps) {
  const total = getCharacterCount(themeId)
  if (total === 0) return null

  const clampToTotal = (i: number) => Math.max(0, Math.min(total - 1, i))
  const safeSelected = clamp(selectedIndex)
  const maxStart = Math.max(0, total - PAGE_SIZE)
  const start = Math.max(0, Math.min(maxStart, clampToTotal(safeSelected) - 2))
  const visible = Array.from({ length: PAGE_SIZE }, (_, i) => start + i).filter(
    (i) => i < total,
  )

  return (
    <Box className="char-strip" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <IconButton
        aria-label="Previous characters"
        onClick={() => onSelect(clampToTotal(safeSelected - 1))}
        disabled={clampToTotal(safeSelected) === 0}
      >
        <ChevronLeftRoundedIcon />
      </IconButton>

      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'stretch' }}>
        {visible.map((index) => {
          const src = getCharacterImageUrlByIndex(themeId, index)
          const selected = index === selectedIndex

          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelect(index)}
              className={`char-card ${selected ? 'is-selected' : ''}`.trim()}
              aria-pressed={selected}
              aria-label={`Character ${index + 1}`}
            >
              {src ? (
                <img src={src} alt={`Character ${index + 1}`} loading="lazy" decoding="async" />
              ) : (
                <span className="char-card__fallback">{index + 1}</span>
              )}
            </button>
          )
        })}
      </Box>

      <IconButton
        aria-label="Next characters"
        onClick={() => onSelect(clampToTotal(safeSelected + 1))}
        disabled={clampToTotal(safeSelected) >= total - 1}
      >
        <ChevronRightRoundedIcon />
      </IconButton>

      <Typography variant="caption" className="char-strip__meta" sx={{ minWidth: 72 }}>
        {start + 1}-{Math.min(total, start + PAGE_SIZE)} / {total}
      </Typography>
    </Box>
  )
}
