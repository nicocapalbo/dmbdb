import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'

import { sourceOptionUpdates } from '../helper/sourceSelection.js'

// Exercise the real store while keeping backend/network adapters out of this test.
const storeSource = fs.readFileSync(new URL('../stores/onboarding.js', import.meta.url), 'utf8')
  .replace("import { defineStore } from 'pinia'", `import { defineStore } from ${JSON.stringify(import.meta.resolve('pinia'))}`)
  .replace("import useService from '~/services/useService.js'", "const useService = () => { throw new Error('Unexpected backend call in submission test') }")
  .replace("import { useProcessesStore } from '~/stores/processes.js'", "const useProcessesStore = () => ({ projectName: 'DUMB' })")
const { useOnboardingStore } = await import(`data:text/javascript;base64,${Buffer.from(storeSource + '\n//# sourceURL=onboarding-fixture-store.mjs').toString('base64')}`)

function makeStore(options, instanceNames = []) {
  const store = useOnboardingStore(createPinia())
  store._coreMeta = [{
    key: 'whisparr',
    supports_instances: instanceNames.length > 0,
    service_options: { whisparr: options },
    service_option_descriptions: { whisparr: { whisparr_version: 'Whisparr version' } },
  }]
  store.coreServices = instanceNames.length
    ? instanceNames.map(instance_name => ({ name: 'whisparr', instance_name }))
    : [{ name: 'whisparr' }]
  return store
}

test('Whisparr family selection preserves explicit source and runtime options', () => {
  const defaults = { whisparr_version: '', branch: 'main', repo_name: 'whisparr', install_dir: '/example/default', command: ['default-command'] }
  const store = makeStore(defaults)
  const existing = { branch: 'custom-source', repo_name: 'custom-repository', install_dir: '/example/custom', command: ['custom-command'] }
  store.setUserServiceOptions('whisparr', existing)
  const snapshot = structuredClone(defaults)

  const update = sourceOptionUpdates('whisparr_version', 'v3', defaults)
  assert.deepEqual(update, { whisparr_version: 'v3' })
  store.setUserServiceOptions('whisparr', update)

  assert.deepEqual(store.reviewPayload.core_services[0].service_options.whisparr, { ...existing, whisparr_version: 'v3' })
  assert.deepEqual(defaults, snapshot)
})

test('detect selection retains empty semantics without replacing it with v2', () => {
  for (const advertisedVersion of ['', 'v2']) {
    const store = makeStore({ whisparr_version: advertisedVersion })
    store.setUserServiceOptions('whisparr', sourceOptionUpdates('whisparr_version', 'v3'))
    store.setUserServiceOptions('whisparr', sourceOptionUpdates('whisparr_version', ''))

    const submitted = store.reviewPayload.core_services[0].service_options
    assert.deepEqual(submitted, advertisedVersion === '' ? {} : { whisparr: { whisparr_version: '' } })
  }
})

test('Whisparr instance selections remain separate in onboarding submission', () => {
  const store = makeStore({ whisparr_version: '' }, ['Legacy', 'Eros'])
  store.setUserServiceOptions('whisparr::Legacy', sourceOptionUpdates('whisparr_version', 'v2'))
  store.setUserServiceOptions('whisparr::Eros', sourceOptionUpdates('whisparr_version', 'v3'))

  assert.deepEqual(store.reviewPayload.core_services.map(service => ({
    instance: service.instance_name,
    options: service.service_options,
  })), [
    { instance: 'Legacy', options: { whisparr: { whisparr_version: 'v2' } } },
    { instance: 'Eros', options: { whisparr: { whisparr_version: 'v3' } } },
  ])
})

test('legacy backend metadata does not receive an unsupported version selector', () => {
  const store = makeStore({ core_service: 'decypharr' })
  store.setUserServiceOptions('whisparr', sourceOptionUpdates('whisparr_version', 'v3'))

  assert.deepEqual(store.reviewPayload.core_services[0].service_options, {})
})

// Render the actual SFC so selector visibility and both layout branches are covered.
const fixtureStoreKey = '__dumbWhisparrOptionsFixtureStore'
const { descriptor } = parse(fs.readFileSync(new URL('../components/onboarding/Step4ServiceOptions.vue', import.meta.url), 'utf8'))
let componentSource = compileScript(descriptor, { id: 'whisparr-options-fixture', inlineTemplate: true }).content
componentSource = componentSource
  .replace(/import \{ useOnboardingStore \} from ['"]~\/stores\/onboarding\.js['"]/, `const useOnboardingStore = () => globalThis[${JSON.stringify(fixtureStoreKey)}]`)
  .replace(/import useService from ['"]~\/services\/useService\.js['"]/, 'const useService = () => ({ configService: {} })')
  .replace(/import \{ useProcessesStore \} from ['"]~\/stores\/processes\.js['"]/, "const useProcessesStore = () => ({ projectName: 'DUMB' })")
  .replace(/import DescriptionText from ['"]~\/components\/DescriptionText\.vue['"]/, 'const DescriptionText = () => null')
  .replace(/from ['"]~\/([^'"]+\.js)['"]/g, (_match, file) => `from ${JSON.stringify(new URL('../' + file, import.meta.url).href)}`)
  .replace(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
componentSource = "const window = { location: { protocol: 'http:', hostname: 'example.test', port: '3005' } };\n" + componentSource
const { default: ServiceOptions } = await import(`data:text/javascript;base64,${Buffer.from(componentSource + '\n//# sourceURL=whisparr-options-fixture.mjs').toString('base64')}`)

async function renderOptions(store) {
  store.step = store.optionsStart
  globalThis[fixtureStoreKey] = store
  try {
    return await renderToString(createSSRApp(ServiceOptions))
  } finally {
    delete globalThis[fixtureStoreKey]
  }
}

test('Whisparr selector renders its three choices only when the backend advertises it', async () => {
  const html = await renderOptions(makeStore({ whisparr_version: '' }))
  assert.match(html, /aria-label="Whisparr version"/)
  for (const label of ['Detect existing version', 'Whisparr v2', 'Whisparr v3 (Eros)']) {
    assert.ok(html.includes(label))
  }
  assert.match(html, /separate configuration\/data directory/)
  const legacyHtml = await renderOptions(makeStore({ core_service: 'decypharr' }))
  assert.doesNotMatch(legacyHtml, /aria-label="Whisparr version"|Whisparr version:<\/strong>/)
})

test('Whisparr selectors render separately for multiple instances', async () => {
  const html = await renderOptions(makeStore({ whisparr_version: '' }, ['Legacy', 'Eros']))
  assert.match(html, /aria-label="Whisparr version for Legacy"/)
  assert.match(html, /aria-label="Whisparr version for Eros"/)
  assert.equal(html.split('Whisparr v3 (Eros)').length - 1, 2)
})
