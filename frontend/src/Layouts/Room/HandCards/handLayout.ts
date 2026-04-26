import type { GameCard } from '../../roomTypes'

const HAND_CARD_VW = 0.125
const HAND_CARD_W_PX = { min: 80, max: 140 } as const

export type HandLayoutOptions = {
  /** Fraction of `innerWidth` for the hand strip (e.g. 0.9 dock, 0.97 phone) */
  widthFrac: number
  /** Horizontal padding / safe slop in px */
  horizontalInset: number
}

const defaultOptions: HandLayoutOptions = {
  widthFrac: 0.9,
  horizontalInset: 32,
}

/**
 * `marginLeft` for cards 2+ (px). Row span = n·W + (n−1)·m ≤ available width.
 */
export function handCardMarginAfterFirst(
  n: number,
  innerWidth: number,
  options: Partial<HandLayoutOptions> = {},
): number {
  if (n <= 1) return 0
  const w = Math.max(320, innerWidth)
  const { widthFrac, horizontalInset } = { ...defaultOptions, ...options }
  const W = Math.min(
    HAND_CARD_W_PX.max,
    Math.max(HAND_CARD_W_PX.min, HAND_CARD_VW * w),
  )
  const avail = Math.max(0, widthFrac * w - horizontalInset)
  const m = (avail - n * W) / (n - 1)
  if (m >= 0) {
    return Math.min(10, Math.round(m))
  }
  return Math.round(m)
}

/**
 * At most `maxRows` rows; for small hands, a single row. Otherwise roughly ceil(n/4) rows capped at 4.
 */
export function splitHandIntoRows(cards: GameCard[], maxRows: number): GameCard[][] {
  const n = cards.length
  if (n === 0) return []
  if (n <= 4) {
    return [cards]
  }
  const rowCount = Math.min(maxRows, Math.max(1, Math.ceil(n / 4)))
  return chunkEvenly(cards, rowCount)
}

function chunkEvenly<T>(arr: T[], numChunks: number): T[][] {
  if (numChunks <= 0 || arr.length === 0) return []
  const n = arr.length
  const base = Math.floor(n / numChunks)
  const rem = n % numChunks
  const out: T[][] = []
  let i = 0
  for (let r = 0; r < numChunks; r++) {
    const len = base + (r < rem ? 1 : 0)
    out.push(arr.slice(i, i + len))
    i += len
  }
  return out
}

export const handLayoutMeta = { HAND_CARD_VW, HAND_CARD_W_PX } as const
