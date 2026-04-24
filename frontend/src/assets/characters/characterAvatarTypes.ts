export const CHARACTER_GRID = 6 as const

export type CharacterIndex = 0 | 1 | 2 | 3 | 4 | 5

export function getCharacterKey(
  row: CharacterIndex,
  col: CharacterIndex,
): string {
  return `img_${row}_${col}`
}

export function getCharacterAltText(
  row: CharacterIndex,
  col: CharacterIndex,
): string {
  return `Character portrait row ${row} column ${col}`
}

export type CharacterAvatarProps = {
  /** `imgs/{themeId}/` jpg set (e.g. jpgs, jpgs1). */
  themeId: string
  row: CharacterIndex
  col: CharacterIndex
  /** Pixel width and height (MUI Avatar is square). Default 64. */
  size?: number
  alt?: string
}

export type CharacterAvatarSelectorProps = {
  themeId: string
  selectedRow: CharacterIndex
  selectedCol: CharacterIndex
  onSelect: (row: CharacterIndex, col: CharacterIndex) => void
  /** Thumbnail size in the grid. Default 48. */
  cellSize?: number
  /** Large preview in addition to the grid. */
  showPreview?: boolean
}
