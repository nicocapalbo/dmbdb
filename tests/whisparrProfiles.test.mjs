import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { createRenderer, createSSRApp, h, nextTick, ref } from 'vue'
import { parse, compileScript } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'
import { selectWhisparrVersion, savedWhisparrProfile, whisparrProfilesSupported } from '../helper/whisparrProfiles.js'
import { configFromUpdateResponse, configUpdateErrorText, normalizeJsonEditorValue } from '../helper/configEditor.js'
import { normalizeReleaseSelection } from '../helper/sourceSelection.js'

function savedConfig() {
  return {
    whisparr_version: 'v2',
    config_dir: '/example/legacy',
    config_file: '/example/legacy/config.xml',
    install_dir: '/example/program/v2',
    command: ['custom-command'],
    branch: 'custom-branch',
    postgres_enabled: false,
    whisparr_profiles: {
      v2: { initialized: true, config_dir: '/example/legacy', config_file: '/example/legacy/config.xml' },
      v3: { initialized: true, config_dir: '/example/eros', config_file: '/example/eros/config.xml' },
    },
  }
}

test('version selection edits only the version in a valid draft and preserves saved profiles', () => {
  const saved = savedConfig()
  const original = structuredClone(saved)
  const draft = { ...saved, branch: 'pending-custom-source', command: ['pending-command'] }
  const updated = selectWhisparrVersion(draft, saved, 'v3')
  assert.deepEqual(updated, { ...draft, whisparr_version: 'v3' })
  assert.deepEqual(saved, original)
  assert.equal(draft.whisparr_version, 'v2')
  assert.equal(updated.whisparr_profiles, draft.whisparr_profiles)
  assert.equal(selectWhisparrVersion(updated, saved, '').whisparr_version, '')
  assert.equal(savedWhisparrProfile(saved, 'v3').config_dir, '/example/eros')
})

test('version selection rejects legacy support, invalid drafts and PostgreSQL switching', () => {
  const saved = savedConfig()
  assert.equal(whisparrProfilesSupported({ whisparr_version: 'v2' }), false)
  assert.equal(whisparrProfilesSupported({ whisparr_profiles: null }), false)
  assert.equal(whisparrProfilesSupported({ whisparr_profiles: [] }), false)
  assert.throws(() => selectWhisparrVersion(saved, { whisparr_version: 'v2' }, 'v3'), /does not support/)
  assert.throws(() => selectWhisparrVersion(null, saved, 'v3'), /configuration JSON/)
  assert.throws(() => selectWhisparrVersion([], saved, 'v3'), /configuration JSON/)
  assert.throws(() => selectWhisparrVersion(saved, saved, 'v4'), /supported Whisparr version/)
  assert.throws(() => selectWhisparrVersion(saved, { ...saved, postgres_enabled: true }, 'v3'), /separate Whisparr instance/)
  assert.throws(() => selectWhisparrVersion({ ...saved, postgres_enabled: true }, saved, 'v3'), /separate Whisparr instance/)
})

test('only initialized saved profiles produce library directory previews', () => {
  const saved = savedConfig()
  assert.equal(savedWhisparrProfile(saved, ''), null)
  assert.equal(savedWhisparrProfile({ whisparr_profiles: { v3: { initialized: false, config_dir: '/example/eros' } } }, 'v3'), null)
  assert.equal(savedWhisparrProfile({ whisparr_profiles: { v3: { initialized: true, config_dir: '' } } }, 'v3'), null)
})

