/**
 * Single base URL for HTTP and Socket.IO (same backend).
 * Set `VITE_API_URL` in `.env` (e.g. `http://localhost:8080` or your deployed API).
 */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '') || url
}

export function getApiBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_API_URL as string | undefined
  if (fromEnv?.trim()) {
    return trimTrailingSlash(fromEnv.trim())
  }
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
    return `${protocol}//${window.location.hostname}:8080`
  }
  return 'http://localhost:8080'
}

/** REST paths, e.g. `apiUrl('/health')` → `https://api.example.com/health` */
export function apiUrl(path: string): string {
  const base = getApiBaseUrl()
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}
