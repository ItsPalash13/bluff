import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { PlayingCard, toPlayingCardProps } from '../../../assets/card/PlayingCard'
import { handCardMarginAfterFirst, splitHandIntoRows } from './handLayout'
import type { GameCard } from '../../roomTypes'

const MOBILE_HAND_OPTS = {
  widthFrac: 0.97,
  horizontalInset: 20,
} as const

const MAX_ROWS = 4
/** Pixels: lower row overlaps the row above (fan stacks downward) */
const ROW_OVERLAP_PX = 22

type HandRackMobileProps = {
  hand: GameCard[]
  selectedCardIds: string[]
  isMyTurn: boolean
  isInRound: boolean
  onToggle: (cardId: string) => void
  viewportWidth: number
}

export function HandRackMobile({
  hand,
  selectedCardIds,
  isMyTurn,
  isInRound,
  onToggle,
  viewportWidth,
}: HandRackMobileProps) {
  const rows = useMemo(() => splitHandIntoRows(hand, MAX_ROWS), [hand])

  if (rows.length === 0) {
    return (
      <Box className="hand-rack-mobile" aria-label="Your hand">
        <Typography className="hand-rack-mobile__empty">No cards in hand.</Typography>
      </Box>
    )
  }

  return (
    <Box className="hand-rack-mobile" aria-label="Your hand">
      {rows.map((row, rowIndex) => {
        const overlap = handCardMarginAfterFirst(
          row.length,
          viewportWidth,
          MOBILE_HAND_OPTS,
        )
        return (
          <Box
            key={rowIndex}
            className="hand-rack-mobile__row"
            role="list"
            style={{
              zIndex: rowIndex + 1,
              marginTop: rowIndex === 0 ? 0 : -ROW_OVERLAP_PX,
              paddingTop: rowIndex === 0 ? 20 : 0,
            }}
          >
            {row.map((card, i) => {
              const cardProps = toPlayingCardProps(card)
              const selected = selectedCardIds.includes(card.id)
              const disabled =
                !isMyTurn ||
                !isInRound ||
                (!selected && selectedCardIds.length >= 4)
              return (
                <PlayingCard
                  key={card.id}
                  label={cardProps.label}
                  rank={cardProps.rank}
                  selected={selected}
                  disabled={disabled}
                  onClick={() => onToggle(card.id)}
                  style={{
                    position: 'relative',
                    zIndex: i + 1,
                    marginLeft: i === 0 ? 0 : `${overlap}px`,
                  }}
                />
              )
            })}
          </Box>
        )
      })}
    </Box>
  )
}
