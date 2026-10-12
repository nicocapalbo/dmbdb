import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { injectEmbeddedServiceWorkerAdapter } from '../server/utils/embeddedServiceWorkerAdapter.js'

const createWorker = (source = '', location = 'https://example.test/ui/seerr/sw.js') => {
  const fetches = []
  const imports = []
  const windows = []
  const worker = vm.createContext({
    location: new URL(location), URL, URLSearchParams, Request, Headers,
    fetch(input, init) { fetches.push({ input, init }); return Promise.resolve(new Response('ok')) },
    importScripts(...urls) { imports.push(urls) },
    clients: { openWindow(url) { windows.push(url); return Promise.resolve({ url }) } },
  })
  vm.runInContext(injectEmbeddedServiceWorkerAdapter(source, 'seerr'), worker)
  return { worker, fetches, imports, windows }
}

test('serialized worker adapter preserves root fetch and import ownership and encoded query bytes', async () => {
  const { worker, fetches, imports } = createWorker()
  await worker.fetch('/api/v1/request/123?token=a%20b%2fc&__dumb_ui=other&next=%2Fhome')
  assert.equal(fetches[0].input, 'https://example.test/ui/seerr/api/v1/request/123?token=a%20b%2fc&next=%2Fhome')
  worker.importScripts('/helper.js', './relative.js', 'https://cdn.example.invalid/shared.js')
  assert.deepEqual(imports[0], [
    'https://example.test/ui/seerr/helper.js',
    'https://example.test/ui/seerr/relative.js',
    'https://cdn.example.invalid/shared.js',
  ])
  await worker.fetch('data:text/plain,example')
  assert.equal(fetches[1].input, 'data:text/plain,example')
})

test('worker Request adaptation preserves its native body and authentication without leaking owner to foreign origins', async () => {
  const { worker, fetches } = createWorker()
  const request = new Request('https://example.test/api/v1/request', {
    method: 'POST', body: 'native-request-body', headers: { authorization: 'example-token' },
  })
  await worker.fetch(request)
  assert.equal(fetches[0].input, request)
  assert.equal(await request.text(), 'native-request-body')
  assert.equal(fetches[0].init.headers.get('authorization'), 'example-token')
  assert.equal(fetches[0].init.headers.get('x-dumb-ui-service'), 'seerr')
  const foreign = new Request('https://remote.example.invalid/api')
  await worker.fetch(foreign)
  assert.equal(fetches[1].input, foreign)
  assert.equal(fetches[1].init, undefined)
})

test('notification destinations carry document identity and preserve external destinations', async () => {
  const { worker, windows } = createWorker()
  await worker.clients.openWindow('/?token=a%2Fb')
  await worker.clients.openWindow('/movie/123?__dumb_ui=other&next=%2Fhome#details')
  await worker.clients.openWindow('https://remote.example.invalid/continue')
  assert.deepEqual(windows, [
    'https://example.test/ui/seerr/?token=a%2Fb&__dumb_ui=seerr',
    'https://example.test/ui/seerr/movie/123?next=%2Fhome&__dumb_ui=seerr#details',
    'https://remote.example.invalid/continue',
  ])
})

test('legacy explicit service namespace stays stable for worker requests and notification windows', async () => {
  const { worker, fetches, windows } = createWorker('', 'https://example.test/service/ui/seerr/sw.js')
  await worker.fetch('/api/status')
  await worker.clients.openWindow('/')
  assert.equal(fetches[0].input, 'https://example.test/service/ui/seerr/api/status')
  assert.equal(windows[0], 'https://example.test/service/ui/seerr/?__dumb_ui=seerr')
})

test('worker injection preserves directive prologues, sloppy scripts, and header comments', () => {
  for (const source of [
    "'use strict'; var strict = (function () { return this === undefined })();",
    '// header\n"other directive";\n/* comment */ "use strict"\nvar strict = (function () { return this === undefined })();',
    '\uFEFF"use strict"; var strict = (function () { return this === undefined })();',
    '#!/usr/bin/env node\n"use strict"; var strict = (function () { return this === undefined })();',
    "'use strict'\n++globalThis.counter; var strict = (function () { return this === undefined })();",
    "'use strict'\n--globalThis.counter; var strict = (function () { return this === undefined })();",
    "'use strict'\ninstanceof\u03c0: { var strict = (function () { return this === undefined })(); }",
  ]) {
    assert.equal(createWorker(source).worker.strict, true)
  }
  for (const source of [
    'var strict = (function () { return this === undefined })();',
    "'use strict' + ' is an expression'; var strict = (function () { return this === undefined })();",
    "'use strict'\nin globalThis; var strict = (function () { return this === undefined })();",
    "'use strict'\ninstanceof String; var strict = (function () { return this === undefined })();",
    '// header without a final newline',
  ]) {
    const { worker } = createWorker(source)
    if ('strict' in worker) assert.equal(worker.strict, false)
    assert.equal(worker.__dumbEmbeddedWorker, true)
  }
})

test('all JavaScript line terminators end comments and hashbangs before worker startup', () => {
  for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    for (const header of ['// header', '#!ignored']) {
      const { imports } = createWorker(`${header}${ending}importScripts('/startup.js')`)
      assert.deepEqual(imports[0], ['https://example.test/ui/seerr/startup.js'])
    }
  }
})

test('worker imports cannot install duplicate adapters or reinterpret invalid service names', async () => {
  const { worker, fetches } = createWorker()
  const fetch = worker.fetch
  vm.runInContext(injectEmbeddedServiceWorkerAdapter('', 'seerr'), worker)
  assert.equal(worker.fetch, fetch)
  await worker.fetch('/api/status')
  assert.equal(fetches[0].input, 'https://example.test/ui/seerr/api/status')
  const source = 'original source'
  assert.equal(injectEmbeddedServiceWorkerAdapter(source, '<script>'), source)
})
