import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from 'vue/compiler-sfc'

const root = fileURLToPath(new URL('../../', import.meta.url))
const fixtureBackend = `
const input = globalThis.__onboardingFixtureInput
export default () => ({
  configService: {
    async getConfig() { return structuredClone(input.config || {}) },
  },
  processService: {
    async getCoreServices() {
      globalThis.__onboardingFixtureRequests.push({ kind: 'core' })
      return { core_services: input.coreCatalog || [] }
    },
    async getOptionalServices(core, preferred = []) {
      globalThis.__onboardingFixtureRequests.push({ kind: 'optional', core, preferred: [...preferred] })
      const list = input.optionalByCore?.[core] ?? input.optionalCatalog ?? []
      return { optional_services: list }
    },
  },
})
`
const fixtureEntry = `
import { createApp, h } from 'vue'
import { createPinia } from 'pinia'
import { useOnboardingStore } from './stores/onboarding.js'
import CoreServices from './components/onboarding/Step1CoreService.vue'
import OptionalServices from './components/onboarding/Step3Optional.vue'

const input = window.__onboardingFixtureInput
const metadataBefore = JSON.stringify({
  cores: input.coreCatalog,
  optionals: input.optionalCatalog,
  byCore: input.optionalByCore,
})
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return
  Object.values(value).forEach(freeze)
  Object.freeze(value)
}
freeze(input.coreCatalog)
freeze(input.optionalCatalog)
freeze(input.optionalByCore)
window.__onboardingFixtureRequests = []
const pinia = createPinia()
const store = useOnboardingStore(pinia)
store.$patch({
  coreServices: structuredClone(input.coreServices || []),
  optionalServices: structuredClone(input.optionalServices || []),
  _Config: structuredClone(input.config || {}),
  _capabilities: structuredClone(input.capabilities || {}),
  _userServiceOptions: structuredClone(input.userServiceOptions || {}),
  _coreMeta: input.coreCatalog || [],
  _optionalMeta: input.optionalCatalog || [],
})
const app = createApp({
  render: () => h(input.step === 'core' ? CoreServices : OptionalServices),
})
app.use(pinia)
app.mount('#app')
window.onboardingFixture = {
  snapshot: () => ({
    coreServices: JSON.parse(JSON.stringify(store.coreServices)),
    optionalServices: JSON.parse(JSON.stringify(store.optionalServices)),
    instanceNameBlocked: Boolean(store._instanceNameBlocked),
    reviewPayload: JSON.parse(JSON.stringify(store.reviewPayload)),
    userServiceOptions: JSON.parse(JSON.stringify(store._userServiceOptions)),
    guidedApplied: store.guidedApplied,
    guidedWorkflowIntent: JSON.parse(JSON.stringify(store.guidedWorkflowIntent)),
    requests: JSON.parse(JSON.stringify(window.__onboardingFixtureRequests)),
    metadataUnchanged: metadataBefore === JSON.stringify({
      cores: input.coreCatalog,
      optionals: input.optionalCatalog,
      byCore: input.optionalByCore,
    }),
  }),
}
window.addEventListener('pagehide', () => app.unmount(), { once: true })
`

// The actual Vue components, helpers and Pinia onboarding store are bundled.
// Only backend transport and the unrelated process-project lookup are fixtures.
// This is component interaction evidence, not a packaged Nuxt routing test.
export async function createOnboardingBrowserFixture() {
  const bundled = await build({
    stdin: { contents: fixtureEntry, resolveDir: root, sourcefile: 'onboarding-browser-fixture.js' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{
      name: 'actual-onboarding-components',
      setup(plugin) {
        plugin.onResolve({ filter: /^~\// }, args => {
          if (args.path === '~/services/useService.js') return { path: 'backend', namespace: 'onboarding-fixture' }
          if (args.path === '~/stores/processes.js') return { path: 'processes', namespace: 'onboarding-fixture' }
          return { path: path.resolve(root, args.path.slice(2)) }
        })
        plugin.onLoad({ filter: /.*/, namespace: 'onboarding-fixture' }, args => ({
          contents: args.path === 'backend' ? fixtureBackend
            : "export const useProcessesStore = () => ({ projectName: globalThis.__onboardingFixtureInput.projectName || 'DUMB' })",
          loader: 'js',
        }))
        plugin.onLoad({ filter: /\.vue$/ }, async args => {
          const { descriptor, errors } = parse(await fs.readFile(args.path, 'utf8'), { filename: args.path })
          if (errors.length) throw errors[0]
          return {
            contents: compileScript(descriptor, {
              id: 'onboarding-browser-fixture',
              inlineTemplate: true,
            }).content,
            loader: 'js',
            resolveDir: path.dirname(args.path),
          }
        })
      },
    }],
  })
  const bundle = bundled.outputFiles[0].contents
  let stylesheet = ''
  if (process.env.DUMB_ONBOARDING_SCREENSHOTS === '1') {
    const assets = path.join(root, '.output/public/_nuxt')
    const filename = (await fs.readdir(assets)).find(name => /^entry\..*\.css$/.test(name))
    if (!filename) throw new Error('Build the frontend before capturing styled review screenshots')
    stylesheet = await fs.readFile(path.join(assets, filename), 'utf8')
  }
  const server = http.createServer((request, response) => {
    if (request.url === '/fixture.css') {
      response.setHeader('content-type', 'text/css')
      response.end(stylesheet)
    } else if (request.url === '/fixture.js') {
      response.setHeader('content-type', 'text/javascript')
      response.end(bundle)
    } else {
      response.setHeader('content-type', 'text/html')
      response.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><main id="app"></main><script src="/fixture.js"></script></body></html>')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      await new Promise(resolve => {
        server.close(resolve)
        server.closeAllConnections()
      })
    },
  }
}
