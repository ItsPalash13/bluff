import { useEffect, useRef } from 'react'
import Box from '@mui/material/Box'
import {
  getCharacterCount,
  getCharacterImageUrlByIndex,
} from './characterImageSources'

export type CharacterCardSelectorProps = {
  themeId: string
  selectedIndex: number
  onSelect: (index: number) => void
}

export function CharacterCardSelector({
  themeId,
  selectedIndex,
  onSelect,
}: CharacterCardSelectorProps) {
  const total = getCharacterCount(themeId)
  const selectedRef = useRef<HTMLButtonElement | null>(null)

  const clampToTotal = (i: number) => Math.max(0, Math.min(total - 1, i))
  const safeSelected = clampToTotal(selectedIndex)

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [safeSelected, themeId])

  if (total === 0) return null

  return (
    <Box className="char-select">
      <Box className="char-select__grid" role="group" aria-label="Choose a character">
        {Array.from({ length: total }, (_, index) => {
          const src = getCharacterImageUrlByIndex(themeId, index)
          const selected = index === selectedIndex
          return (
            <button
              key={index}
              ref={selected ? selectedRef : undefined}
              type="button"
              onClick={() => onSelect(index)}
              className={`char-card ${selected ? 'is-selected' : ''}`.trim()}
              aria-pressed={selected}
              aria-label={`Character ${index + 1}`}
            >
              {src ? (
                <img src={src} alt="" loading="lazy" decoding="async" />
              ) : (
                <span className="char-card__fallback">{index + 1}</span>
              )}
            </button>
          )
        })}
      </Box>
    </Box>
  )
}
