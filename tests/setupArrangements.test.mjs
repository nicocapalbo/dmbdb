import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { createPinia } from 'pinia'
import { onboardingSteps, onboardingStepNumber } from '../helper/onboardingSteps.js'
import { safeSetupLink, setupActionMatchesService, setupCoverageText, sanitizeSetupPreview, editableSetupChoices, setupChoiceLines, setupFieldValue, setupFieldVisible, setupCheckLabel, setupLibraryOptions, setupLibrarySupportsLanguage, guidedMediaChoices, setupActionFields, setupActionTiming, setupRefreshDelay, setupDefaultValues, setupChangeValue, setupAdoptionKeys, setupPreviewNeedsConsent } from '../helper/setupArrangements.js'

const source = fs.readFileSync(new URL('../stores/setupArrangements.js', import.meta.url), 'utf8')
  .replace("import { defineStore } from 'pinia'", 'import { defineStore } from ' + JSON.stringify(import.meta.resolve('pinia')))
  .replace("import useService from '~/services/useService.js'", 'const useService = () => globalThis.__setupTestBackend')
  .replace(/from ['"]~\/([^'"]+\.js)['"]/g, (_match, file) => 'from ' + JSON.stringify(new URL('../' + file, import.meta.url).href))
const { useSetupArrangementsStore } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

test('wizard descriptors keep review, options and provider offsets aligned for optionless metadata', () => {
  for (const arrangements of [false, true]) for (const serviceUi of [false, true]) {
    const steps = onboardingSteps({ providers: [{ name: 'decypharr' }], services: [], arrangements, serviceUi })
    assert.equal(steps[onboardingStepNumber(steps, 'review') - 1].component, 'review')
    assert.equal(steps[onboardingStepNumber(steps, 'progress') - 1].component, 'progress')
    assert.equal(steps.filter(step => step.component === 'options').length, 0)
    assert.equal(steps.find(step => step.component === 'provider').providerIndex, 0)
    assert.equal(new Set(steps.map(step => step.id)).size, steps.length)
  }
  assert.deepEqual(onboardingSteps({ services: ['radarr', 'sonarr'] }).filter(step => step.component === 'options').map(step => step.serviceKey), ['radarr', 'sonarr'])
})

test('setup links reject active schemes, protocol-relative URLs and credentials', () => {
  for (const input of ['javascript:alert(1)', '//example.test', 'https://name:secret@example.test', '/\\\\example.test', 'data:text/html,test']) assert.equal(safeSetupLink(input), '')
  assert.equal(safeSetupLink('/services/Plex'), '/services/Plex')
  assert.equal(safeSetupLink('https://example.test/guide'), 'https://example.test/guide')
})

test('coverage displays only explicit backend counts and preserves independent verification', () => {
  assert.deepEqual(setupCoverageText({ automation: { count: 5, total: 8 }, applied: { count: 3, total: 8 }, verified: { count: 1, total: 8 } }), ['Automatic: 5 / 8', 'Applied: 3 / 8', 'Verified: 1 / 8'])
  assert.deepEqual(setupCoverageText({ services: 100, complete: true }), [])
  assert.deepEqual(setupCoverageText({ denominator: 8, automatic: 3, after_input: 2, manual: 3, applied: 2, verified: 1 }), ['Automatic: 3 / 8', 'Automatic after input: 2 / 8', 'Manual: 3 / 8', 'Applied: 2 / 8', 'Verified: 1 / 8'])
  assert.equal(setupActionMatchesService({ service_key: 'radarr', instance_key: 'radarr.HD' }, 'radarr', 'radarr.HD'), true)
  assert.equal(setupActionMatchesService({ service_key: 'radarr', instance_key: 'radarr.UHD' }, 'radarr', 'radarr.HD'), false)
})

test('credential-bearing review objects are masked recursively', () => {
  assert.deepEqual(sanitizeSetupPreview({ api_key: 'private', rows: [{ password: 'private', name: 'Provider' }] }), { api_key: '[configured]', rows: [{ password: '[configured]', name: 'Provider' }] })
})

test('nested schema defaults preserve typed choices without carrying credentials into drafts', () => {
  const fields = [{ key: 'verify_tls', type: 'boolean', default: true }, { key: 'password', type: 'password', default: 'never-copy' }, { key: 'authorization', secret: true, default: 'never-copy' }, { key: 'priority', type: 'number', default: 25 }]
  assert.deepEqual(setupDefaultValues(fields), { verify_tls: true, priority: 25 })
  const field = { key: 'setup::external_arrs', type: 'list', item_fields: fields, default: [{ verify_tls: false, password: 'never-copy', authorization: 'never-copy', priority: 0 }] }
  assert.deepEqual(setupFieldValue(field), [{ verify_tls: false, priority: 0 }])
  assert.equal(setupChoiceLines(field, [{ verify_tls: true, priority: 25, password: 'private' }]).join('').includes('private'), false)
  assert.match(setupChoiceLines(field, [{ verify_tls: true, priority: 25, password: 'private' }]).join(''), /Configured/)
  const nested = { key: 'policy', type: 'object', fields: [{ key: 'enabled', type: 'boolean', default: false }, { key: 'detail', visible_when: { key: 'enabled', equals: true } }] }
  assert.deepEqual(setupChoiceLines(nested, { detail: 'hidden' }), ['enabled: No'])
})

