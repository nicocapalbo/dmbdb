import { normalizeEmbeddedService } from './embeddedRequestContext.js'

// A legacy root registration has no stable service owner. Replace only this
// exact script with a worker that unregisters its own registration. It never
// intercepts traffic, claims clients, removes caches, or reloads open pages.
export const RETIRED_ROOT_SERVICE_WORKER = `self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister())
})
`

export const isServiceWorkerScriptRequest = (request) =>
  request?.headers?.['service-worker'] === 'script' ||
  request?.headers?.['sec-fetch-dest'] === 'serviceworker'

export const serviceWorkerRequestContext = (request) => {
  try {
    const path = request?.url || ''
    if (!path.startsWith('/') || path.startsWith('//')) return null
    const url = new URL(path, 'http://embedded.invalid')
    if (path.split('?', 1)[0] !== url.pathname) return null
    const match = url.pathname.match(/^(\/(?:service\/ui|ui)\/([^/]+)\/).+/)
    if (!match || normalizeEmbeddedService(match[2]) !== match[2]) return null
    return { service: match[2], prefix: match[1], path: url.pathname }
  } catch {
    return null
  }
}

// Keep an upstream's narrower path restriction where possible. A root-based
// application publishes / or /web/, which must refer to its embedded prefix,
// rather than the dashboard origin. Invalid or foreign scopes fail closed.
export const embeddedServiceWorkerAllowedScope = (value, context) => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !value.trim() || /[\\?#]/.test(value) ||
      /%(?:2f|5c)/i.test(value)) {
    throw new Error('Invalid embedded service worker scope')
  }
  const raw = value.trim()
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw)) {
    throw new Error('Foreign embedded service worker scope')
  }
  const base = 'http://embedded.invalid'
  const prefixed = /^\/(?:service\/ui|ui)\//.test(raw)
  const scoped = raw.startsWith('/') && !prefixed
    ? context.prefix + raw.slice(1)
    : raw
  const resolved = new URL(scoped, base + context.path)
  if (resolved.origin !== base || !resolved.pathname.startsWith(context.prefix)) {
    throw new Error('Embedded service worker scope escapes its service')
  }
  return resolved.pathname
}

export const embeddedServiceWorkerResponseHeaders = (headers, request, context = serviceWorkerRequestContext(request)) => {
  const result = { ...headers }
  const scopeKeys = Object.keys(result).filter((key) => key.toLowerCase() === 'service-worker-allowed')
  if (scopeKeys.length > 1) throw new Error('Duplicate embedded service worker scope')
  if (scopeKeys.length) {
    const key = scopeKeys[0]
    if (context) result[key] = embeddedServiceWorkerAllowedScope(result[key], context)
    else delete result[key]
  }
  // Ordinary fetches can populate the HTTP cache before worker registration.
  // Their entries must never authorize a broader scope or replay unadapted
  // script bytes when the browser later asks for the worker variant.
  const varyKeys = Object.keys(result).filter((key) => key.toLowerCase() === 'vary')
  const vary = varyKeys.flatMap((key) => String(result[key]).split(',')).map((value) => value.trim()).filter(Boolean)
  for (const key of varyKeys) delete result[key]
  if (vary.includes('*')) result.vary = '*'
  else {
    for (const field of ['Service-Worker', 'Sec-Fetch-Dest']) {
      if (!vary.some((value) => value.toLowerCase() === field.toLowerCase())) vary.push(field)
    }
    result.vary = vary.join(', ')
  }
  return result
}