const { descriptor } = parse(fs.readFileSync(new URL('../components/WhisparrVersionPanel.vue', import.meta.url), 'utf8'))
const componentSource = compileScript(descriptor, { id: 'whisparr-profiles-fixture', inlineTemplate: true }).content
  .replace(/from ['"]~\/([^'"]+\.js)['"]/g, (_match, file) => `from ${JSON.stringify(new URL('../' + file, import.meta.url).href)}`)
  .replace(/from ['"]vue['"]/g, `from ${JSON.stringify(import.meta.resolve('vue'))}`)
const { default: VersionPanel } = await import(`data:text/javascript;base64,${Buffer.from(componentSource).toString('base64')}`)

async function renderPanel(config, saved = config) {
  return renderToString(createSSRApp(VersionPanel, { config, savedConfig: saved }))
}

test('actual panel shows saved library and pending selection without promising conversion', async () => {
  const saved = savedConfig()
  const html = await renderPanel({ ...saved, whisparr_version: 'v3' }, saved)
  assert.match(html, /Whisparr v2/)
  assert.match(html, /Whisparr v3 \(Eros\)/)
  assert.match(html, /Detect existing version/)
  assert.match(html, /\/example\/eros/)
  assert.match(html, /Version change pending/)
  assert.match(html, /Libraries are not converted/)
  assert.match(html, /save, then Start or Restart/)
})

test('actual panel remains hidden for older backends even if the draft contains profiles', async () => {
  const html = await renderPanel(savedConfig(), { whisparr_version: 'v2' })
  assert.doesNotMatch(html, /<select|Whisparr saved libraries/)
})

test('actual panel explains PostgreSQL separation and disables selecting another version', async () => {
  const config = { ...savedConfig(), postgres_enabled: true }
  const html = await renderPanel(config)
  assert.match(html, /<select[^>]+disabled/)
  assert.match(html, /separate Whisparr instance and database/)
  assert.doesNotMatch(html, /Version change pending|Saved library directory:/)
})

test('actual panel change event updates the parent draft without rewriting paths', async () => {
  const saved = savedConfig()
  const draft = ref(structuredClone(saved))
  const container = { children: [] }
  const renderer = createRenderer({
    createElement: tag => ({ tag, props: {}, children: [] }),
    createText: text => ({ text }),
    createComment: text => ({ comment: text }),
    setText: (node, text) => { node.text = text },
    setElementText: (node, text) => { node.text = text; node.children = [] },
    patchProp: (node, key, _oldValue, value) => { node.props[key] = value },
    insert: (node, parent, anchor) => {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
      node.parent = parent
    },
    remove: node => { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1) },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1],
  })
  const app = renderer.createApp({
    render: () => h(VersionPanel, {
      config: draft.value,
      savedConfig: saved,
      onSelectVersion: version => { draft.value = selectWhisparrVersion(draft.value, saved, version) },
    }),
  })
  try {
    app.mount(container)
    const findSelect = node => node.tag === 'select' ? node : node.children?.map(findSelect).find(Boolean)
    const select = findSelect(container)
    assert.ok(select)
    select.props.onChange({ target: { value: 'v3' } })
    await nextTick()
    assert.equal(draft.value.whisparr_version, 'v3')
    assert.equal(select.props.value, 'v3')
    assert.equal(draft.value.config_dir, '/example/legacy')
    assert.deepEqual(draft.value.command, ['custom-command'])
    assert.deepEqual(saved, savedConfig())
  } finally {
    app.unmount()
  }
})

// Execute the real page save handler with API adapters replaced. This covers the
// normalized response before a failed refresh and the next full-editor save.
const pageSource = fs.readFileSync(new URL('../pages/services/[serviceId]/index.vue', import.meta.url), 'utf8')
const saveHandlerSource = pageSource.slice(pageSource.indexOf('const updateConfig = async (persist) => {'), pageSource.indexOf('\nwatch(processConfigRiskSignature'))
function makeSaveHandler(state) {
  return Function('state', `const { ${Object.keys(state).join(', ')} } = state;\n${saveHandlerSource}\nreturn updateConfig;`)(state)
}

test('actual page save adopts normalized library paths before reload and reuses them on the next save', async () => {
  const saved = savedConfig()
  const normalized = { ...saved, whisparr_version: 'v3', config_dir: '/example/eros', config_file: '/example/eros/config.xml', install_dir: '/example/program/v3', command: ['new-program-v3'] }
  const payloads = []
  const state = {
    isProcessing: ref(false), selectedTab: ref(0),
    Config: ref(selectWhisparrVersion(saved, saved, 'v3')),
    service: ref({ process_name: 'Whisparr Adult', config: saved }),
    processConfigBaseline: ref(structuredClone(saved)),
    processConfigRiskAck: ref(true), processConfigNeedsRiskAck: ref(true),
    validationErrors: ref([]), processSchema: ref({}),
    runtimeApiLogLevelSupported: ref(false), projectName: ref('DUMB'),
    normalizeToObject: normalizeJsonEditorValue, normalizeReleaseSelection,
    validateAndCoerce: (_schema, data) => ({ ok: true, data, errors: [] }),
    clonePayload: value => JSON.parse(JSON.stringify(value)), configFromUpdateResponse, configUpdateErrorText,
    configService: { updateConfig: async (_name, data, persist) => { payloads.push({ data: JSON.parse(JSON.stringify(data)), persist }); return { config: normalized } } },
    getConfig: async () => { assert.deepEqual(state.Config.value, normalized); assert.deepEqual(state.service.value.config, normalized) },
    toast: { success() {}, error(details) { assert.fail(details.message) } },
  }
  const updateConfig = makeSaveHandler(state)
  await updateConfig(true)
  assert.equal(payloads[0].data.config_dir, '/example/legacy')
  assert.deepEqual(state.processConfigBaseline.value, normalized)
  assert.equal(state.processConfigRiskAck.value, false)
  state.processConfigNeedsRiskAck.value = false
  state.Config.value.branch = 'second-save'
  await updateConfig(true)
  assert.equal(payloads[1].data.config_dir, '/example/eros')
  assert.equal(payloads[1].data.config_file, '/example/eros/config.xml')
  assert.deepEqual(payloads[1].data.command, ['new-program-v3'])
  assert.equal(payloads[1].data.branch, 'second-save')
  assert.equal(state.isProcessing.value, false)
})

