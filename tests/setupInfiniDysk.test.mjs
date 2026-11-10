import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { createPinia } from 'pinia'
import { setupFieldValue } from '../helper/setupArrangements.js'
import {
  setupInfiniDyskRuntimeSupported, setupRuntimeFields, setupRuntimeValues,
  setupNativeTransition, setupInfiniDyskTopologies, setupInfiniDyskNeedsRclone,
} from '../helper/setupInfiniDysk.js'

const capabilities = { api_version: '2.24.0', setup_arrangements: true, setup_infinidysk_runtime_choices: true, setup_infinidysk_runtime_protocol: 1, infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1 }
const transition = { kind: 'native_transition', action: 'native_transition', service_key: 'infinidysk', native_transition: { runtime_generation: '2', mode: 'fresh', mount_backend: 'fuse' } }
const topology = (mount = 'fuse') => ({ services: [{ service_key: 'infinidysk', runtime_topology: { runtime_generation: '2', mount_backend: mount, mount_path: '/mnt/debrid/example', dependencies: mount === 'rclone' ? ['rclone'] : [] } }] })

const loadStore = async file => {
  const source = fs.readFileSync(new URL('../stores/' + file, import.meta.url), 'utf8')
    .replace("import { defineStore } from 'pinia'", 'import { defineStore } from ' + JSON.stringify(import.meta.resolve('pinia')))
    .replace("import useService from '~/services/useService.js'", 'const useService = () => globalThis.__nativeSetupBackend')
    .replace("import { useProcessesStore } from '~/stores/processes.js'", 'const useProcessesStore = () => ({ projectName: "DUMB" })')
    .replace("import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'", 'const useSetupArrangementsStore = () => globalThis.__nativeSetupStore')
    .replace(/from ['"]~\/([^'"]+\.js)['"]/g, (_match, file) => 'from ' + JSON.stringify(new URL('../' + file, import.meta.url).href))
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
}
const { useOnboardingStore } = await loadStore('onboarding.js')
const { useSetupArrangementsStore } = await loadStore('setupArrangements.js')

test('native setup fields and handoff require every literal capability and protocol gate', () => {
  assert.equal(setupInfiniDyskRuntimeSupported(capabilities), true)
  assert.deepEqual(setupNativeTransition(transition, capabilities), transition.native_transition)
  assert.equal(setupNativeTransition({ ...transition, native_transition: { ...transition.native_transition, mode: 'migrate' } }, capabilities).mode, 'migrate')
  for (const changed of [{ setup_arrangements: false }, { setup_infinidysk_runtime_choices: 'true' }, { setup_infinidysk_runtime_protocol: '1' }, { infinidysk_v2_migration_protocol: 2 }, { api_version: '2.23.0' }, { infinidysk_v2_migration: false }]) {
    assert.equal(setupInfiniDyskRuntimeSupported({ ...capabilities, ...changed }), false)
    assert.equal(setupNativeTransition(transition, { ...capabilities, ...changed }), null)
  }
  for (const changed of [{ mode: 'unknown' }, { mount_backend: 'none' }, { runtime_generation: '1' }]) assert.equal(setupNativeTransition({ ...transition, native_transition: { ...transition.native_transition, ...changed } }, capabilities), null)
  assert.equal(setupNativeTransition({ ...transition, kind: 'other' }, capabilities), null)
  const fields = [{ key: 'infinidysk::runtime_generation' }, { key: 'nzbdav::mount_backend' }, { key: 'infinidysk::nntp' }]
  assert.deepEqual(setupRuntimeFields(fields, {}), fields.slice(2))
  assert.deepEqual(setupRuntimeValues({ 'infinidysk::runtime_generation': '2', 'infinidysk::nntp': [] }, {}), { 'infinidysk::nntp': [] })
})

test('only admitted server topology removes rclone and locked fields show the current value', () => {
  const metadata = { key: 'infinidysk', service_options: { infinidysk: { runtime_generation: '1', mount_backend: 'rclone' } } }
  assert.equal(setupInfiniDyskNeedsRclone(metadata), true)
  assert.equal(setupInfiniDyskNeedsRclone(metadata, setupInfiniDyskTopologies(topology(), capabilities)), false)
  assert.equal(setupInfiniDyskNeedsRclone(metadata, setupInfiniDyskTopologies(topology(), {})), true)
  const invalid = topology(); invalid.services[0].runtime_topology.dependencies = ['rclone']
  assert.deepEqual(setupInfiniDyskTopologies(invalid, capabilities), {})
  assert.deepEqual(setupInfiniDyskTopologies({ services: [null] }, capabilities), {})
  assert.deepEqual(setupInfiniDyskTopologies({ services: {} }, capabilities), {})
  assert.equal(setupFieldValue({ key: 'mount', default: 'rclone', readonly: true }, { mount: 'fuse' }), 'rclone')
  assert.equal(setupInfiniDyskNeedsRclone({ key: 'nzbdav', service_options: { nzbdav: { runtime_generation: '2', mount_backend: 'fuse' } } }), false)
})

