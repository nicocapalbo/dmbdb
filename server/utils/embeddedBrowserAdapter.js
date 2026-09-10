import { normalizeEmbeddedService } from './embeddedRequestContext.js'

// Serialized into each embedded document, before the upstream application boots.
// Keep this function self-contained: it executes in the iframe, not in Nitro.
export function installEmbeddedBrowserAdapter(service) {
  const win = window
  if (win.__dumbEmbeddedRequests) return
  Object.defineProperty(win, '__dumbEmbeddedRequests', { value: true })
  const prefix = `/ui/${service}`
  const marker = '__dumb_ui'

  const requestUrl = (value, websocket = false) => {
    const url = new URL(String(value), document.baseURI || win.location.href)
    const local = websocket
      ? ['ws:', 'wss:', 'http:', 'https:'].includes(url.protocol) && url.host === win.location.host
      : ['http:', 'https:'].includes(url.protocol) && url.origin === win.location.origin
    if (!local) return String(value)
    if (websocket) url.protocol = url.protocol === 'https:' || url.protocol === 'wss:' ? 'wss:' : 'ws:'
    url.search = url.search.slice(1).split('&').filter((part) => !new URLSearchParams(part).has(marker)).join('&')
    if (!/^\/(?:service\/ui|ui)\//.test(url.pathname)) url.pathname = prefix + url.pathname
    return url.href
  }

  // Preserve the application pathname while making the document/referrer
  // unambiguous after pushState, replaceState, back/forward and reload.
  for (const method of ['pushState', 'replaceState']) {
    const original = win.history[method]
    win.history[method] = function (state, unused, value) {
      const url = new URL(value == null ? win.location.href : String(value), win.location.href)
      if (url.origin === win.location.origin) {
        const query = url.search.slice(1).split('&').filter((part) => part && !new URLSearchParams(part).has(marker)).join('&')
        url.search = `${query ? query + '&' : ''}${marker}=${encodeURIComponent(service)}`
      }
      return original.call(this, state, unused, url.href)
    }
  }
  win.history.replaceState(win.history.state, '', win.location.href)

  const originalFetch = win.fetch
  if (originalFetch) {
    win.fetch = function (input, init) {
      if (input instanceof win.Request) {
        // Reconstructing a Request at a different URL turns its body into a
        // streaming upload in Chromium (HTTP/2-only) and can lose it in Firefox.
        // Override only headers, keeping native body/abort/credentials semantics.
        if (new URL(input.url).origin !== win.location.origin) return originalFetch.call(this, input, init)
        const headers = new win.Headers(init?.headers ?? input.headers)
        headers.set('X-Dumb-Ui-Service', service)
        return originalFetch.call(this, input, { ...init, headers })
      }
      return originalFetch.call(this, requestUrl(input), init)
    }
  }
  const xhr = win.XMLHttpRequest?.prototype
  if (xhr) {
    const open = xhr.open
    xhr.open = function (method, url, ...rest) {
      return open.call(this, method, requestUrl(url), ...rest)
    }
  }
  for (const name of ['WebSocket', 'EventSource']) {
    const Original = win[name]
    if (!Original) continue
    win[name] = new Proxy(Original, {
      construct(target, args, newTarget) {
        return Reflect.construct(target, [requestUrl(args[0], name === 'WebSocket'), ...args.slice(1)], newTarget)
      },
    })
  }
  if (win.navigator.sendBeacon) {
    const sendBeacon = win.navigator.sendBeacon
    win.navigator.sendBeacon = function (url, data) {
      return sendBeacon.call(this, requestUrl(url), data)
    }
  }

  // Native form submission does not use fetch/XHR. Rewrite at submission time
  // so client routers can continue inspecting their original link/form paths.
  const prepareForm = (form, submitter) => {
    if (submitter?.hasAttribute('formaction')) {
      submitter.setAttribute('formaction', requestUrl(submitter.getAttribute('formaction')))
    } else {
      form.action = requestUrl(form.getAttribute('action') || win.location.href)
    }
  }
  // Framework routers read the original action in their submit handlers. Wait
  // until the event has bubbled through them, and only adapt native submissions.
  win.addEventListener('submit', (event) => {
    if (!event.defaultPrevented) prepareForm(event.target, event.submitter)
  })
  const form = win.HTMLFormElement?.prototype
  if (form) {
    const submit = form.submit
    form.submit = function () {
      prepareForm(this)
      return submit.call(this)
    }
  }
}

export const embeddedBrowserAdapterScript = (service) => {
  const normalized = normalizeEmbeddedService(service)
  if (!normalized) return ''
  return `<script>(${installEmbeddedBrowserAdapter.toString()})(${JSON.stringify(normalized)});</script>`
}

export const injectEmbeddedBrowserAdapter = (html, service) => {
  const script = embeddedBrowserAdapterScript(service)
  if (!script) return html
  // A meta policy overrides the response header. Root-based apps such as
  // Tautulli otherwise suppress the context needed by native assets/links.
  // Keep cross-origin referrers suppressed while allowing same-origin routing.
  html = html.replace(/<meta\b[^>]*\bname\s*=\s*(?:"referrer"|'referrer'|referrer(?=\s|\/?>))[^>]*>/gi,
    '<meta name="referrer" content="same-origin">')
  const head = html.match(/<head\b[^>]*>/i)
  if (head) {
    const offset = head.index + head[0].length
    return html.slice(0, offset) + script + html.slice(offset)
  }
  const root = html.match(/<html\b[^>]*>/i)
  if (root) {
    const offset = root.index + root[0].length
    return html.slice(0, offset) + `<head>${script}</head>` + html.slice(offset)
  }
  return script + html
}
