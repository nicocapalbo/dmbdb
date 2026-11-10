import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from 'vue/compiler-sfc'
const root = fileURLToPath(new URL('../../', import.meta.url))
const backend = `
const input = globalThis.__setupWizardInput
const record = (method, payload) => globalThis.__setupWizardRequests.push({ method, payload })
const run = () => structuredClone(input.run)
export default () => ({
  configService: {
    async getConfig() { return {} },
    async getServiceUiStatus() { return { enabled: !input.requireServiceUi, services: [] } },
    async setOnboardingComplete() { record('complete'); return {} },
    async getOnboardingStatus() { return true },
  },
  processService: {
    async getCapabilities() { return input.capabilities },
    async getHealthCheck() { return { status: 'healthy' } },
    async getCoreServices() { return { core_services: input.coreCatalog } },
    async getOptionalServices() { return { optional_services: input.optionalCatalog || [] } },
    async planSetup(payload) {
      record('plan', payload)
      const plan = { ...structuredClone(input.plan), values: JSON.parse(JSON.stringify(payload.arrangement?.values || {})) }
      if (input.nativeRuntime) {
        const installed = input.nativeRuntime.runtime_generation === '2'
        const generation = installed ? '2' : plan.values['infinidysk::runtime_generation'] || '1'
        const mount = installed ? input.nativeRuntime.mount_backend : plan.values['infinidysk::mount_backend'] || 'rclone'
        plan.services = [{ id: 'infinidysk', service_key: 'infinidysk', runtime_topology: { runtime_generation: generation, mount_backend: mount, mount_path: '/mnt/debrid/example', dependencies: generation === '2' && mount === 'fuse' ? [] : ['rclone'] } }]
        plan.actions = generation === '2' && !installed ? [{ id: 'native-transition', label: 'Review guarded native installation', kind: 'native_transition', action: 'native_transition', service_key: 'infinidysk', automation: 'manual', required: true, execution: 'waiting_input', native_transition: { runtime_generation: '2', mode: input.nativeRuntime.mode || 'fresh', mount_backend: mount } }] : []
        plan.checks = plan.actions.length ? [{ key: 'native-transition', label: 'Native transition required', critical: true, ok: false }] : []
      }
      return plan
    },
    async startSetupRun(payload) { record('start', payload); return run() },
    async getSetupRun(id) { record('get', id); return run() },
    async getLatestSetupRun() { record('latest'); return run() },
    async applySetupAction(id, action, values) {
      record('action', { id, action, values })
      if (values.operation === 'preview' && input.actionPreviews?.[action]) {
        const target = input.run.actions.find(item => item.id === action)
        if (target) target.evidence = structuredClone(input.actionPreviews[action])
      }
      return run()
    },
    async recheckSetupRun(id) { record('recheck', id); return run() },
    async retrySetupRun(id) { record('retry', id); return run() },
    async startCoreServices(payload) {
      record('legacy-start', payload)
      if (input.rejectLegacy) throw { response: { status: 422, data: { detail: [{ input: 'private-input' }] } } }
      return { results: [] }
    },
  },
})
`
const entry = `
import { createApp, h, watch, computed, ref } from 'vue'
import { createPinia } from 'pinia'
import { useOnboardingStore } from './stores/onboarding.js'
import { useSetupArrangementsStore } from './stores/setupArrangements.js'
import Wizard from './pages/onboarding.vue'
import StatusPanel from './components/SetupStatusPanel.vue'
import Major from './components/InfiniDyskV2Panel.vue'
import { initialInfiniDyskV2State } from './helper/infinidyskV2Controller.js'
// Nuxt auto-imports these composables for existing child components.
globalThis.watch = watch
globalThis.computed = computed
const states = new Map()
globalThis.useState = (key, init) => { if (!states.has(key)) states.set(key, ref(init())); return states.get(key) }
const nativeState = globalThis.useState('infinidysk-v2-workflows-v1', initialInfiniDyskV2State)
globalThis.__setupWizardRequests = []
globalThis.navigateTo = async path => { globalThis.__setupNavigation = path }
const pinia = createPinia()
const store = useOnboardingStore(pinia)
const setup = useSetupArrangementsStore(pinia)
const input = globalThis.__setupWizardInput
store.$patch({
  coreServices: structuredClone(input.coreServices || []),
  optionalServices: structuredClone(input.optionalServices || []),
  _coreMeta: input.coreCatalog,
  _capabilities: input.capabilities,
  arrangementValues: structuredClone(input.arrangementValues || {}),
})
const app = createApp({ render: () => h('div', [
  location.hash.startsWith('#service:') ? h(StatusPanel, { processName: decodeURIComponent(location.hash.slice(9)) }) : h(location.hash === '#status' ? StatusPanel : Wizard),
  h(Major, { open: nativeState.value.majorOpen, onClose: () => { nativeState.value = { ...nativeState.value, majorOpen: false } } }),
]) })
app.use(pinia)
app.mount('#app')
globalThis.setupWizard = {
  snapshot: () => ({
    step: store.currentWizardStep, reviewStep: store.reviewStep, logsStep: store.logsStep,
    payload: store.reviewPayload, run: setup.run,
    requests: globalThis.__setupWizardRequests, storage: { ...localStorage },
    native: states.get('infinidysk-v2-workflows-v1')?.value,
  }),
  jump: id => { store.step = store.wizardSteps.findIndex(step => step.id === id) + 1 },
  setNativeJob: job => { nativeState.value = { ...nativeState.value, majorJob: job } },
}
addEventListener('pagehide', () => app.unmount(), { once: true })
`
export async function createSetupWizardFixture() {
  const result = await build({
    stdin: { contents: entry, resolveDir: root, sourcefile: 'setup-wizard-fixture.js' },
    bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent',
    define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'actual-setup-wizard', setup(plugin) {
      plugin.onResolve({ filter: /^[~@]\// }, args => {
        const file = args.path.slice(2)
        if (file === 'services/useService.js') return { path: 'backend', namespace: 'setup-fixture' }
        if (file === 'stores/processes.js') return { path: 'processes', namespace: 'setup-fixture' }
        if (file === 'composables/useWebSocket.js') return { path: 'socket', namespace: 'setup-fixture' }
        if (file === 'stores/ui.js') return { path: 'ui', namespace: 'setup-fixture' }
        return { path: path.resolve(root, file.endsWith('.js') || file.endsWith('.vue') ? file : file + '.js') }
      })
      plugin.onLoad({ filter: /.*/, namespace: 'setup-fixture' }, args => ({
        contents: args.path === 'backend' ? backend
          : args.path === 'processes' ? "export const useProcessesStore = () => ({ projectName: 'DUMB', getProcesses: async () => [] })"
          : args.path === 'socket' ? "export const useWebSocket = () => ({ on() {}, reset() {} })"
          : "export const useUiStore = () => ({ loadLogTimestampFormat() {}, logTimestampFormat: 'iso' })",
        loader: 'js',
      }))
      plugin.onLoad({ filter: /\.vue$/ }, async args => {
        const { descriptor, errors } = parse(await fs.readFile(args.path, 'utf8'), { filename: args.path })
        if (errors.length) throw errors[0]
        // esbuild IIFE dynamic-import namespaces omit the native ESM Module tag.
        // Normalize their default export as Nuxt's native module loader does.
        return { contents: compileScript(descriptor, { id: args.path, inlineTemplate: true }).content.replace(/import\((['"][^'"]+\.vue['"])\)/g, 'import($1).then(module => module.default || module)'), loader: descriptor.scriptSetup?.lang === 'ts' ? 'ts' : 'js', resolveDir: path.dirname(args.path) }
      })
    } }],
  })
  let stylesheet = ''
  if (process.env.DUMB_ONBOARDING_SCREENSHOTS === '1') {
    const assets = path.join(root, '.output/public/_nuxt')
    const filename = (await fs.readdir(assets)).find(name => name.startsWith('entry.') && name.endsWith('.css'))
    if (!filename) throw new Error('Build the frontend before capturing styled review screenshots')
    stylesheet = await fs.readFile(path.join(assets, filename), 'utf8')
  }
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', request.url === '/fixture.js' ? 'text/javascript' : request.url === '/fixture.css' ? 'text/css' : 'text/html')
    response.end(request.url === '/fixture.js' ? result.outputFiles[0].contents : request.url === '/fixture.css' ? stylesheet : '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><main id="app"></main><script src="/fixture.js"></script></body></html>')
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { origin: 'http://127.0.0.1:' + server.address().port, async close() { await new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) } }
}
