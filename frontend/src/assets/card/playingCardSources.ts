import { getCardImageUrl } from './cardImageSources'

export function getPlayingCardImageUrl(
  themeId: string,
  key: string,
): string | undefined {
  return getCardImageUrl(themeId, key)
}
