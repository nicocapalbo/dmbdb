import { normalizeEmbeddedService } from './embeddedRequestContext.js'

// Serialized into the worker realm; no document/window or server imports exist
// there. Scope limits controlled clients, while these hooks preserve the owner
// of root requests and notification destinations made by the worker itself.
export function installEmbeddedServiceWorkerAdapter(service) {
  const worker = globalThis
  if (worker.__dumbEmbeddedWorker) return
  Object.defineProperty(worker, '__dumbEmbeddedWorker', { value: true })
  const prefix = worker.location.pathname.startsWith(`/service/ui/${service}/`)
    ? `/service/ui/${service}` : `/ui/${service}`
  const marker = '__dumb_ui'
  const ownedUrl = (value) => {
    const url = new URL(String(value), worker.location.href)
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== worker.location.origin) return String(value)
    url.search = url.search.slice(1).split('&').filter((part) => !new URLSearchParams(part).has(marker)).join('&')
    if (!/^\/(?:service\/ui|ui)\//.test(url.pathname)) url.pathname = prefix + url.pathname
    return url.href
  }
  const originalFetch = worker.fetch
  worker.fetch = function (input, init) {
    if (input instanceof worker.Request) {
      const url = new URL(input.url)
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== worker.location.origin) return originalFetch.call(this, input, init)
      const headers = new worker.Headers(init?.headers ?? input.headers)
      headers.set('X-Dumb-Ui-Service', service)
      return originalFetch.call(this, input, { ...init, headers })
    }
    return originalFetch.call(this, ownedUrl(input), init)
  }
  if (worker.importScripts) {
    const importScripts = worker.importScripts
    worker.importScripts = function (...urls) {
      return importScripts.apply(this, urls.map(ownedUrl))
    }
  }
  if (worker.clients?.openWindow) {
    const openWindow = worker.clients.openWindow
    worker.clients.openWindow = function (value) {
      const url = new URL(ownedUrl(value), worker.location.href)
      if (url.origin === worker.location.origin && url.pathname.startsWith(prefix + '/')) {
        // A notification may create a new top-level document without Referer.
        // Keep the service identity through document guards and subsequent SPA
        // history changes, just as an embedded document does.
        url.search += `${url.search ? '&' : '?'}${marker}=${encodeURIComponent(service)}`
      }
      return openWindow.call(this, url.href)
    }
  }
}

// Preserve classic workers' directive prologues when prepending executable
// code. Adding code before 'use strict' would silently disable strict mode.
const directiveEnd = (source) => {
  let offset = source.charCodeAt(0) === 0xfeff ? 1 : 0
  const skipLine = () => {
    const newline = source.slice(offset).search(/[\r\n\u2028\u2029]/)
    if (newline === -1) offset = source.length
    else {
      offset += newline
      offset += source[offset] === '\r' && source[offset + 1] === '\n' ? 2 : 1
    }
  }
  if (source.startsWith('#!', offset)) {
    skipLine()
  }
  const trivia = () => {
    const start = offset
    while (offset < source.length) {
      if (/\s/.test(source[offset])) { offset++; continue }
      if (source.startsWith('//', offset)) {
        skipLine()
        continue
      }
      if (source.startsWith('/*', offset)) {
        const end = source.indexOf('*/', offset + 2)
        if (end === -1) return false
        offset = end + 2
        continue
      }
      break
    }
    return /[\r\n\u2028\u2029]/.test(source.slice(start, offset))
  }
  trivia()
  let end = offset
  while (source[offset] === '"' || source[offset] === "'") {
    const quote = source[offset++]
    let closed = false
    while (offset < source.length) {
      if (source[offset] === '\\') { offset += 2; continue }
      if (source[offset++] === quote) { closed = true; break }
    }
    if (!closed) break
    const newline = trivia()
    if (source[offset] === ';') offset++
    else {
      const continuedExpression = /[([`.+\-*/%&|^?:<>=,]/.test(source[offset]) &&
        !source.startsWith('++', offset) && !source.startsWith('--', offset)
      const continuedKeyword = /^(?:in|instanceof)(?![$\\\p{ID_Continue}\u200c\u200d])/u.test(source.slice(offset))
      if (offset !== source.length && (!newline || continuedExpression || continuedKeyword)) break
    }
    trivia()
    end = offset
  }
  return end
}

export const injectEmbeddedServiceWorkerAdapter = (source, service) => {
  const normalized = normalizeEmbeddedService(service)
  if (!normalized) return source
  const offset = directiveEnd(source)
  const adapter = `\n;(${installEmbeddedServiceWorkerAdapter.toString()})(${JSON.stringify(normalized)});\n`
  return source.slice(0, offset) + adapter + source.slice(offset)
}
