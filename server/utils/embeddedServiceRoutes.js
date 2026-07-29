export const MEDIASTORM_SERVICES = new Set(['mediastorm'])
export const NZBDAV_SERVICES = new Set(['nzbdav'])

const DUMB_WEBSOCKET_PATHS = new Set([
  '/ws/logs',
  '/ws/metrics',
  '/ws/status',
])

const MEDIASTORM_NAVIGATION_ENTRY_PATHS = new Set([
  '/admin',
  '/account',
  '/watch',
  '/register',
])

const MEDIASTORM_NAVIGATION_PATH_PREFIXES = [
  '/admin/',
  '/account/',
  '/watch/',
  '/share/',
  '/register/',
]

export const isMediaStormNavigationPath = (pathname) => {
  if (!pathname) return false
  return MEDIASTORM_NAVIGATION_ENTRY_PATHS.has(pathname) ||
    MEDIASTORM_NAVIGATION_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

const websocketPathname = (requestUrl) => {
  if (!requestUrl) return ''
  try {
    return new URL(requestUrl, 'http://local').pathname
  } catch {
    return String(requestUrl).split('?')[0]
  }
}

export const isDumbWebSocketPath = (requestUrl) => {
  return DUMB_WEBSOCKET_PATHS.has(websocketPathname(requestUrl))
}

export const isNzbDavWebSocketPath = (requestUrl) => {
  const pathname = websocketPathname(requestUrl)
  // Current NzbDAV uses /ws. Keep / for older installed builds.
  return pathname === '/ws' || pathname === '/'
}

export const shouldPreferDumbApiRoute = ({
  isKnownDumbApiPath,
  hasExplicitEmbeddedContext,
  isTpaCookieApi,
}) => {
  return Boolean(
    isKnownDumbApiPath &&
    !hasExplicitEmbeddedContext &&
    !isTpaCookieApi
  )
}
