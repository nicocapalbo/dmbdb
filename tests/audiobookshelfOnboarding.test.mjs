import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'
import { sourceOptionUpdates } from '../helper/sourceSelection.js'
import {
  configuredSourceTargetInstalled,
  resolveConfiguredSourceTarget,
} from '../helper/configuredSourceTarget.js'

const storeSource = fs.readFileSync(new URL('../stores/onboarding.js', import.meta.url), 'utf8')
  .replace("import { defineStore } from 'pinia'", `import { defineStore } from ${JSON.stringify(import.meta.resolve('pinia'))}`)
  .replace("import useService from '~/services/useService.js'", "const useService = () => { throw new Error('Unexpected network request') }")
  .replace("import { useProcessesStore } from '~/stores/processes.js'", "const useProcessesStore = () => ({ projectName: 'DUMB' })")
  .replace("import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'", "const useSetupArrangementsStore = () => ({})")
  .replace(/from ['"]~\/([^'"]+\.js)['"]/g, (_match, file) => 'from ' + JSON.stringify(new URL('../' + file, import.meta.url).href))
const { useOnboardingStore } = await import(`data:text/javascript;base64,${Buffer.from(storeSource).toString('base64')}`)

const audiobookMetadata = {
  key: 'audiobookshelf',
  name: 'Audiobookshelf',
  description: 'Audiobook and podcast library server.',
  service_options: {
    port: 13378,
    config_dir: '/audiobookshelf/config',
    metadata_dir: '/audiobookshelf/metadata',
  },
  service_option_descriptions: {
    port: 'Web UI port',
    config_dir: 'Persistent configuration directory',
    metadata_dir: 'Persistent metadata directory',
  },
}

const sourceOptions = {
  release_version_enabled: false,
  release_version: 'latest',
  branch_enabled: false,
  branch: 'master',
  commit_sha: '',
}

function makeStore({ advertised = true, selected = true, sourceSelection = false } = {}) {
  const store = useOnboardingStore(createPinia())
  store._coreMeta = []
  store._optionalMeta = advertised ? [structuredClone(audiobookMetadata)] : []
  if (advertised && sourceSelection) {
    Object.assign(store._optionalMeta[0].service_options, sourceOptions)
  }
  store.optionalServices = selected && advertised ? ['audiobookshelf'] : []
  return store
}