test('change previews mask credential fields, nested secrets and endpoint authentication', () => {
  assert.equal(setupChangeValue({ field: 'api_key' }, 'private'), 'Hidden credential')
  assert.equal(setupChangeValue({ field: 'custom', secret: true }, 'private'), 'Hidden credential')
  assert.equal(setupChangeValue({ field: 'url' }, 'https://user:private@example.test/api?token=private#private'), 'https://example.test/api')
  const nested = setupChangeValue({ field: 'settings' }, { password: 'private', label: 'Provider' })
  assert.equal(nested.includes('private'), false)
  assert.match(nested, /Provider/)
  assert.deepEqual(setupAdoptionKeys({ source: 'seerr.Requests' }), { consent: 'seerr.Requests::adopt_existing', preview: 'seerr.Requests::adoption_preview_id' })
  assert.equal(setupPreviewNeedsConsent({ evidence: { changes: [{ requires_consent: true }] } }), true)
  assert.equal(setupPreviewNeedsConsent({ evidence: { changes: [] } }), false)
})

test('stale previews cannot replace a newer plan and changed inputs must be reviewed before start', async () => {
  const pending = []
  globalThis.__setupTestBackend = { processService: { planSetup: payload => new Promise(resolve => pending.push({ payload, resolve })) } }
  const store = useSetupArrangementsStore(createPinia())
  const first = store.preview({ choice: 'first' })
  const second = store.preview({ choice: 'second' })
  pending[1].resolve({ plan_id: 'new', actions: [] }); await second
  pending[0].resolve({ plan_id: 'old', actions: [] }); await first
  assert.equal(store.plan.plan_id, 'new')
  await assert.rejects(store.start({ choice: 'changed' }), /changed/)
  delete globalThis.__setupTestBackend
})

test('only the run identifier is browser-persisted and retry errors keep the saved run', async () => {
  const saved = new Map()
  globalThis.window = { localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } }
  globalThis.__setupTestBackend = { processService: {
    planSetup: async () => ({ plan_id: 'plan-a', actions: [] }),
    startSetupRun: async () => ({ run_id: 'run-a', status: 'partial', actions: [] }),
    retrySetupRun: async () => { throw { response: { data: { detail: [{ input: 'private' }] } } } },
  } }
  try {
    const store = useSetupArrangementsStore(createPinia())
    const payload = { arrangement: { values: { password: 'private' } } }
    await store.preview(payload); await store.start(payload)
    assert.deepEqual([...saved.entries()], [['dumb.setup.run', 'run-a']])
    await store.operate('retry')
    assert.equal(store.run.run_id, 'run-a')
    assert.equal(store.error.includes('private'), false)
    assert.equal(store.actionBusy, '')
  } finally { delete globalThis.window; delete globalThis.__setupTestBackend }
})

test('expired remembered runs fall back to the backend latest run without discarding results', async () => {
  const calls = []
  globalThis.window = { localStorage: { getItem: () => 'expired-run', setItem() {}, removeItem() {} } }
  globalThis.__setupTestBackend = { processService: {
    getCapabilities: async () => ({ setup_arrangements: true }),
    getSetupRun: async () => { calls.push('saved'); throw { response: { status: 404 } } },
    getLatestSetupRun: async () => { calls.push('latest'); return { run_id: 'current-run', status: 'partial' } },
  } }
  try {
    const store = useSetupArrangementsStore(createPinia())
    await store.refresh()
    assert.deepEqual(calls, ['saved', 'latest'])
    assert.equal(store.run.run_id, 'current-run')
    assert.equal(store.error, '')
  } finally { delete globalThis.window; delete globalThis.__setupTestBackend }
})

test('server presence markers never become submitted credentials while nonsecret choices remain editable', () => {
  const values = editableSetupChoices({ 'seerr::media_server': 'external', providers: [{ name: 'Usenet', password: '[configured]', host: 'news.example.test' }], api_key: '[configured]', url: '[configured URL]' })
  assert.deepEqual(values, { 'seerr::media_server': 'external', providers: [{ name: 'Usenet', host: 'news.example.test' }] })
})

