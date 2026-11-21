import { normalizeEmbeddedService } from './embeddedRequestContext.js'
import { injectEmbeddedBrowserAdapter } from './embeddedBrowserAdapter.js'
import { randomBytes } from 'node:crypto'

export const INFINIDYSK_V2_COOKIE_PREFIX = 'dumb_ifd_v2_'
const nativeCookies = new Map([
  ['infinidysk_session', 'session'],
  ['infinidysk_sso', 'sso'],
])

export const nativeInfiniDyskUi = (inventory, service) => {
  const normalized = normalizeEmbeddedService(service)
  if (!normalized) return null
  const rows = Array.isArray(inventory?.services) ? inventory.services : []
  const row = rows.find(row => normalizeEmbeddedService(row?.name) === normalized
    && ['infinidysk', 'nzbdav'].includes(row?.config_key))
  // Only a positively identified legacy row may use the old adapter. Missing
  // or malformed runtime metadata must not downgrade a native route into it.
  if (row && (row.runtime_generation === undefined || row.runtime_generation === '1')) return null
  return { service: normalized, supported: row?.runtime_generation === '2' && row.embedded_ui_protocol === 1 }
}

const cookiePairs = value => String(value || '').split(';').map(part => part.trim()).filter(Boolean)
const cookieName = pair => pair.slice(0, pair.indexOf('=') < 0 ? pair.length : pair.indexOf('='))
const browserCookieName = (service, suffix) => `${INFINIDYSK_V2_COOKIE_PREFIX}${service}_${suffix}`

// Keep native sessions separate from direct-port sessions and the dashboard's
// credentials. Root scope also covers native fetch(Request) calls, whose URL
// must remain unchanged to preserve streaming upload/body semantics.
export const prepareInfiniDyskV2Request = (req, service = null) => {
  if (!req?.headers) return
  const normalized = service && normalizeEmbeddedService(service)
  const incoming = cookiePairs(req.headers.cookie ?? req.headers.Cookie)
  let outgoing
  if (normalized) {
    outgoing = []
    for (const [nativeName, suffix] of nativeCookies) {
      const name = browserCookieName(normalized, suffix)
      const cookie = incoming.find(pair => cookieName(pair) === name)
      if (cookie) outgoing.push(nativeName + cookie.slice(name.length))
    }
    for (const key of Object.keys(req.headers)) {
      if (['authorization', 'proxy-authorization', 'x-api-key', 'x-sab-api-key', 'x-access-token', 'x-dumb-ui-service'].includes(key.toLowerCase())) {
        delete req.headers[key]
      }
    }
  } else {
    outgoing = incoming.filter(pair => !cookieName(pair).startsWith(INFINIDYSK_V2_COOKIE_PREFIX)
      && !nativeCookies.has(cookieName(pair)))
  }
  delete req.headers.cookie
  delete req.headers.Cookie
  if (outgoing.length) req.headers.cookie = outgoing.join('; ')
}

export const infiniDyskV2ResponseCookies = (values, service) => {
  const normalized = normalizeEmbeddedService(service)
  if (!normalized) return []
  return (Array.isArray(values) ? values : values ? [values] : []).flatMap(value => {
    const parts = cookiePairs(value)
    const first = parts.shift() || ''
    const name = cookieName(first)
    const suffix = nativeCookies.get(name)
    if (!suffix) return []
    const attributes = parts.filter(part => !/^(?:path|domain|httponly)(?:=|$)/i.test(part))
    return [`${browserCookieName(normalized, suffix)}${first.slice(name.length)}; Path=/; HttpOnly${attributes.length ? '; ' + attributes.join('; ') : ''}`]
  })
}

