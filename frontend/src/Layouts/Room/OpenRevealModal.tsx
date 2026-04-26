import { useLayoutEffect, useRef, useState } from 'react'
import { Avatar, Box, Dialog, Grow, Typography } from '@mui/material'
import { PlayingCard, toPlayingCardProps } from '../../assets/card/PlayingCard'
import { getCharacterCount, getCharacterImageUrlByIndex } from '../../assets/characters/characterImageSources'
import backMaroon from '../../assets/card/png/2x/back-maroon.png'
import type { GameCard } from '../roomTypes'

export type OpenReveal = {
  callerId: string
  callerName: string
  callerCharacterIndex: number
  targetId: string
  targetName: string
  targetCharacterIndex: number
  /** true when the last bet was a bluff and the open call was right — show CAUGHT. */
  wasRight: boolean
  cards: GameCard[]
  claimedRank: string
  claimedCount: number
}

type OpenRevealModalProps = {
  reveal: OpenReveal | null
  themeId: string
  cardThemeId?: string
}

const REVEAL_MODAL_APPEAR_MS = 420
const REVEAL_MODAL_DISMISS_MS = 300

export function OpenRevealModal({ reveal, themeId, cardThemeId }: OpenRevealModalProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [display, setDisplay] = useState<OpenReveal | null>(null)
  const revealRef = useRef<OpenReveal | null>(reveal)
  useLayoutEffect(() => {
    revealRef.current = reveal
  }, [reveal])

  useLayoutEffect(() => {
    if (reveal) {
      setDisplay(reveal)
      setDialogOpen(true)
    } else {
      setDialogOpen(false)
    }
  }, [reveal])

  const handleExited = () => {
    if (revealRef.current === null) {
      setDisplay(null)
    }
  }

  const data = display ?? reveal
  if (!data) return null

  const charCount = getCharacterCount(themeId)
  const callerIdx = Math.min(Math.max(0, data.callerCharacterIndex), Math.max(0, charCount - 1))
  const targetIdx = Math.min(Math.max(0, data.targetCharacterIndex), Math.max(0, charCount - 1))
  const callerAvatarUrl = charCount > 0 ? getCharacterImageUrlByIndex(themeId, callerIdx) : ''
  const targetAvatarUrl = charCount > 0 ? getCharacterImageUrlByIndex(themeId, targetIdx) : ''
  const caught = data.wasRight

  const verdictClass = caught
    ? 'open-reveal-modal__verdict open-reveal-modal__verdict--caught'
    : 'open-reveal-modal__verdict open-reveal-modal__verdict--tricked'
  const verdictText = caught ? 'CAUGHT' : 'TRICKED'
  const verdictSub =
    caught
      ? `${data.callerName} caught ${data.targetName}'s bluff`
      : `${data.targetName} tricked ${data.callerName}`

  return (
    <Dialog
      open={dialogOpen}
      onClose={() => {}}
      keepMounted
      classes={{ paper: 'open-reveal-modal' }}
      slots={{ transition: Grow }}
      slotProps={{
        transition: {
          timeout: { enter: REVEAL_MODAL_APPEAR_MS, exit: REVEAL_MODAL_DISMISS_MS },
          onExited: handleExited,
        } as { timeout: { enter: number; exit: number }; onExited: () => void },
        backdrop: { className: 'open-reveal-modal__backdrop' },
      }}
    >
      <Typography className="open-reveal-modal__title">CARDS REVEALED</Typography>

      <Box className="open-reveal-modal__versus" aria-label={verdictSub}>
        <Box className="open-reveal-modal__player">
          <Avatar
            className="open-reveal-modal__avatar"
            src={callerAvatarUrl || undefined}
            alt=""
          >
            {(data.callerName || '?').trim().charAt(0).toUpperCase()}
          </Avatar>
          <Typography className="open-reveal-modal__name" component="span" noWrap>
            {data.callerName || 'Player'}
          </Typography>
          <Typography className="open-reveal-modal__role" component="span">
            Open
          </Typography>
        </Box>

        <Typography className="open-reveal-modal__vs" component="span" aria-hidden>
          vs
        </Typography>

        <Box className="open-reveal-modal__player">
          <Avatar
            className="open-reveal-modal__avatar"
            src={targetAvatarUrl || undefined}
            alt=""
          >
            {(data.targetName || '?').trim().charAt(0).toUpperCase()}
          </Avatar>
          <Typography className="open-reveal-modal__name" component="span" noWrap>
            {data.targetName || 'Player'}
          </Typography>
          <Typography className="open-reveal-modal__role" component="span">
            Last bet
          </Typography>
        </Box>
      </Box>

      <Box className={verdictClass} aria-label={verdictText}>
        {verdictText}
      </Box>

      <Typography className="open-reveal-modal__verdict-sub">{verdictSub}</Typography>

      <Typography className="open-reveal-modal__claim">
        {`Claimed: ${data.claimedCount}× ${data.claimedRank}`}
      </Typography>

      <Box className="open-reveal-modal__cards" role="img" aria-label="Revealed cards">
        {data.cards.length === 0 ? (
          <Typography className="open-reveal-modal__empty">No cards</Typography>
        ) : (
          data.cards.map((card, i) => (
            <RevealFlipCard key={card.id} card={card} index={i} cardThemeId={cardThemeId} />
          ))
        )}
      </Box>
    </Dialog>
  )
}

function RevealFlipCard({
  card,
  index,
  cardThemeId,
}: {
  card: GameCard
  index: number
  cardThemeId?: string
}) {
  const cardProps = toPlayingCardProps(card)
  return (
    <div className="open-reveal-flip">
      <div
        className="open-reveal-flip__inner"
        aria-hidden
        style={{ animationDelay: `${index * 0.1}s` }}
      >
        <div className="open-reveal-flip__face open-reveal-flip__face--back">
          <img src={backMaroon} alt="" className="open-reveal-flip__back-img" draggable={false} />
        </div>
        <div className="open-reveal-flip__face open-reveal-flip__face--front">
          <PlayingCard
            themeId={cardThemeId}
            label={cardProps.label}
            rank={cardProps.rank}
            className="open-reveal-flip__playing-card"
          />
        </div>
      </div>
    </div>
  )
}
