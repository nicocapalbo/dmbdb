import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs'
import { createPinia } from 'pinia'
import { onboardingSteps, onboardingStepNumber } from '../helper/onboardingSteps.js'
import { safeSetupLink, setupActionMatchesService, setupCoverageText, sanitizeSetupPreview, editableSetupChoices, setupChoiceLines, setupFieldValue, setupFieldVisible, setupCheckLabel, setupLibraryOptions, setupLibrarySupportsLanguage, guidedMediaChoices, setupActionFields, setupActionTiming, setupRefreshDelay, setupDefaultValues, setupChangeValue, setupAdoptionKeys, setupPreviewNeedsConsent, setupErrorText, setupLookupRefreshDelay } from '../helper/setupArrangements.js'

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
    getSetupRun: async () => { calls.push('saved'); throw { response: { status: 404, data: { detail: 'The requested setup record was not found.' } } } },
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

test('capability outage remains unknown and a later retry recovers without losing a saved run', async () => {
  let fail = true
  globalThis.__setupTestBackend = { processService: {
    getCapabilities: async () => { if (fail) throw { response: { status: 503, data: { detail: '<secret proxy body>' } } }; return { setup_arrangements: true } },
    getLatestSetupRun: async () => ({ run_id: 'saved-run', status: 'partial' }),
  } }
  try {
    const store = useSetupArrangementsStore(createPinia())
    await store.refresh()
    assert.equal(store.supported, null)
    assert.equal(store.lookupState, 'unavailable')
    assert.match(store.error, /HTTP 503.*capabilities/)
    assert.doesNotMatch(store.error, /secret proxy/)
    fail = false
    await store.refresh()
    assert.equal(store.supported, true)
    assert.equal(store.lookupState, 'ready')
    assert.equal(store.run.run_id, 'saved-run')
    assert.equal(store.error, '')
  } finally { delete globalThis.__setupTestBackend }
})
test('only an authored empty-run 404 confirms absence; proxy 404 and 503 preserve remembered results', async () => {
  const saved = new Map([['dumb.setup.run', 'saved-run']])
  globalThis.window = { localStorage: { getItem: key => saved.get(key), setItem: (k, v) => saved.set(k, v), removeItem: k => saved.delete(k) } }
  let response = { status: 503, data: { detail: { code: 'setup_storage_unavailable', controller_uid: 0, configured_service_uid: 1000, message: 'secret-input' } } }
  globalThis.__setupTestBackend = { processService: {
    getCapabilities: async () => ({ setup_arrangements: true }),
    getSetupRun: async () => { throw { response } },
    getLatestSetupRun: async () => { throw { response } },
  } }
  try {
    const store = useSetupArrangementsStore(createPinia())
    store.rememberRun({ run_id: 'saved-run', status: 'partial' })
    await store.refresh()
    assert.equal(store.run.run_id, 'saved-run')
    assert.equal(saved.get('dumb.setup.run'), 'saved-run')
    assert.match(store.error, /Controller UID 0; configured service UID 1000/)
    assert.doesNotMatch(store.error, /secret-input/)
    response = { status: 404, data: { detail: 'Not Found' } }
    await store.refresh({ latest: true })
    assert.equal(store.run.run_id, 'saved-run')
    assert.equal(store.lookupState, 'unavailable')
    response = { status: 404, data: { detail: 'No setup run has been created.' } }
    await store.refresh({ latest: true })
    assert.equal(store.run, null)
    assert.equal(store.lookupState, 'empty')
    assert.equal(store.error, '')
    assert.equal(saved.has('dumb.setup.run'), false)
  } finally { delete globalThis.window; delete globalThis.__setupTestBackend }
})
test('late failed refresh cannot erase a newly accepted run', async () => {
  let rejectRead
  globalThis.__setupTestBackend = { processService: {
    getCapabilities: async () => ({ setup_arrangements: true }),
    getLatestSetupRun: () => new Promise((_resolve, reject) => { rejectRead = reject }),
  } }
  try {
    const store = useSetupArrangementsStore(createPinia())
    const request = store.refresh()
    while (!rejectRead) await new Promise(resolve => setImmediate(resolve))
    store.rememberRun({ run_id: 'new-run', status: 'running' })
    rejectRead({ response: { status: 404, data: { detail: 'No setup run has been created.' } } })
    await request
    assert.equal(store.run.run_id, 'new-run')
    assert.equal(store.error, '')
  } finally { delete globalThis.__setupTestBackend }
})
test('setup request diagnostics classify authorization, proxy, offline and timeout without raw request values', () => {
  const endpoint = '/api/process/setup/runs/latest'
  for (const status of [401, 403]) assert.match(setupErrorText({ response: { status, data: { detail: { code: 'setup_storage_unavailable' } } } }, '', endpoint), /Sign in again.*HTTP/)
  assert.match(setupErrorText({ response: { status: 502, data: { detail: 'private-input' } } }, '', endpoint), /proxy.*HTTP 502/)
  assert.match(setupErrorText({ code: 'ECONNABORTED', config: { url: endpoint + '?token=private-input' } }), /timed out.*request timeout/)
  assert.match(setupErrorText({ request: {}, config: { url: 'https://user:private-input@example.test' + endpoint + '?key=private-input' } }), /could not be reached/)
  assert.doesNotMatch(setupErrorText({ response: { status: 422, data: { detail: [{ input: 'private-input' }] } }, config: { data: { password: 'private-input' } } }, 'Review the request.', endpoint), /private-input/)
  assert.doesNotMatch(setupErrorText({ response: { status: 409, data: { detail: 'password=private-input' } } }, 'Review the request.', endpoint), /private-input/)
})
test('unavailable checklist polling backs off and stops after confirmed absence or unsupported capability', () => {
  assert.equal(setupLookupRefreshDelay({ supported: null, lookupState: 'unavailable', refreshFailures: 1 }), 5000)
  assert.equal(setupLookupRefreshDelay({ supported: true, lookupState: 'unavailable', refreshFailures: 3 }), 20000)
  assert.equal(setupLookupRefreshDelay({ lookupState: 'unavailable', refreshFailures: 20 }), 60000)
  assert.equal(setupLookupRefreshDelay({ lookupState: 'empty' }), null)
  assert.equal(setupLookupRefreshDelay({ supported: false, lookupState: 'unavailable' }), null)
})

