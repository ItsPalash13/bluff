export type CardSuit = 'club' | 'diamond' | 'heart' | 'spade'
export type CardLabel = CardSuit | 'joker'

export type PipRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
export type FaceRank = 'jack' | 'queen' | 'king'
export type JokerColor = 'black' | 'red'
export type StandardRank = PipRank | FaceRank

export type CardRank = StandardRank | JokerColor

export type PlayingCardProps = {
  /** Card theme folder under `assets/card/png/`. */
  themeId?: string
  label: CardLabel
  rank: CardRank
  className?: string
  /** Override default alt (e.g. "diamond 6") */
  alt?: string
}

function rankFileSegment(rank: CardRank): string {
  if (typeof rank === 'number') return String(rank)
  return rank
}

export function getPlayingCardKey(
  label: CardLabel,
  rank: CardRank,
): string {
  return `${label}_${rankFileSegment(rank)}`
}

export function getPlayingCardAltText(
  label: CardLabel,
  rank: CardRank,
): string {
  return `${label} ${rankFileSegment(rank)}`.replace(/_/g, ' ')
}