export const isInfiniDyskV2ExternalLoginRedirect = (location, pathname) => {
  if (pathname !== '/auth/oidc/login' || !/^https?:\/\//i.test(String(location || ''))) return false
  try { return ['http:', 'https:'].includes(new URL(location).protocol) } catch { return false }
}

export const infiniDyskV2DocumentPolicy = (headers) => {
  const nonce = randomBytes(24).toString('base64url')
  const adjust = value => {
    const directives = new Map(String(value || "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; form-action 'self'")
      .split(';').map(part => part.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...values]) => [name.toLowerCase(), values]))
    directives.set('frame-ancestors', ["'self'"])
    directives.set('base-uri', ["'self'"])
    for (const name of ['script-src', ...(directives.has('script-src-elem') ? ['script-src-elem'] : [])]) {
      const values = directives.get(name) || directives.get('script-src') || directives.get('default-src') || ["'self'"]
      directives.set(name, [...values.filter(value => value !== "'none'"), `'nonce-${nonce}'`])
    }
    return [...directives].map(([name, values]) => `${name} ${values.join(' ')}`).join('; ')
  }
  const result = { ...headers, 'x-frame-options': 'SAMEORIGIN' }
  const original = headers['content-security-policy']
  result['content-security-policy'] = Array.isArray(original) ? original.map(adjust) : adjust(original)
  if (headers['content-security-policy-report-only']) {
    const policy = headers['content-security-policy-report-only']
    result['content-security-policy-report-only'] = Array.isArray(policy) ? policy.map(adjust) : adjust(policy)
  }
  return { headers: result, nonce }
}

// Serialized before the native app boots. Keep this self-contained: it runs
// inside the iframe, and the native router must retain its original root paths.
export function installInfiniDyskV2Document(service) {
  document.addEventListener('load', event => {
    const script = event.target
    if (script?.tagName !== 'SCRIPT' || !script.hasAttribute('data-dumb-native-src')) return
    script.setAttribute('src', script.getAttribute('data-dumb-native-src'))
    script.removeAttribute('data-dumb-native-src')
  }, true)
  const prefix = `/ui/${service}`
  const path = location.pathname
  const normalized = path.toLowerCase()
  if (normalized === prefix || normalized.startsWith(prefix + '/')) {
    history.replaceState(history.state, '', (path.slice(prefix.length) || '/') + location.search + location.hash)
  }
}

export const injectInfiniDyskV2Document = (html, service, nonce) => {
  const normalized = normalizeEmbeddedService(service)
  if (!normalized) return html
  const prefix = `/ui/${normalized}`
  // The native router keeps its original root routes. Its requests are adapted
  // inside this document; no native settings or saved playback URLs change.
  if (typeof nonce !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return html
  const bootstrap = `<base href="${prefix}/"><script nonce="${nonce}">(${installInfiniDyskV2Document.toString()})(${JSON.stringify(normalized)});</script>`
  html = String(html).replace(/<base\b[^>]*>/gi, '')
  // A redirected entry module and an explicitly prefixed lazy import have
  // different module identities. Canonicalize HTML module/preload URLs before
  // the browser fetches them, so React is instantiated only once. After the
  // entry finishes, restore its original DOM attribute for native build checks;
  // an already-started script does not execute again when its src changes.
  html = html.replace(/<script\b[^>]*>/gi, tag => tag.replace(/\ssrc\s*=\s*(["'])(\/assets\/[^"']+)\1/i,
    (_attribute, quote, source) => ` data-dumb-native-src=${quote}${source}${quote} src=${quote}${prefix}${source}${quote}`))
    .replace(/<link\b[^>]*>/gi, tag => tag.replace(/\shref\s*=\s*(["'])(\/assets\/[^"']+)\1/i,
      (_attribute, quote, source) => ` href=${quote}${prefix}${source}${quote}`))
  const head = html.match(/<head\b[^>]*>/i)
  const offset = head ? head.index + head[0].length : 0
  html = html.slice(0, offset) + bootstrap + html.slice(offset)
  return injectEmbeddedBrowserAdapter(html, normalized, { nonce })
}
