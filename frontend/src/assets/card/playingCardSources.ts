const modules = import.meta.glob('./png/2x/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>

const filenameToUrl = new Map<string, string>()
for (const [path, url] of Object.entries(modules)) {
  const m = path.match(/([^/\\]+)\.png$/)
  if (m) filenameToUrl.set(m[1], url)
}

export function getPlayingCardImageUrl(
  key: string,
): string | undefined {
  return filenameToUrl.get(key)
}