test('actual page save retains the existing refresh path for legacy backend responses', async () => {
  const config = { whisparr_version: 'v2', config_dir: '/example/legacy' }
  let refreshed = false
  const state = {
    isProcessing: ref(false), selectedTab: ref(0), Config: ref(config),
    service: ref({ process_name: 'Whisparr Adult', config }),
    processConfigBaseline: ref(config), processConfigRiskAck: ref(false), processConfigNeedsRiskAck: ref(false),
    validationErrors: ref([]), processSchema: ref(null),
    runtimeApiLogLevelSupported: ref(false), projectName: ref('DUMB'),
    normalizeToObject: normalizeJsonEditorValue, normalizeReleaseSelection,
    validateAndCoerce: (_schema, data) => ({ ok: true, data, errors: [] }),
    clonePayload: value => JSON.parse(JSON.stringify(value)), configFromUpdateResponse, configUpdateErrorText,
    configService: { updateConfig: async () => ({ status: 'success' }) },
    getConfig: async () => { refreshed = true; state.Config.value = { ...config, branch: 'refreshed' } },
    toast: { success() {}, error(details) { assert.fail(details.message) } },
  }
  await makeSaveHandler(state)(false)
  assert.equal(refreshed, true)
  assert.equal(state.Config.value.branch, 'refreshed')
})

test('actual page requires risk review for version and profile changes', () => {
  const start = pageSource.indexOf('const configRiskMatchers = [')
  const end = pageSource.indexOf('\nconst formatConfigPreviewValue', start)
  const riskReasonForPath = Function(pageSource.slice(start, end) + '\nreturn riskReasonForPath;')()
  assert.match(riskReasonForPath('whisparr_version'), /saved library/)
  assert.match(riskReasonForPath('whisparr_profiles.v3.config_dir'), /saved library/)
})

const actionHandlerSource = pageSource.slice(pageSource.indexOf('const executeServiceAction = async (action, protectionOverride) => {'), pageSource.indexOf('\nconst handleServiceAction = async'))
test('actual Start/Restart refreshes prepared profiles while preserving unsaved editor changes', async () => {
  for (const [action, changed, expectedRefreshes] of [['start', false, 1], ['restart', false, 1], ['start', true, 0], ['stop', false, 0]]) {
    let refreshes = 0
    const state = {
      isProcessing: ref(false), service: ref({ process_name: 'Whisparr Adult' }),
      whisparrProfilesAvailable: ref(true), processConfigDiffCounts: ref({ total: changed ? 1 : 0 }),
      SERVICE_ACTIONS: { START: 'start', RESTART: 'restart', STOP: 'stop' },
      performServiceAction: async () => ({ status: 'success' }),
      getServiceStatus: () => {}, getConfig: async () => { refreshes++ },
      isMediaStormService: ref(false), refreshMediaProtectionStatus() {},
      toast: { error(details) { assert.fail(details.message) } },
    }
    const executeServiceAction = Function('state', `const { ${Object.keys(state).join(', ')} } = state;\n${actionHandlerSource}\nreturn executeServiceAction;`)(state)
    await executeServiceAction(action, null)
    assert.equal(refreshes, expectedRefreshes, action + ' with pending edits ' + changed)
    assert.equal(state.isProcessing.value, false)
  }
})
