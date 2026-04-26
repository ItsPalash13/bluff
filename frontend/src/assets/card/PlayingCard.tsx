import type { CSSProperties } from 'react'
import {
  getPlayingCardAltText,
  getPlayingCardKey,
  type CardLabel,
  type CardRank,
  type PlayingCardProps,
} from './playingCardTypes'
import { getPlayingCardImageUrl } from './playingCardSources'
import { theme1 } from '../../theme/theme1'
import './PlayingCard.css'

export type PlayingCardInteractiveProps = PlayingCardProps & {
  selected?: boolean
  onClick?: () => void
  disabled?: boolean
  style?: CSSProperties
}

export function PlayingCard({
  themeId = theme1.pokerFelt.green.cardFolder,
  label,
  rank,
  className = '',
  alt,
  selected = false,
  onClick,
  disabled = false,
  style,
}: PlayingCardInteractiveProps) {
  const key = getPlayingCardKey(label, rank)
  const src = getPlayingCardImageUrl(themeId, key)
  const defaultAlt = getPlayingCardAltText(label, rank)

  const interactive = typeof onClick === 'function'
  const classes = [
    'playing-card',
    interactive ? 'playing-card--clickable' : '',
    selected ? 'playing-card--selected' : '',
    disabled ? 'playing-card--disabled' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  if (!src) {
    if (interactive) {
      return (
        <button
          type="button"
          className={`${classes} playing-card--missing`}
          aria-label={alt ?? defaultAlt}
          aria-pressed={selected}
          onClick={disabled ? undefined : onClick}
          disabled={disabled}
          style={style}
        />
      )
    }
    return (
      <div
        className={`${classes} playing-card--missing`}
        role="img"
        aria-label={alt ?? defaultAlt}
        style={style}
      />
    )
  }

  if (interactive) {
    return (
      <button
        type="button"
        className={classes}
        aria-label={alt ?? defaultAlt}
        aria-pressed={selected}
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
        style={style}
      >
        <img src={src} alt="" loading="lazy" decoding="async" draggable={false} />
      </button>
    )
  }

  return (
    <img
      className={classes}
      src={src}
      alt={alt ?? defaultAlt}
      loading="lazy"
      decoding="async"
      style={style}
    />
  )
}

const SUIT_BY_LETTER: Record<string, CardLabel> = {
  S: 'spade',
  H: 'heart',
  D: 'diamond',
  C: 'club',
}

const RANK_BY_LETTER: Record<string, CardRank> = {
  A: 1,
  K: 'king',
  Q: 'queen',
  J: 'jack',
  '10': 10,
  '9': 9,
  '8': 8,
  '7': 7,
  '6': 6,
  '5': 5,
  '4': 4,
  '3': 3,
  '2': 2,
}

/**
 * Convert a server `GameCard { rank, suit }` (e.g. rank "A".."2", suit "S/H/D/C")
 * into props expected by `PlayingCard` ({ label, rank }).
 */
export function toPlayingCardProps(card: { rank: string; suit: string }): {
  label: CardLabel
  rank: CardRank
} {
  const label = SUIT_BY_LETTER[card.suit?.toUpperCase()] ?? 'spade'
  const rank = RANK_BY_LETTER[card.rank?.toUpperCase()] ?? 1
  return { label, rank }
}
