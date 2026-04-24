import type { CharacterIndex } from './characterAvatarTypes'
import { getCharacterKey } from './characterAvatarTypes'

const modules = import.meta.glob('./imgs/*/*.jpg', {
  eager: true,
  import: 'default',
}) as Record<string, string>

/** theme folder name (e.g. jpgs) → (img_0_0 → url) */
const urlByTheme = new Map<string, Map<string, string>>()

for (const [path, url] of Object.entries(modules)) {
  const m = path.match(/[/\\]imgs[/\\]([^/\\]+)[/\\]([^/\\]+)\.jpg$/i)
  if (!m) continue
  const themeId = m[1]
  const fileKey = m[2]
  let byFile = urlByTheme.get(themeId)
  if (!byFile) {
    byFile = new Map()
    urlByTheme.set(themeId, byFile)
  }
  byFile.set(fileKey, url)
}

const SORTED_THEMES = Array.from(urlByTheme.keys()).sort((a, b) =>
  a.localeCompare(b),
)

/**
 * Subfolders under `imgs/` that contain jpg character packs, sorted.
 */
export const CHARACTER_THEMES = SORTED_THEMES as readonly string[]

export function getDefaultCharacterThemeId(): string {
  if (SORTED_THEMES.includes('jpgs')) return 'jpgs'
  return SORTED_THEMES[0] ?? 'jpgs'
}

export function getCharacterImageUrl(
  themeId: string,
  key: string,
): string | undefined {
  return urlByTheme.get(themeId)?.get(key)
}

function parseGridKey(key: string): { row: number; col: number } | null {
  const m = key.match(/^img_(\d+)_(\d+)$/)
  if (!m) return null
  return { row: Number(m[1]), col: Number(m[2]) }
}

export function getCharacterKeys(themeId: string): string[] {
  const keys = Array.from(urlByTheme.get(themeId)?.keys() ?? [])
  return keys.sort((a, b) => {
    const pa = parseGridKey(a)
    const pb = parseGridKey(b)
    if (pa && pb) {
      if (pa.row !== pb.row) return pa.row - pb.row
      if (pa.col !== pb.col) return pa.col - pb.col
      return 0
    }
    return a.localeCompare(b)
  })
}

export function getCharacterCount(themeId: string): number {
  return getCharacterKeys(themeId).length
}

export function getCharacterImageUrlByIndex(
  themeId: string,
  index: number,
): string | undefined {
  const keys = getCharacterKeys(themeId)
  if (keys.length === 0) return undefined
  const safeIndex = Math.max(0, Math.min(keys.length - 1, index))
  return getCharacterImageUrl(themeId, keys[safeIndex])
}

export function getCharacterImageUrlForCell(
  themeId: string,
  row: CharacterIndex,
  col: CharacterIndex,
): string | undefined {
  return getCharacterImageUrl(themeId, getCharacterKey(row, col))
}