test('review choices show actual target labels, library paths and provider settings without credentials', () => {
  assert.deepEqual(setupChoiceLines({ key: 'app::targets', type: 'multiselect', options: [{ value: 'sonarr.Series', label: 'Sonarr Series' }] }, ['sonarr.Series']), ['Sonarr Series'])
  assert.deepEqual(setupChoiceLines({ key: 'app::targets', type: 'multiselect' }, []), ['No connections selected'])
  assert.deepEqual(setupChoiceLines({ key: 'app::api_key', type: 'string' }, 'private-value'), ['Configured'])
  const provider = setupChoiceLines({ key: 'provider::nntp', type: 'nntp_providers' }, [{ host: 'news.example.test', port: 563, tls: true, connections: 8, password: 'private-value' }]).join('')
  assert.match(provider, /news.example.test/)
  assert.equal(provider.includes('private-value'), false)
  assert.match(setupChoiceLines({ key: 'plex::libraries', type: 'libraries' }, [{ name: 'Movies', media_type: 'movie', paths: ['/media/movies'], create_if_missing: true }])[0], /\/media\/movies.*Create only if missing/)
  assert.match(setupChoiceLines({ key: 'jellyfin::libraries', type: 'libraries' }, [{ name: 'Movies', media_type: 'movie', paths: ['/media/movies'], create_if_missing: true, scan_on_create: true }])[0], /Scan after creating this library/)
  assert.doesNotMatch(setupChoiceLines({ key: 'jellyfin::libraries', type: 'libraries' }, [{ name: 'Movies', media_type: 'movie', paths: ['/media/movies'], create_if_missing: false, scan_on_create: true }])[0], /Scan after creating/)
})

test('shared account forms honor advertised defaults and conditional reuse fields', () => {
  const source = { key: 'decypharr::nntp_source', default: 'own' }
  const own = { key: 'decypharr::nntp', visible_when: { key: source.key, equals: 'own' } }
  const budget = { key: 'decypharr::nntp_connections', default: 5, visible_when: { key: source.key, not_equals: 'own' } }
  assert.equal(setupFieldVisible(own, {}, [source, own, budget]), true)
  assert.equal(setupFieldVisible(budget, {}, [source, own, budget]), false)
  assert.equal(setupFieldVisible(own, { [source.key]: 'infinidysk' }, [source, own, budget]), false)
  assert.equal(setupFieldVisible(budget, { [source.key]: 'infinidysk' }, [source, own, budget]), true)
  assert.equal(setupFieldValue(budget), 5)
  assert.equal(setupFieldValue(budget, { [budget.key]: 0 }), 0)
})

test('unknown preflight outcomes are neither passed nor definitive failures', () => {
  assert.equal(setupCheckLabel({ ok: null, critical: true }), 'Not verified')
  assert.equal(setupCheckLabel({ ok: false, critical: true }), 'Blocking issue')
  assert.equal(setupCheckLabel({ ok: false, critical: false }), 'Warning')
  assert.equal(setupCheckLabel({ ok: true, critical: true }), 'Passed')
})
test('browser storage rejection cannot turn an accepted backend run into a startup failure', async () => {
  globalThis.window = { localStorage: { getItem() { throw new Error('Storage unavailable') }, setItem() { throw new Error('Storage unavailable') } } }
  globalThis.__setupTestBackend = { processService: {
    planSetup: async () => ({ plan_id: 'plan-a' }),
    startSetupRun: async () => ({ run_id: 'run-a', status: 'running' }),
    getCapabilities: async () => ({ setup_arrangements: true }),
    getSetupRun: async () => ({ run_id: 'run-a', status: 'running' }),
    getLatestSetupRun: async () => ({ run_id: 'run-a', status: 'running' }),
  } }
  try {
    const store = useSetupArrangementsStore(createPinia())
    await store.preview({})
    await store.start({})
    await store.refresh()
    assert.equal(store.run.run_id, 'run-a')
    assert.equal(store.error, '')
  } finally { delete globalThis.window; delete globalThis.__setupTestBackend }
})

test('library choices follow the advertised server contract and do not invent Audiobookshelf language settings', () => {
  assert.deepEqual(setupLibraryOptions({ key: 'audiobookshelf::libraries' }).map(option => option.value), ['book', 'podcast'])
  assert.equal(setupLibrarySupportsLanguage({ key: 'audiobookshelf::libraries' }), false)
  assert.deepEqual(setupLibraryOptions({ service_key: 'plex' }).map(option => option.value), ['movie', 'show', 'music'])
  assert.deepEqual(setupLibraryOptions({ media_types: [{ value: 'podcast', label: 'Podcasts' }] }), [{ value: 'podcast', label: 'Podcasts' }])
})