const fixtureKey = '__dumbAudiobookshelfOnboardingFixture'
const categoryDescriptor = parse(fs.readFileSync(
  new URL('../components/onboarding/ServiceCategory.vue', import.meta.url), 'utf8',
)).descriptor
const categorySource = compileScript(categoryDescriptor, {
  id: 'onboarding-service-category',
  inlineTemplate: true,
}).content.replace(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
const categoryModule = `data:text/javascript;base64,${Buffer.from(categorySource).toString('base64')}`

const descriptionDescriptor = parse(fs.readFileSync(
  new URL('../components/ServiceDescription.vue', import.meta.url), 'utf8',
)).descriptor
const descriptionSource = compileScript(descriptionDescriptor, {
  id: 'onboarding-service-description',
  inlineTemplate: true,
}).content
  .replace(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  .replace(/from ['"]marked['"]/g, `from ${JSON.stringify(import.meta.resolve('marked'))}`)
const descriptionModule = `data:text/javascript;base64,${Buffer.from(descriptionSource).toString('base64')}`
async function loadComponent(path) {
  const { descriptor } = parse(fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8'))
  const source = compileScript(descriptor, { id: 'audiobookshelf-onboarding', inlineTemplate: true }).content
    .replace(/import \{ useOnboardingStore \} from ['"]~\/stores\/onboarding\.js['"]/, `const useOnboardingStore = () => globalThis[${JSON.stringify(fixtureKey)}]`)
    .replace(/import useService from ['"]~\/services\/useService\.js['"]/, 'const useService = () => ({ configService: {} })')
    .replace(/import \{ useProcessesStore \} from ['"]~\/stores\/processes\.js['"]/, "const useProcessesStore = () => ({ projectName: 'DUMB' })")
    .replace(/import DescriptionText from ['"]~\/components\/DescriptionText\.vue['"]/, 'const DescriptionText = () => null')
    .replace(/import ServiceDescription from ['"]~\/components\/ServiceDescription\.vue['"]/, `import ServiceDescription from ${JSON.stringify(descriptionModule)}`)
    .replace(/import ServiceCategory from ['"]~\/components\/onboarding\/ServiceCategory\.vue['"]/, `import ServiceCategory from ${JSON.stringify(categoryModule)}`)
    .replace(/from ['"]~\/([^'"]+\.js)['"]/g, (_match, file) => `from ${JSON.stringify(new URL('../' + file, import.meta.url).href)}`)
    .replace(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
  const script = "const window = { location: { protocol: 'http:', hostname: 'example.test', port: '3005' } };\n" + source
  return (await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`)).default
}
const OptionalServices = await loadComponent('components/onboarding/Step3Optional.vue')
const ServiceOptions = await loadComponent('components/onboarding/Step4ServiceOptions.vue')
async function render(component, store) {
  globalThis[fixtureKey] = store
  try { return await renderToString(createSSRApp(component)) }
  finally { delete globalThis[fixtureKey] }
}

test('advertised Audiobookshelf metadata participates in optional-service options and review payloads', () => {
  const store = makeStore()
  assert.deepEqual(store.servicesMetaWithOptions, ['audiobookshelf'])
  store.setUserServiceOptions('audiobookshelf', {
    port: 14378,
    config_dir: '/example/audiobookshelf/config',
    metadata_dir: '/example/audiobookshelf/metadata',
  })
  const payload = store.reviewPayload
  assert.deepEqual(payload.optional_services, ['audiobookshelf'])
  assert.deepEqual(payload.optional_service_options.audiobookshelf, {
    port: 14378,
    config_dir: '/example/audiobookshelf/config',
    metadata_dir: '/example/audiobookshelf/metadata',
  })
  assert.deepEqual(audiobookMetadata.service_options, {
    port: 13378,
    config_dir: '/audiobookshelf/config',
    metadata_dir: '/audiobookshelf/metadata',
  })
})

test('Audiobookshelf first-setup guidance appears only when selected', async () => {
  const selected = await render(OptionalServices, makeStore())
  assert.match(selected, /Audiobookshelf first setup/)
  assert.match(selected, /Initial Server Setup/)
  assert.match(selected, /create the root account/)
  assert.match(selected, /persistent storage/)
  assert.match(selected, /media folders that DUMB can read/)
  const unselected = await render(OptionalServices, makeStore({ selected: false }))
  assert.doesNotMatch(unselected, /Audiobookshelf first setup/)
})

test('actual service-options component renders advertised persistent paths and port', async () => {
  const store = makeStore()
  store.step = store.optionsStart
  const html = await render(ServiceOptions, store)
  assert.match(html, /audiobookshelf/)
  assert.match(html, /13378/)
  assert.match(html, /\/audiobookshelf\/config/)
  assert.match(html, /\/audiobookshelf\/metadata/)
})

test('older backend catalogs do not acquire unsupported Audiobookshelf options or submissions', async () => {
  const store = makeStore({ advertised: false })
  store.setUserServiceOptions('audiobookshelf', { metadata_dir: '/example/unsupported' })
  assert.deepEqual(store.servicesMetaWithOptions, [])
  assert.deepEqual(store.reviewPayload.optional_services, [])
  assert.deepEqual(store.reviewPayload.optional_service_options, {})
  const html = await render(OptionalServices, store)
  assert.doesNotMatch(html, /Audiobookshelf first setup/)
})

test('Audiobookshelf source controls appear only when advertised by the backend', async () => {
  const store = makeStore({ sourceSelection: true })
  store.step = store.optionsStart
  const html = await render(ServiceOptions, store)
  assert.match(html, /branch_enabled/)
  assert.match(html, /value="master"/)
  assert.match(html, /commit_sha/)
  assert.match(html, /Exact source pin:/)

  const olderStore = makeStore()
  olderStore.step = olderStore.optionsStart
  const olderHtml = await render(ServiceOptions, olderStore)
  assert.doesNotMatch(olderHtml, /branch_enabled/)
  assert.doesNotMatch(olderHtml, /commit_sha/)
  assert.doesNotMatch(olderHtml, /Exact source pin:/)
})

test('Audiobookshelf branch selection survives onboarding review and clears a prior source pin', () => {
  const store = makeStore({ sourceSelection: true })
  const pinned = {
    ...sourceOptions,
    release_version: 'v2.37.1',
    commit_sha: 'a'.repeat(40),
  }
  store.setUserServiceOptions('audiobookshelf', pinned)
  store.setUserServiceOptions('audiobookshelf', sourceOptionUpdates('branch', 'feature/audio-library', pinned))
  store.setUserServiceOptions('audiobookshelf', sourceOptionUpdates('branch_enabled', true, pinned))

  const edits = store.reviewPayload.optional_service_options.audiobookshelf
  const config = { ...sourceOptions, ...edits }
  assert.equal(config.branch_enabled, true)
  assert.equal(config.branch, 'feature/audio-library')
  assert.equal(config.release_version_enabled, false)
  assert.equal(config.commit_sha, '')
  assert.equal('commit_sha' in edits, false)
  assert.deepEqual(resolveConfiguredSourceTarget(config, 'audiobookshelf'), {
    kind: 'branch',
    value: 'feature/audio-library',
    label: 'feature/audio-library',
  })
  assert.deepEqual(audiobookMetadata.service_options, {
    port: 13378,
    config_dir: '/audiobookshelf/config',
    metadata_dir: '/audiobookshelf/metadata',
  })
})

test('Audiobookshelf exact commit selection replaces a branch and remains reproducible in review', () => {
  const store = makeStore({ sourceSelection: true })
  const branchConfig = { ...sourceOptions, branch_enabled: true, release_version_enabled: false }
  const commit = 'ABCDEF0123456789'.repeat(2) + 'ABCDEF01'
  store.setUserServiceOptions('audiobookshelf', branchConfig)
  store.setUserServiceOptions('audiobookshelf', sourceOptionUpdates('commit_sha', '  ' + commit + '  ', branchConfig))

  const edits = store.reviewPayload.optional_service_options.audiobookshelf
  const config = { ...sourceOptions, ...edits }
  assert.equal(config.commit_sha, commit.toLowerCase())
  assert.equal(config.branch_enabled, false)
  assert.equal(config.release_version_enabled, false)
  const target = resolveConfiguredSourceTarget(config, 'audiobookshelf')
  assert.deepEqual(target, {
    kind: 'commit',
    value: commit.toLowerCase(),
    label: commit.slice(0, 12).toLowerCase(),
  })
  assert.equal(configuredSourceTargetInstalled(target, {
    current_version: 'commit-' + commit.slice(0, 12).toLowerCase(),
  }), true)
  assert.equal(configuredSourceTargetInstalled(target, { current_version: 'v2.37.1' }), false)

  store.setUserServiceOptions('audiobookshelf', sourceOptionUpdates('release_version_enabled', true, config))
  const releaseConfig = { ...sourceOptions, ...store.reviewPayload.optional_service_options.audiobookshelf }
  assert.equal(releaseConfig.commit_sha, '')
  assert.equal(releaseConfig.branch_enabled, false)
  assert.equal(releaseConfig.release_version_enabled, true)
})

test('Audiobookshelf branch status requires the selected branch and current source revision', () => {
  const target = resolveConfiguredSourceTarget({
    ...sourceOptions,
    release_version_enabled: false,
    branch_enabled: true,
  }, 'audiobookshelf')
  const status = {
    configured_target_kind: 'branch',
    configured_target_installed: true,
    current_version: 'master-abcdef012345',
    available_version: 'master-abcdef012345',
  }
  assert.equal(configuredSourceTargetInstalled(target, status), true)
  assert.equal(configuredSourceTargetInstalled(target, {
    ...status,
    available_version: 'master-fedcba987654',
  }), false)
  assert.equal(configuredSourceTargetInstalled(target, {
    ...status,
    current_version: 'v2.37.1',
    available_version: 'v2.37.1',
  }), false)
  assert.equal(configuredSourceTargetInstalled(target, {
    ...status,
    current_version: 'development-abcdef012345',
    available_version: 'development-abcdef012345',
  }), false)
  assert.equal(configuredSourceTargetInstalled(target, {
    ...status,
    configured_target_installed: false,
  }), false)
})