test('native FUSE replan preserves wizard position and custom draft while excluding rclone and raw runtime fields', async () => {
  const requests = []
  globalThis.__nativeSetupBackend = { processService: { planSetup: async payload => { requests.push(JSON.parse(JSON.stringify(payload))); return { plan_id: 'native-plan', ...topology() } } } }
  try {
    const pinia = createPinia()
    const setup = useSetupArrangementsStore(pinia)
    globalThis.__nativeSetupStore = setup
    const store = useOnboardingStore(pinia)
    store.$patch({ _capabilities: capabilities, coreServices: [{ name: 'infinidysk' }],
      _coreMeta: [{ key: 'infinidysk', dependencies: ['rclone'], service_options: { infinidysk: { process_name: 'InfiniDysk' }, rclone: { mount_path: '/mnt/debrid/example' } } }],
      _userServiceOptions: { infinidysk: { config_dir: '/custom/v1', branch_enabled: true, branch: 'custom-v1', command: ['custom-v1'], env: { CONFIG_PATH: '/custom/v1' }, runtime_generation: '2', mount_backend: 'fuse', mount_path: '/wrong' }, 'infinidysk.rclone': { mount_path: '/custom/mount' } },
      arrangementValues: { 'infinidysk::runtime_generation': '2', 'infinidysk::mount_backend': 'fuse' },
    })
    store.step = store.wizardSteps.findIndex(step => step.id === 'arrangement') + 1
    await store.previewSetupChoices()
    assert.equal(store.currentWizardStep.id, 'arrangement')
    assert.equal(requests.length, 2)
    assert.equal(store.servicesMetaWithOptions.includes('infinidysk.rclone'), false)
    assert.equal(store.allServicesMeta.includes('infinidysk.rclone'), false)
    assert.deepEqual(store.reviewPayload.core_services[0].service_options, { infinidysk: {} })
    assert.deepEqual(store._userServiceOptions['infinidysk.rclone'], { mount_path: '/custom/mount' })
    assert.equal(setup.planSignature, JSON.stringify(store.setupPayload))
    store.syncSetupTopology(topology('rclone'))
    assert.equal(store.currentWizardStep.id, 'arrangement')
    assert.equal(store.allServicesMeta.includes('infinidysk.rclone'), true)
    assert.equal(store.servicesMetaWithOptions.includes('infinidysk.rclone'), false)
    assert.equal('rclone' in store.reviewPayload.core_services[0].service_options, false)
    const legacy = topology('rclone'); legacy.services[0].runtime_topology.runtime_generation = '1'
    store.syncSetupTopology(legacy)
    assert.deepEqual(store.reviewPayload.core_services[0].service_options.rclone, { mount_path: '/custom/mount' })
    assert.deepEqual(store.reviewPayload.core_services[0].service_options.infinidysk, { config_dir: '/custom/v1', branch_enabled: true, branch: 'custom-v1', command: ['custom-v1'], env: { CONFIG_PATH: '/custom/v1' } })
    store.syncSetupTopology(topology())
    store.coreServices.push({ name: 'decypharr' })
    store._coreMeta.push({ key: 'decypharr', dependencies: ['rclone'], service_options: { decypharr: { mount_type: 'external_rclone' }, rclone: { mount_path: '/other/mount' } } })
    store._userServiceOptions['decypharr.rclone'] = { mount_path: '/other/custom' }
    assert.equal(store.servicesMetaWithOptions.includes('decypharr.rclone'), true)
    assert.deepEqual(store.reviewPayload.core_services.find(core => core.name === 'decypharr').service_options.rclone, { mount_path: '/other/custom' })
    store._capabilities = {}
    assert.deepEqual(store.setupPayload.arrangement.values, {})
  } finally { delete globalThis.__nativeSetupBackend; delete globalThis.__nativeSetupStore }
})
