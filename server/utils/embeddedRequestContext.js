// Unlike cookies, a document URL belongs to one iframe. Keep this marker when
// an upstream SPA removes its proxy prefix from history, including on reload.
export const EMBEDDED_CONTEXT_PARAM = '__dumb_ui'

export const normalizeEmbeddedService = (value) => {
  if (typeof value !== 'string') return null
  try {
    const service = decodeURIComponent(value).toLowerCase().replace(/\s+/g, '_').replace(/\//g, '_')
    return /^(?!\.{1,2}$)[a-z0-9_.-]{1,128}$/.test(service) ? service : null
  } catch {
    return null
  }
}

export const serviceFromEmbeddedUrl = (value) => {
  try {
    const url = new URL(value, 'http://embedded.invalid')
    const match = url.pathname.match(/^\/(?:service\/ui|ui)\/([^/]+)(?:\/|$)/)
    return normalizeEmbeddedService(match ? match[1] : url.searchParams.get(EMBEDDED_CONTEXT_PARAM))
  } catch {
    return null
  }
}

export const embeddedRequestContext = (req) => {
  const ownService = serviceFromEmbeddedUrl(req?.url || '')
  if (ownService) return ownService
  const headerService = normalizeEmbeddedService(req?.headers?.['x-dumb-ui-service'])
  if (headerService) return headerService
  try {
    const referer = new URL(req?.headers?.referer || req?.headers?.referrer)
    // A third-party Referer must never provide routing context.
    const hosts = [req?.headers?.host, req?.headers?.['x-forwarded-host']]
      .filter((host) => typeof host === 'string')
      .map((host) => host.split(',')[0].trim())
    if (!hosts.includes(referer.host)) return null
    return serviceFromEmbeddedUrl(referer.href)
  } catch {
    return null
  }
}

export const contextualizeEmbeddedRequest = (req) => {
  const service = embeddedRequestContext(req)
  if (!service) return null
  const url = new URL(req.url, 'http://embedded.invalid')
  const documentContext = normalizeEmbeddedService(url.searchParams.get(EMBEDDED_CONTEXT_PARAM)) === service
  url.search = url.search.slice(1).split('&').filter((part) => !new URLSearchParams(part).has(EMBEDDED_CONTEXT_PARAM)).join('&')
  const prefixed = /^\/(?:service\/ui|ui)\//.test(url.pathname)
  const path = `${prefixed ? '' : `/ui/${service}`}${url.pathname}${url.search}`
  return { service, path, prefixed, documentContext }
}