test('only the authored installation-persistence conflicts suspend setup', async () => {
  const { setupInstallationHoldError, setupInstallationHoldReason, setupInstallationHoldText } = await import('../helper/setupArrangements.js')
  const detail = 'An installation backup, restore or recovery is controlling persistence. Use Backup and restore for status.'
  const legacy = 'Installation recovery owns persistence; use its status and recovery controls.'
  for (const message of [detail, legacy]) assert.equal(setupInstallationHoldError({ response: { status: 409, data: { detail: message } } }), true)
  for (const status of [401, 403, 404, 503]) assert.equal(setupInstallationHoldError({ response: { status, data: { detail } } }), false)
  assert.equal(setupInstallationHoldError({ response: { status: 409, data: { detail: 'A setup run is already active.' } } }), false)
  assert.equal(setupInstallationHoldError({ response: { status: 409, data: { detail: { message: detail } } } }), false)
  assert.equal(setupInstallationHoldReason({ preparation: { stage: 'checking_capacity' } }), '')
  assert.equal(setupInstallationHoldReason({ job: { job_type: 'installation_backup', status: 'running' } }), 'backup')
  assert.equal(setupInstallationHoldReason({ job: { job_type: 'installation_restore', status: 'running' } }), 'restore')
  assert.equal(setupInstallationHoldReason({ recoveryJob: { status: 'recovery_required' } }), 'recovery')
  assert.equal(setupInstallationHoldReason({ authorizationRejected: true, job: { job_type: 'installation_backup', status: 'running' } }), '')
  assert.match(setupInstallationHoldText('backup'), /paused.*backup runs.*retained/)
  assert.equal(setupLookupRefreshDelay({ lookupState: 'suspended', supported: true }), 15000)
})

test('installation hold preserves remembered setup and blocks actions until a successful refresh', async () => {
  const saved = new Map()
  globalThis.window = { localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) } }
  let held = true, mutations = 0
  const run = { run_id: 'retained-run', status: 'partial', values: { selection: 'retained' }, actions: [] }
  globalThis.__setupTestBackend = { processService: {
    getCapabilities: async () => ({ setup_arrangements: true }),
    getSetupRun: async () => { if (held) throw { response: { status: 409, data: { detail: 'Installation recovery owns persistence; use its status and recovery controls.' } } }; return run },
    retrySetupRun: async () => { mutations++; return run },
  } }
  try {
    const store = useSetupArrangementsStore(createPinia())
    store.rememberRun(run)
    await store.refresh()
    assert.equal(store.lookupState, 'suspended')
    assert.equal(store.installationHold, 'installation')
    assert.equal(store.error, '')
    assert.deepEqual(store.run, run)
    assert.equal(saved.get('dumb.setup.run'), run.run_id)
    assert.equal(await store.operate('retry'), null)
    assert.equal(mutations, 0)
    held = false
    await store.refresh()
    assert.equal(store.installationHold, '')
    assert.equal(store.lookupState, 'ready')
    assert.equal(store.error, '')
    await store.operate('retry')
    assert.equal(mutations, 1)
  } finally { delete globalThis.window; delete globalThis.__setupTestBackend }
})

test('a request started before the backup hold cannot replace the retained setup result', async () => {
  let resolveRead
  globalThis.__setupTestBackend = { processService: {
    getCapabilities: async () => ({ setup_arrangements: true }),
    getSetupRun: () => new Promise(resolve => { resolveRead = resolve }),
  } }
  try {
    const store = useSetupArrangementsStore(createPinia())
    store.rememberRun({ run_id: 'retained-run', status: 'partial' })
    const request = store.refresh()
    while (!resolveRead) await new Promise(resolve => setImmediate(resolve))
    store.suspendForInstallation('backup')
    resolveRead({ run_id: 'stale-replacement', status: 'complete' })
    await request
    assert.equal(store.run.run_id, 'retained-run')
    assert.equal(store.lookupState, 'suspended')
    assert.equal(store.installationHold, 'backup')
    assert.equal(store.loading, false)
  } finally { delete globalThis.__setupTestBackend }
})
