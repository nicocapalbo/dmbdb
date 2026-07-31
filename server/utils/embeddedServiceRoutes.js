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

export const shouldRouteEmbeddedServiceApi = ({
  hasExplicitEmbeddedContext,
  isNavigation,
  serviceType,
  isTpaApiPath,
}) => {
  if (!hasExplicitEmbeddedContext) return false

  // TPA's admin SSO entrypoint is a document navigation because it redirects
  // the iframe to the identity provider. It must reach TPA before that redirect.
  if (serviceType === 'traefik_proxy_admin' && isTpaApiPath) return true

  return !isNavigation
}

export const shouldPreserveExternalServiceRedirect = ({
  location,
  serviceName,
  serviceType,
  requestPathname,
}) => {
  const normalizedName = String(serviceName || '').trim().toLowerCase()
  const normalizedType = String(serviceType || '').trim().toLowerCase()
  if (normalizedName !== 'traefik_proxy_admin' && normalizedType !== 'traefik_proxy_admin') return false
  if (!/^https?:\/\//i.test(String(location || ''))) return false

  try {
    if (new URL(location).pathname === '/api/oidc/authorization') return true
  } catch {
    return false
  }

  return requestPathname === '/api/auth/admin/login' ||
    requestPathname === '/api/auth/sso/login'
}
