import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { installEmbeddedBrowserAdapter } from '../server/utils/embeddedBrowserAdapter.js'

test('locked worker ready and synchronous lookup failures preserve registration, HTTP and form ownership', async () => {
  const calls = []
  const legacyReady = Promise.resolve({ scope: 'https://example.test/' })
  const container = {
    getRegistration() { throw new DOMException('Worker storage is unavailable', 'SecurityError') },
    register(script, options) { calls.push({ kind: 'register', script, options: { ...options } }); return Promise.resolve(undefined) },
  }
  Object.defineProperty(container, 'ready', { value: legacyReady, configurable: false })
  class Form {
    getAttribute(name) { return name === 'action' ? '/submit?token=example%2Fvalue' : null }
    submit() { calls.push({ kind: 'form', action: this.action }) }
  }
  class Xhr {
    open(method, url) { calls.push({ kind: 'xhr', method, url }) }
  }
  const win = {
    location: new URL('https://example.test/ui/seerr/'),
    history: { pushState() {}, replaceState() {} },
    navigator: { serviceWorker: container },
    fetch(url) { calls.push({ kind: 'fetch', url }); return Promise.resolve() },
    HTMLFormElement: Form, XMLHttpRequest: Xhr,
    addEventListener() {}, Request, Headers, Promise, DOMException,
  }
  const realm = vm.createContext({ window: win, document: { baseURI: win.location.href }, URL, URLSearchParams })
  vm.runInContext(`(${installEmbeddedBrowserAdapter.toString()})('seerr')`, realm)
  await container.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  await win.fetch('/api/example')
  new Xhr().open('POST', '/api/example')
  new Form().submit()
  assert.equal(container.ready, legacyReady)
  assert.deepEqual(calls, [
    { kind: 'register', script: 'https://example.test/ui/seerr/sw.js',
      options: { scope: 'https://example.test/ui/seerr/', updateViaCache: 'none' } },
    { kind: 'fetch', url: 'https://example.test/ui/seerr/api/example' },
    { kind: 'xhr', method: 'POST', url: 'https://example.test/ui/seerr/api/example' },
    { kind: 'form', action: 'https://example.test/ui/seerr/submit?token=example%2Fvalue' },
  ])
})
