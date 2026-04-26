import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { PlayingCard, toPlayingCardProps } from '../../../assets/card/PlayingCard'
import { handCardMarginAfterFirst } from './handLayout'
import type { GameCard } from '../../roomTypes'

const DESKTOP_HAND_OPTS = {
  widthFrac: 0.9,
  horizontalInset: 32,
} as const

type HandDockDesktopProps = {
  hand: GameCard[]
  selectedCardIds: string[]
  isMyTurn: boolean
  isInRound: boolean
  onToggle: (cardId: string) => void
  viewportWidth: number
}

export function HandDockDesktop({
  hand,
  selectedCardIds,
  isMyTurn,
  isInRound,
  onToggle,
  viewportWidth,
}: HandDockDesktopProps) {
  const handCount = hand.length
  const handOverlapPx = useMemo(
    () => handCardMarginAfterFirst(handCount, viewportWidth, DESKTOP_HAND_OPTS),
    [handCount, viewportWidth],
  )

  return (
    <Box className="room-hand-dock room-hand-dock--desktop" role="region" aria-label="Your hand">
      <Box className="hand-row">
        <Box className="hand-row__peek" role="list" aria-label="Your cards">
          {hand.map((card, i) => {
            const cardProps = toPlayingCardProps(card)
            const selected = selectedCardIds.includes(card.id)
            const disabled =
              !isMyTurn || !isInRound || (!selected && selectedCardIds.length >= 4)
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
                  marginLeft: i === 0 ? 0 : `${handOverlapPx}px`,
                }}
              />
            )
          })}
          {hand.length === 0 ? (
            <Typography className="hand-row__empty">No cards in hand.</Typography>
          ) : null}
        </Box>
      </Box>
    </Box>
  )
}
