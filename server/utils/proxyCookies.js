const COOKIE_ISOLATED_UI_SERVICES = new Set(['plex', 'plex_media_server'])
const COOKIE_ALLOWLISTED_UI_SERVICES = new Map([
  ['aiostreams', new Set(['aiostreams.session', 'aiostreams.oidc'])],
])

const normalizeServiceName = (value) => {
  if (!value) return null
  let decoded = String(value)
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // Keep the original value when a malformed escape reaches the proxy.
  }
  return decoded.toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_')
}

export const shouldStripUiProxyCookies = (...serviceCandidates) =>
  serviceCandidates.some((candidate) => {
    const normalized = normalizeServiceName(candidate)
    return normalized
      ? COOKIE_ISOLATED_UI_SERVICES.has(normalized) || COOKIE_ALLOWLISTED_UI_SERVICES.has(normalized)
      : false
  })

const cookiePolicy = (...serviceCandidates) => {
  for (const candidate of serviceCandidates) {
    const normalized = normalizeServiceName(candidate)
    if (!normalized) continue
    if (COOKIE_ISOLATED_UI_SERVICES.has(normalized)) return new Set()
    if (COOKIE_ALLOWLISTED_UI_SERVICES.has(normalized)) {
      return COOKIE_ALLOWLISTED_UI_SERVICES.get(normalized)
    }
  }
  return null
}

const filterCookieHeader = (header, allowedNames) => String(header || '')
  .split(';')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .filter((entry) => allowedNames.has(entry.split('=', 1)[0]?.trim()))
  .join('; ')

export const stripUiProxyCookies = (req, ...serviceCandidates) => {
  const policy = cookiePolicy(...serviceCandidates)
  if (policy === null || !req?.headers) {
    return false
  }

  const original = req.headers.cookie ?? req.headers.Cookie ?? ''
  delete req.headers.cookie
  delete req.headers.Cookie
  const filtered = filterCookieHeader(original, policy)
  if (filtered) req.headers.cookie = filtered
  return true
}