test('guided external and none choices seed advertised consumers without replacing deliberate routing', () => {
  const fields = ['seerr.Requests', 'pulsarr', 'maintainerr', 'tautulli'].map(id => ({
    key: id + '::media_server', service_key: id.split('.')[0], type: 'connection',
    options: [{ value: 'external' }, { value: 'none' }],
  }))
  let seeded = guidedMediaChoices(fields, {}, { mediaServer: 'external' })
  assert.deepEqual(Object.values(seeded.values), ['external', 'external', 'external', 'external'])
  seeded.values['seerr.Requests::media_server'] = 'plex'
  seeded = guidedMediaChoices(fields, seeded.values, { mediaServer: 'none' }, seeded.defaults)
  assert.equal(seeded.values['seerr.Requests::media_server'], 'plex')
  assert.equal(seeded.values['pulsarr::media_server'], 'none')
  assert.deepEqual(guidedMediaChoices([{ ...fields[0], options: [] }], {}, { mediaServer: 'external' }).values, {})
})


test('retained action forms include conditional choices even when only the missing input is advertised', () => {
  const fields = [
    { key: 'provider::source', default: 'own' },
    { key: 'provider::accounts', visible_when: { key: 'provider::source', equals: 'own' } },
    { key: 'other::api_key', type: 'password' },
  ]
  const selected = setupActionFields({ missing_inputs: ['provider::accounts'] }, fields)
  assert.deepEqual(selected.map(field => field.key), ['provider::source', 'provider::accounts'])
  assert.equal(setupFieldVisible(selected[1], {}, selected), true)
})


test('connection tasks appear on their exact source and target service pages without leaking to sibling instances', () => {
  const link = { service_key: 'seerr', source: 'seerr.Requests', instance_key: 'Requests', target: 'sonarr.Series', target_instance_key: 'Series' }
  assert.equal(setupActionMatchesService(link, 'seerr', 'Requests'), true)
  assert.equal(setupActionMatchesService(link, 'seerr', 'Other'), false)
  assert.equal(setupActionMatchesService(link, 'sonarr', 'Series'), true)
  assert.equal(setupActionMatchesService(link, 'sonarr', 'sonarr.Series'), true)
  assert.equal(setupActionMatchesService(link, 'sonarr', '4K'), false)
  assert.equal(setupActionMatchesService({ ...link, service_key: 'pulsarr', source: 'pulsarr', instance_key: '' }, 'sonarr', '4K'), false)
  assert.equal(setupActionMatchesService({ service_key: 'sonarr', instance_key: 'Series' }, 'sonarr', '4K'), false)
  assert.equal(setupActionMatchesService({ ...link, target: { service_key: 'sonarr', id: 'sonarr.Series', instance_key: 'Series' } }, 'sonarr', 'Series'), true)
})


test('check and retry timing hides unavailable metadata and distinguishes attempts from verification', () => {
  const action = { checked_at: '2026-10-14T12:00:00+00:00', next_retry_at: '2026-10-14T12:01:00+00:00', attempts: 2, retryable: true }
  const timing = setupActionTiming(action)
  assert.equal(timing.checked.datetime, '2026-10-14T12:00:00.000Z')
  assert.equal(timing.retry.datetime, '2026-10-14T12:01:00.000Z')
  assert.equal(timing.attempts, 2)
  assert.equal(timing.checked.text.includes('2026-10-14T'), false)
  assert.deepEqual(setupActionTiming({ checked_at: 'invalid', next_retry_at: '', attempts: 0 }), { checked: null, retry: null, attempts: null })
  assert.equal(setupActionTiming(action, { cancel_requested: true }).retry, null)
  assert.equal(setupActionTiming(action, { status: 'abandoned' }).retry, null)
  assert.equal(setupActionTiming({ ...action, retry_exhausted: true }).retry, null)
})

test('scheduled result refresh follows active work and deadlines without overdue loops or cancelled timers', () => {
  const now = Date.parse('2026-10-14T12:00:00Z')
  const pending = { status: 'partial', next_retry_at: '2026-10-14T12:00:02Z' }
  assert.equal(setupRefreshDelay(pending, now), 2200)
  assert.equal(setupRefreshDelay({ ...pending, next_retry_at: '2026-10-14T12:00:00.100Z' }, now), 1000)
  assert.equal(setupRefreshDelay({ ...pending, next_retry_at: '2026-10-14T11:59:00Z' }, now), 5000)
  assert.equal(setupRefreshDelay({ ...pending, next_retry_at: '2026-10-14T13:00:00Z' }, now), 30000)
  assert.equal(setupRefreshDelay({ status: 'running' }, now), 3000)
  assert.equal(setupRefreshDelay({ ...pending, cancel_requested: true }, now), null)
  assert.equal(setupRefreshDelay({ ...pending, status: 'abandoned' }, now), null)
  assert.equal(setupRefreshDelay({ status: 'partial', next_retry_at: 'invalid' }, now), null)
  assert.equal(setupRefreshDelay({ status: 'waiting_input' }, now), null)
})
