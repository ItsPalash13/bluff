import {
  getPlayingCardAltText,
  getPlayingCardKey,
  type PlayingCardProps,
} from './playingCardTypes'
import { getPlayingCardImageUrl } from './playingCardSources'
import { theme1 } from '../../theme/theme1'
import './PlayingCard.css'

export function PlayingCard({
  themeId = theme1.pokerFelt.green.cardFolder,
  label,
  rank,
  className = '',
  alt,
}: PlayingCardProps) {
  const key = getPlayingCardKey(label, rank)
  const src = getPlayingCardImageUrl(themeId, key)
  const defaultAlt = getPlayingCardAltText(label, rank)

  if (!src) {
    return (
      <div
        className={`playing-card playing-card--missing ${className}`.trim()}
        role="img"
        aria-label={alt ?? defaultAlt}
      />
    )
  }

  return (
    <img
      className={`playing-card ${className}`.trim()}
      src={src}
      alt={alt ?? defaultAlt}
      loading="lazy"
      decoding="async"
    />
  )
}
