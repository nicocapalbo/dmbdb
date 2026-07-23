const COOKIE_ISOLATED_UI_SERVICES = new Set(['plex', 'plex_media_server'])

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
    return normalized ? COOKIE_ISOLATED_UI_SERVICES.has(normalized) : false
  })

export const stripUiProxyCookies = (req, ...serviceCandidates) => {
  if (!shouldStripUiProxyCookies(...serviceCandidates) || !req?.headers) {
    return false
  }

  delete req.headers.cookie
  delete req.headers.Cookie
  return true
}
