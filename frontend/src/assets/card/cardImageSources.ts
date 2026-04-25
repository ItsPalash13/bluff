const modules = import.meta.glob('./png/*/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

/** card folder (e.g. 2x) -> (club_1 -> url) */
const urlByTheme = new Map<string, Map<string, string>>()

for (const [path, url] of Object.entries(modules)) {
  const m = path.match(/[/\\]png[/\\]([^/\\]+)[/\\]([^/\\]+)\.png$/i)
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

export const CARD_THEMES = SORTED_THEMES as readonly string[]

export function getDefaultCardThemeId(): string {
  if (SORTED_THEMES.includes('2x')) return '2x'
  return SORTED_THEMES[0] ?? '2x'
}

export function getCardImageUrl(
  themeId: string,
  key: string,
): string | undefined {
  return urlByTheme.get(themeId)?.get(key)
}
