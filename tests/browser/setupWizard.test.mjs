import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium, firefox } from 'playwright'
import { createSetupWizardFixture } from '../support/setupWizardFixture.mjs'
let fixture
before(async () => { fixture = await createSetupWizardFixture() })
after(async () => { await fixture?.close() })

const actions = [
  { id: 'incoming-request-link', service_key: 'seerr', source: 'seerr.Requests', instance_key: 'Requests', target: 'sonarr.Series', target_instance_key: 'Series', label: 'Connect Seerr Requests to Sonarr Series', automation: 'unknown', required: true, execution: 'waiting_input', verification: 'unchecked', reason: 'Authorize the selected request connection.' },
  { id: 'arr-link', service_key: 'sonarr', instance_key: 'sonarr.Series', label: 'Connect InfiniDysk to Sonarr Series', automation: 'automatic', required: true, execution: 'applied', verification: 'unchecked', reason: 'Configuration saved; connection check remains.', retryable: true, ui_url: '/services/Sonarr%20Series' },
  { id: 'provider-input', service_key: 'infinidysk', label: 'Configure Usenet provider', automation: 'after_input', required: true, execution: 'waiting_input', verification: 'unchecked', missing_inputs: ['infinidysk::nntp'], instructions: ['Enter your NNTP server details, then apply and test the connection.'], retryable: true },
  { id: 'plex-library', service_key: 'plex', label: 'Review media libraries', automation: 'manual', required: true, execution: 'pending', verification: 'unchecked', instructions: ['Open Plex and confirm that the selected paths contain the expected media.'], ui_url: 'javascript:alert(1)', docs_url: 'https://example.test/plex' },
  { id: 'unknown-contract', service_key: 'seerr', input_fields: ['seerr::media'], label: 'Review unrecognized application contract', automation: 'unknown', required: true, execution: 'waiting_input', verification: 'unavailable', reason: 'The installed vendor interface is not recognized. Complete this connection manually.' },
  { id: 'unsupported-contract', service_key: 'maintainerr', label: 'Configure unsupported application interface', automation: 'unsupported', required: true, execution: 'waiting_input', verification: 'unavailable', reason: 'This installed version does not expose a supported connection API.' },
]
const schema = { fields: [
  { key: 'prowlarr::arrs', label: 'Connect Arr instances', type: 'multiselect', options: [{ value: 'sonarr.Series', label: 'Sonarr Series' }, { value: 'radarr.Movies', label: 'Radarr Movies' }] },
  { key: 'infinidysk::nntp_source', label: 'InfiniDysk account source', type: 'select', default: 'own', options: [{ value: 'own', label: 'Own accounts' }] },
  { key: 'infinidysk::nntp', label: 'Usenet providers', type: 'nntp_providers', required: true, visible_when: { key: 'infinidysk::nntp_source', equals: 'own' } },
  { key: 'decypharr::nntp_source', label: 'Decypharr account source', type: 'select', default: 'own', options: [{ value: 'own', label: 'Own accounts' }, { value: 'infinidysk', label: 'Reuse accounts from InfiniDysk' }] },
  { key: 'decypharr::nntp', label: 'Decypharr provider accounts', type: 'nntp_providers', visible_when: { key: 'decypharr::nntp_source', equals: 'own' } },
  { key: 'decypharr::nntp_connections', label: 'Decypharr connection budget', type: 'number', default: 5, visible_when: { key: 'decypharr::nntp_source', not_equals: 'own' } },
  { key: 'plex::libraries', label: 'Media libraries', type: 'libraries' },
  { key: 'seerr::media', label: 'Media server', type: 'select', options: [{ value: 'none', label: 'No media server' }, { value: 'external', label: 'External media server' }] },
  { key: 'seerr::external', label: 'External media server connection', type: 'external_service', visible_when: { key: 'seerr::media', equals: 'external' } },
] }
const makeInput = (capabilities = { setup_arrangements: true, optional_only_onboarding: true }) => ({
  capabilities,
  coreCatalog: [{ key: 'sonarr', name: 'Sonarr', supports_instances: true, description: 'TV library automation.', dependencies: ['postgres'], service_options: {}, debrid_providers: [] }],
  coreServices: [{ name: 'sonarr', instance_name: 'Series' }],
  plan: { plan_id: 'plan-one', actions, services: [{ id: 'sonarr.Series', name: 'Sonarr Series', role: 'Library automation', selected: true }, { id: 'postgres', name: 'PostgreSQL', required: true }], arrangement_schema: structuredClone(schema), checks: [{ key: 'storage', label: 'Storage namespace', ok: null, critical: true, detail: 'Remote storage access remains unverified; no media was enumerated.' }], coverage: { automation: { count: 1, total: 3 }, applied: { count: 1, total: 3 }, verified: { count: 0, total: 3 } } },
  run: { run_id: 'run-one', plan_id: 'plan-one', status: 'waiting_input', actions, arrangement_schema: structuredClone(schema), services: [{ id: 'sonarr.Series', service_key: 'sonarr', instance_key: 'sonarr.Series', process_name: 'Sonarr Series' }, { id: 'sonarr.4K', service_key: 'sonarr', instance_key: '4K', process_name: 'Sonarr 4K' }] },
})
async function open(browserType, input) {
  const browser = await browserType.launch()
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  await page.addInitScript(input => { window.__setupWizardInput = input }, input)
  await page.goto(fixture.origin)
  await page.waitForFunction(() => window.setupWizard)
  return { browser, page, errors }
}
const snapshot = page => page.evaluate(() => window.setupWizard.snapshot())

const nativeInput = (installed = false) => {
  const input = makeInput({ api_version: '2.24.0', setup_arrangements: true, optional_only_onboarding: true, setup_infinidysk_runtime_choices: true, setup_infinidysk_runtime_protocol: 1, infinidysk_v2: true, infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1 })
  input.coreServices = [{ name: 'infinidysk' }]
  input.coreCatalog = [{ key: 'infinidysk', name: 'InfiniDysk', dependencies: ['rclone'], service_options: { infinidysk: { process_name: 'InfiniDysk' }, rclone: { mount_path: '/mnt/debrid/example' } }, debrid_providers: [] }]
  input.nativeRuntime = { runtime_generation: installed ? '2' : '1', mount_backend: installed ? 'fuse' : 'rclone', mode: 'fresh' }
  input.plan.arrangement_schema = { fields: [
    { key: 'infinidysk::runtime_generation', label: 'InfiniDysk runtime generation', type: 'select', default: installed ? '2' : '1', readonly: installed, refresh_on_change: true, options: [{ value: '1', label: 'InfiniDysk 1 (default)' }, { value: '2', label: 'InfiniDysk 2 through guarded wizard' }] },
    { key: 'infinidysk::mount_backend', label: 'InfiniDysk mount transport', type: 'select', default: installed ? 'fuse' : 'rclone', readonly: installed, refresh_on_change: true, visible_when: { key: 'infinidysk::runtime_generation', equals: '2' }, options: [{ value: 'rclone', label: 'Historical rclone over WebDAV (default)' }, { value: 'fuse', label: 'Native FUSE' }] },
  ] }
  return input
}

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(name + ': native setup hands admitted FUSE choices to the guarded wizard without starting services', { timeout: 90000 }, async () => {
    const input = nativeInput()
    const { browser, page, errors } = await open(browserType, input)
    const calls = []
    let nativeSetupSupported = false
    try {
      await page.route('**/api/process/**', async route => {
        const request = route.request(), pathname = new URL(request.url()).pathname
        const body = request.postDataJSON()
        calls.push({ pathname, method: request.method(), body })
        const response = pathname.endsWith('/capabilities') ? { ...input.capabilities, setup_infinidysk_runtime_choices: nativeSetupSupported }
          : pathname.endsWith('/status') ? { protocol: 1, runtime_generation: '1', mode: 'fresh', current: { mount_backend: 'rclone', mount_path: '/mnt/debrid/example' }, supported_mount_backends: ['rclone', 'fuse'], eligibility: { ready: true }, job: null }
          : { protocol: 1, ready: true, preview_token: 'fixture-private-preview', plan_fingerprint: 'fixture-plan', confirmation_text: 'INSTALL INFINIDYSK V2', expires_at: Math.floor(Date.now() / 1000) + 300, current: { mount_path: '/mnt/debrid/example' }, target: { mount_backend: body?.mount_backend, mount_path: '/mnt/debrid/example' }, required_acknowledgements: ['backup', 'downtime', 'beta', 'oidc_policy', 'downstream'], rehearsal_required: false }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
      })
      await page.evaluate(() => window.setupWizard.jump('arrangement'))
      await page.getByLabel('InfiniDysk runtime generation', { exact: true }).waitFor()
      assert.equal(await page.getByLabel('InfiniDysk runtime generation', { exact: true }).inputValue(), '1')
      await page.getByLabel('InfiniDysk runtime generation', { exact: true }).selectOption('2')
      await page.getByLabel('InfiniDysk mount transport', { exact: true }).selectOption('fuse')
      const handoff = page.locator('[data-setup-native-transition]')
      await handoff.getByRole('button', { name: 'Open guarded InfiniDysk 2 wizard', exact: true }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-setup-native-transition] button')?.disabled === false)
      assert.equal((await snapshot(page)).step.id, 'arrangement')
      assert.equal('rclone' in (await snapshot(page)).payload.core_services[0].service_options, false)
      await handoff.getByRole('button', { name: 'Open guarded InfiniDysk 2 wizard', exact: true }).click()
      await handoff.getByRole('alert').waitFor()
      assert.equal(await page.getByTestId('v2-panel').count(), 0)
      nativeSetupSupported = true
      await handoff.getByRole('button', { name: 'Open guarded InfiniDysk 2 wizard', exact: true }).click()
      await page.getByTestId('v2-panel').waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="v2-panel"] input[value="fuse"]')?.checked === true)
      assert.equal(await page.getByTestId('v2-start').count(), 0)
      assert.equal(await handoff.getByRole('button').isDisabled(), true)
      await page.getByTestId('v2-preview').click()
      await page.getByTestId('v2-review').waitFor()
      assert.equal(calls.find(call => call.pathname.endsWith('/preview')).body.mount_backend, 'fuse')
      assert.equal(await page.getByTestId('v2-start').isDisabled(), true)
      assert.equal(calls.some(call => call.pathname.endsWith('/start')), false)
      await page.getByRole('button', { name: 'Close InfiniDysk 2 migration', exact: true }).click()
      await page.evaluate(() => window.setupWizard.setNativeJob({ job_id: 'existing-native-job', status: 'running', mode: 'migrate' }))
      assert.equal(await handoff.getByRole('button').isDisabled(), true)
      assert.equal((await snapshot(page)).native.majorJob.job_id, 'existing-native-job')
      await page.evaluate(() => window.setupWizard.jump('review'))
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Start services', exact: true }).isDisabled(), true)
      assert.equal((await snapshot(page)).requests.some(call => ['start', 'legacy-start'].includes(call.method)), false)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': existing native topology is locked and older capability sets hide runtime choices', { timeout: 90000 }, async () => {
    const input = nativeInput(true)
    input.arrangementValues = { 'infinidysk::runtime_generation': '1', 'infinidysk::mount_backend': 'rclone' }
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.evaluate(() => window.setupWizard.jump('arrangement'))
      const generation = page.getByLabel('InfiniDysk runtime generation', { exact: true })
      await generation.waitFor()
      assert.equal(await generation.isDisabled(), true)
      assert.equal(await generation.inputValue(), '2')
      assert.equal(await page.getByLabel('InfiniDysk mount transport', { exact: true }).inputValue(), 'fuse')
      assert.equal(await page.getByLabel('InfiniDysk mount transport', { exact: true }).isDisabled(), true)
      assert.equal(await page.locator('[data-setup-native-transition]').count(), 0)
      assert.equal('rclone' in (await snapshot(page)).payload.core_services[0].service_options, false)
      await page.close()
      const old = await browser.newPage()
      const oldInput = nativeInput()
      oldInput.capabilities.setup_infinidysk_runtime_choices = false
      await old.addInitScript(input => { window.__setupWizardInput = input }, oldInput)
      await old.goto(fixture.origin); await old.waitForFunction(() => window.setupWizard)
      await old.evaluate(() => window.setupWizard.jump('arrangement'))
      await old.getByRole('heading', { name: 'Connections and choices' }).waitFor()
      assert.equal(await old.getByLabel('InfiniDysk runtime generation', { exact: true }).count(), 0)
      assert.equal(await old.locator('[data-setup-native-transition]').count(), 0)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': actual wizard reviews optionless selections, retains incomplete setup, and resumes after reload', { timeout: 90000 }, async () => {
    const { browser, page, errors } = await open(browserType, makeInput())
    try {
      assert.equal(await page.getByRole('button', { name: 'Start services', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Preflight Checks' }).waitFor()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Companion services', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Connections and choices' }).waitFor()
      await page.getByLabel('Connect Arr instances', { exact: true }).selectOption(['sonarr.Series', 'radarr.Movies'])
      assert.equal(await page.getByLabel('Connect Arr instances', { exact: true }).locator('option:checked').count(), 2)
      await page.getByRole('button', { name: 'Choose no connections', exact: true }).click()
      assert.equal(await page.getByLabel('Connect Arr instances', { exact: true }).locator('option:checked').count(), 0)
      await page.getByLabel('Connect Arr instances', { exact: true }).selectOption(['sonarr.Series'])
      assert.equal(await page.getByRole('button', { name: 'Add provider', exact: true }).count(), 2)
      assert.equal(await page.getByLabel('Decypharr connection budget', { exact: true }).count(), 0)
      await page.getByLabel('Decypharr account source', { exact: true }).selectOption('infinidysk')
      assert.equal(await page.getByRole('button', { name: 'Add provider', exact: true }).count(), 1)
      await page.getByLabel('Decypharr connection budget', { exact: true }).fill('5')
      await page.getByRole('button', { name: 'Add provider', exact: true }).click()
      await page.getByLabel('Server hostname', { exact: true }).fill('news.example.test')
      await page.getByLabel('Password', { exact: true }).fill('private-provider-value')
      await page.getByLabel('Connections', { exact: true }).fill('5')
      await page.getByLabel('Account connection limit (shared across clients)', { exact: true }).fill('10')
      await page.getByRole('button', { name: 'Add library', exact: true }).click()
      await page.getByLabel('Library name', { exact: true }).fill('Movies')
      await page.getByLabel('Library paths, one per line', { exact: true }).fill('/media/movies\n/media/classics')
      assert.equal(await page.getByLabel('API key', { exact: true }).count(), 0)
      await page.getByLabel('Media server', { exact: true }).selectOption('external')
      await page.getByLabel('Service type', { exact: true }).selectOption('jellyfin')
      await page.getByLabel('Allow this authorized private network endpoint', { exact: true }).check()
      await page.getByLabel('API key', { exact: true }).fill('private-external-value')
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      await page.getByRole('button', { name: 'Start services', exact: true }).waitFor()
      const advanced = page.locator('details').filter({ has: page.getByText('Advanced configuration payload', { exact: true }) })
      assert.equal(await advanced.getAttribute('open'), null)
      await advanced.locator('summary').click()
      assert.equal(await advanced.locator('pre').isVisible(), true)
      await advanced.locator('summary').click()
      await page.waitForFunction(() => !document.querySelector('button.bg-green-700')?.disabled)
      assert.match(await page.locator('body').innerText(), /Storage namespace · Not verified/)
      assert.match(await page.locator('body').innerText(), /Chosen by you/)
      assert.match(await page.locator('body').innerText(), /Required dependency/)
      assert.match(await page.locator('body').innerText(), /Manual configuration/)
      assert.match(await page.locator('[data-setup-choices]').innerText(), /news.example.test/)
      assert.match(await page.locator('[data-setup-choices]').innerText(), /Create only if missing/)
      assert.equal((await page.locator('body').innerText()).includes('private-provider-value'), false)
      assert.equal((await page.locator('body').innerText()).includes('private-external-value'), false)
      const before = await snapshot(page)
      assert.equal(before.step.id, 'review')
      const plans = before.requests.filter(request => request.method === 'plan')
      const values = plans.at(-1).payload.arrangement.values
      assert.equal(values['infinidysk::nntp'][0].password, 'private-provider-value')
      assert.deepEqual(values['plex::libraries'][0].paths, ['/media/movies', '/media/classics'])
      assert.equal(values['seerr::media'], 'external')
      assert.equal(values['seerr::external'].service_key, 'jellyfin')
      assert.equal(values['seerr::external'].allow_private, true)
      assert.deepEqual(values['prowlarr::arrs'], ['sonarr.Series'])
      assert.equal(values['decypharr::nntp_source'], 'infinidysk')
      assert.equal(values['decypharr::nntp_connections'], 5)
      assert.equal(values['infinidysk::nntp'][0].account_connection_limit, 10)
      assert.equal('decypharr::nntp' in values, false)
      assert.match(await page.locator('[data-setup-choices]').innerText(), /Reuse accounts from InfiniDysk/)
      await page.getByRole('button', { name: 'Start services', exact: true }).click()
      await page.locator('[data-setup-status]').waitFor()
      assert.equal((await snapshot(page)).step.id, 'progress')
      assert.match(await page.locator('[data-setup-status]').innerText(), /Needs your input/)
      assert.match(await page.locator('[data-setup-action="arr-link"]').innerText(), /Verification: Not checked/)
      assert.equal(await page.locator('[data-setup-action="plex-library"] a').count(), 1)
      assert.equal((await snapshot(page)).requests.filter(request => request.method === 'complete').length, 0)
      assert.deepEqual((await snapshot(page)).storage, { 'dumb.setup.run': 'run-one' })
      assert.equal(await page.getByRole('button', { name: 'Start services', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Retry this action', exact: true }).first().click()
      const actionRequest = (await snapshot(page)).requests.find(request => request.method === 'action')
      assert.equal(actionRequest.payload.action, 'arr-link')
      assert.equal(actionRequest.payload.values.operation, 'apply')
      await page.locator('[data-setup-action="plex-library"]').getByRole('button', { name: 'I completed this manually', exact: true }).click()
      const confirmed = (await snapshot(page)).requests.filter(request => request.method === 'action').at(-1)
      assert.equal(confirmed.payload.values.operation, 'confirm')
      assert.match(await page.locator('[data-setup-action="plex-library"]').innerText(), /Verification: Not checked/)
      const providerTask = page.locator('[data-setup-action="provider-input"]')
      await providerTask.getByText('Configure this step', { exact: true }).click()
      await providerTask.getByRole('button', { name: 'Add provider', exact: true }).click()
      await providerTask.getByLabel('Password', { exact: true }).fill('private-retained-draft')
      for (const actionId of ['unknown-contract', 'unsupported-contract']) {
        const action = page.locator('[data-setup-action="' + actionId + '"]')
        assert.equal(await action.isVisible(), true)
        if (actionId === 'unknown-contract') {
          await action.getByText('Configure this step', { exact: true }).click()
          await action.getByLabel('Media server', { exact: true }).selectOption('none')
          await action.getByRole('button', { name: 'Apply configuration', exact: true }).click()
          const applied = (await snapshot(page)).requests.filter(request => request.method === 'action').at(-1)
          assert.equal(applied.payload.action, actionId)
          assert.equal(applied.payload.values.operation, 'apply')
          assert.deepEqual(applied.payload.values.values, { 'seerr::media': 'none' })
          assert.equal(await providerTask.getByLabel('Password', { exact: true }).inputValue(), 'private-retained-draft')
        }
        await action.getByRole('button', { name: 'I completed this manually', exact: true }).click()
        assert.match(await action.innerText(), /Verification: No automatic check/)
        const request = (await snapshot(page)).requests.filter(request => request.method === 'action').at(-1)
        assert.equal(request.payload.action, actionId)
        assert.equal(request.payload.values.operation, 'confirm')
      }
      await page.goto(fixture.origin + '/#status')
      await page.locator('[data-setup-status]').waitFor()
      assert.match(await page.locator('body').innerText(), /Review media libraries/)
      assert.equal((await snapshot(page)).requests.some(request => request.method === 'get' && request.payload === 'run-one'), true)
      await page.goto(fixture.origin + '/service-checklist#service:Sonarr%20Series')
      await page.locator('[data-setup-action="arr-link"]').waitFor()
      assert.equal(await page.locator('[data-setup-action]').count(), 2)
      await page.locator('[data-setup-action="incoming-request-link"]').waitFor()
      await page.goto(fixture.origin + '/service-checklist-4k#service:Sonarr%204K')
      await page.locator('[data-setup-status]').waitFor()
      assert.equal(await page.locator('[data-setup-action]').count(), 0)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': optional-only setup keeps the UI-access step aligned and leaving is deliberate', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.coreServices = []
    input.optionalServices = ['tautulli']
    input.optionalCatalog = [{ key: 'tautulli', name: 'Tautulli', description: 'Plex monitoring.', service_options: {} }]
    input.requireServiceUi = true
    input.plan.arrangement_schema = { fields: [] }
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Preflight Checks' }).waitFor()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Companion services', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Connections and choices' }).waitFor()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Embedded Service iFrames' }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Start services', exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      await page.getByRole('button', { name: 'Start services', exact: true }).click()
      await page.locator('[data-setup-status]').waitFor()
      await page.getByRole('button', { name: 'Continue to dashboard', exact: true }).click()
      await page.waitForFunction(() => window.__setupNavigation === '/')
      const current = await snapshot(page)
      assert.equal(current.requests.filter(request => request.method === 'complete').length, 1)
      assert.equal(current.run.status, 'waiting_input')
      assert.deepEqual(current.storage, { 'dumb.setup.run': 'run-one' })
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': unknown storage remains advisory while a confirmed critical failure blocks start', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.plan.checks.push({ key: 'port', label: 'Port assignment', ok: false, critical: true, detail: 'Resolve the selected port conflict.' })
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.evaluate(() => setupWizard.jump('review'))
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      await page.getByText('Storage namespace · Not verified', { exact: true }).waitFor()
      await page.getByText('Port assignment · Blocking issue', { exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Start services', exact: true }).isDisabled(), true)
      assert.equal((await snapshot(page)).requests.some(request => request.method === 'start'), false)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': Audiobookshelf libraries use book/podcast types and omit unsupported metadata language', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.plan.arrangement_schema.fields = [{ key: 'audiobookshelf::libraries', service_key: 'audiobookshelf', resource_id: 'audiobookshelf', label: 'Audiobookshelf libraries', type: 'libraries', default_media_type: 'book', media_types: [{ value: 'book', label: 'Audiobooks' }, { value: 'podcast', label: 'Podcasts' }], supports_language: false }]
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.evaluate(() => setupWizard.jump('arrangement'))
      await page.getByRole('heading', { name: 'Connections and choices' }).waitFor()
      await page.getByRole('button', { name: 'Add library', exact: true }).click()
      assert.equal(await page.getByLabel('Media type', { exact: true }).inputValue(), 'book')
      assert.deepEqual(await page.getByLabel('Media type', { exact: true }).locator('option').evaluateAll(options => options.map(option => option.value)), ['book', 'podcast'])
      assert.equal(await page.getByLabel('Language', { exact: true }).count(), 0)
      assert.equal(await page.getByLabel('Scan this new library after creation', { exact: true }).count(), 0)
      await page.getByLabel('Library name', { exact: true }).fill('Audiobooks')
      await page.getByLabel('Library paths, one per line', { exact: true }).fill('/audiobooks')
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      await page.locator('[data-setup-choices]').waitFor()
      const plans = (await snapshot(page)).requests.filter(request => request.method === 'plan')
      const library = plans.at(-1).payload.arrangement.values['audiobookshelf::libraries'][0]
      assert.equal(library.media_type, 'book')
      assert.equal('language' in library, false)
      assert.equal('scan_on_create' in library, false)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': supported new-library scans require a deliberate choice and appear in review', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.plan.arrangement_schema.fields = [{ key: 'jellyfin::libraries', service_key: 'jellyfin', resource_id: 'jellyfin', label: 'Jellyfin libraries', type: 'libraries', supports_scan_on_create: true }]
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.evaluate(() => setupWizard.jump('arrangement'))
      await page.getByRole('button', { name: 'Add library', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Add library', exact: true }).click()
      const consent = page.getByLabel('Scan this new library after creation', { exact: true })
      assert.equal(await consent.isChecked(), false)
      await page.getByLabel('Create this library only when missing', { exact: true }).uncheck()
      assert.equal(await consent.count(), 0)
      await page.getByLabel('Create this library only when missing', { exact: true }).check()
      assert.equal(await consent.isChecked(), false)
      await page.getByLabel('Library name', { exact: true }).fill('New movies')
      await page.getByLabel('Library paths, one per line', { exact: true }).fill('/media/movies')
      await consent.check()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      await page.getByText(/Scan after creating this library/).waitFor()
      const plans = (await snapshot(page)).requests.filter(request => request.method === 'plan')
      assert.equal(plans.at(-1).payload.arrangement.values['jellyfin::libraries'][0].scan_on_create, true)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': guided external and none selections remain distinct through advertised connection forms', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.coreServices = []
    input.coreCatalog = ['sonarr', 'radarr', 'seerr', 'plex', 'jellyfin', 'emby'].map(key => ({
      key, name: key, supports_instances: ['sonarr', 'radarr', 'seerr'].includes(key),
      service_options: {}, debrid_providers: [], dependencies: [],
    }))
    input.optionalServices = ['pulsarr', 'maintainerr', 'tautulli']
    input.optionalCatalog = input.optionalServices.map(key => ({ key, name: key, service_options: {} }))
    input.plan.arrangement_schema.fields = ['seerr.Requests', ...input.optionalServices].flatMap(id => [{
      key: id + '::media_server', resource_id: id, service_key: id.split('.')[0],
      label: id + ' connection', type: 'connection',
      options: [{ value: 'external', label: 'Connect an external server' }, { value: 'none', label: 'No media server' }],
    }, {
      key: id + '::external_media', resource_id: id, service_key: id.split('.')[0],
      label: id + ' external media', type: 'external_service',
      visible_when: { key: id + '::media_server', equals: 'external' },
    }])
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.getByRole('radio', { name: 'External server', exact: true }).check()
      await page.getByRole('button', { name: 'Apply recommendations', exact: true }).click()
      await page.waitForFunction(() => setupWizard.snapshot().payload.core_services.some(service => service.name === 'seerr'))
      assert.equal((await snapshot(page)).payload.core_services.some(service => ['plex', 'jellyfin', 'emby'].includes(service.name)), false)
      assert.equal((await snapshot(page)).payload.core_services.every(service => typeof service.name === 'string'), true)
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Preflight Checks' }).waitFor()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Companion services', exact: true }).waitFor()
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Connections and choices' }).waitFor()
      for (const id of ['seerr.Requests', ...input.optionalServices]) {
        await page.waitForFunction(key => Array.from(document.querySelectorAll('select')).some(select => select.id.endsWith(key) && select.value === 'external'), id + '::media_server')
        assert.equal(await page.getByLabel(id + ' connection', { exact: true }).inputValue(), 'external')
      }
      assert.equal(await page.getByLabel('Service type', { exact: true }).count(), 4)
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      const external = (await snapshot(page)).requests.filter(request => request.method === 'plan').at(-1).payload
      assert.equal(external.arrangement.intent.mediaServer, 'external')
      assert.equal(external.arrangement.values['seerr.Requests::media_server'], 'external')
      await page.evaluate(() => setupWizard.jump('services'))
      await page.getByRole('radio', { name: 'No media server', exact: true }).check()
      await page.getByRole('button', { name: 'Apply recommendations', exact: true }).click()
      await page.evaluate(() => setupWizard.jump('arrangement'))
      await page.getByRole('heading', { name: 'Connections and choices' }).waitFor()
      await page.waitForFunction(() => setupWizard.snapshot().requests.filter(request => request.method === 'plan').at(-1)?.payload.arrangement.values['seerr.Requests::media_server'] === 'none')
      for (const id of ['seerr.Requests', ...input.optionalServices]) assert.equal(await page.getByLabel(id + ' connection', { exact: true }).inputValue(), 'none')
      assert.equal(await page.getByLabel('Service type', { exact: true }).count(), 0)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': Plex options mask credentials and defer fresh claims to the retained account task', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.coreCatalog = [{ key: 'plex', name: 'Plex', service_options: { plex: { plex_claim: '' } }, service_option_descriptions: { plex: {} }, debrid_providers: [] }]
    input.coreServices = [{ name: 'plex' }]
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.evaluate(() => setupWizard.jump('options:plex'))
      await page.getByText('Plex account authorization is a retained setup task after the server is ready.', { exact: false }).waitFor()
      const token = page.getByPlaceholder('Enter Plex token', { exact: true })
      assert.equal(await token.getAttribute('type'), 'password')
      assert.equal(await token.getAttribute('autocomplete'), 'off')
      assert.equal(await page.locator('input[title="plex_claim"]').count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Next', exact: true }).isDisabled(), false)
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Connections and choices' }).waitFor()
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': retained check times and scheduled retries refresh results without overdue loops or cancelled timers', { timeout: 90000 }, async () => {
    const input = makeInput()
    const checked = new Date(Date.now() - 60000).toISOString()
    const overdue = new Date(Date.now() - 10000).toISOString()
    input.run.status = 'partial'
    input.run.next_retry_at = overdue
    input.run.actions = [
      { ...actions.find(action => action.id === 'provider-input'), checked_at: checked, next_retry_at: overdue, attempts: 2, retryable: true },
      { ...actions.find(action => action.id === 'plex-library'), checked_at: 'invalid', next_retry_at: '', attempts: 0 },
    ]
    const { browser, page, errors } = await open(browserType, input)
    const reads = async () => (await snapshot(page)).requests.filter(request => ['get', 'latest'].includes(request.method)).length
    try {
      await page.goto(fixture.origin + '/timed-checklist#status')
      await page.locator('[data-setup-status]').waitFor()
      const task = page.locator('[data-setup-action="provider-input"]')
      await task.getByText('2 attempts', { exact: true }).waitFor()
      assert.equal(await task.locator('time').count(), 2)
      assert.equal(await task.locator('time').first().getAttribute('datetime'), checked)
      assert.match(await task.innerText(), /Last checked:.*Next automatic retry:/s)
      assert.equal((await task.locator('time').first().innerText()).includes(checked), false)
      const manual = page.locator('[data-setup-action="plex-library"]')
      assert.equal(await manual.locator('time').count(), 0)
      assert.equal(await manual.getByLabel('Check and retry history', { exact: true }).count(), 0)
      assert.equal(await reads(), 1)
      await page.waitForTimeout(300)
      assert.equal(await reads(), 1)
      await page.evaluate(() => {
        const due = new Date(Date.now() + 1100).toISOString()
        window.__setupWizardInput.run.next_retry_at = due
        window.__setupWizardInput.run.actions[0].next_retry_at = due
      })
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await page.waitForFunction(() => setupWizard.snapshot().requests.filter(request => ['get', 'latest'].includes(request.method)).length >= 3, null, { timeout: 6000 })
      await page.evaluate(() => {
        window.__setupWizardInput.run.next_retry_at = new Date(Date.now() + 1100).toISOString()
      })
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      await page.evaluate(() => { window.__setupWizardInput.run.cancel_requested = true })
      await page.getByRole('button', { name: 'Refresh', exact: true }).click()
      const cancelledReads = await reads()
      await page.waitForTimeout(1500)
      assert.equal(await reads(), cancelledReads)
      assert.equal((await task.innerText()).includes('Next automatic retry'), false)
      assert.equal((await snapshot(page)).requests.some(request => ['action', 'retry', 'start'].includes(request.method)), false)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': older backend uses honest results and does not strip instance selection after 422', { timeout: 90000 }, async () => {
    const input = makeInput({ optional_only_onboarding: true })
    input.rejectLegacy = true
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.evaluate(() => window.setupWizard.jump('review'))
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      await page.getByRole('button', { name: 'Start services', exact: true }).click()
      await page.getByRole('heading', { name: 'Something went wrong' }).waitFor()
      const current = await snapshot(page)
      const starts = current.requests.filter(request => request.method === 'legacy-start')
      assert.equal(starts.length, 1)
      assert.equal(starts[0].payload.core_services[0].instance_name, 'Series')
      assert.equal(current.requests.some(request => ['plan', 'start', 'complete'].includes(request.method)), false)
      assert.equal((await page.locator('body').innerText()).includes('private-input'), false)
      assert.equal(await page.getByRole('button', { name: 'Continue to dashboard' }).count(), 1)
      await page.evaluate(() => {
        window.__setupWizardInput.rejectLegacy = false
        window.setupWizard.jump('review')
      })
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      await page.getByRole('button', { name: 'Start services', exact: true }).click()
      await page.getByRole('heading', { name: 'Startup request finished' }).waitFor()
      assert.match(await page.locator('body').innerText(), /does not provide a persistent setup checklist/)
      assert.equal(await page.getByRole('link', { name: 'Onboarding and service configuration guidance' }).getAttribute('href'), 'https://dumbarr.com/frontend/onboarding/')
      assert.equal((await snapshot(page)).requests.filter(request => request.method === 'complete').length, 0)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': nested advertised registries and policies retain typed rows and mask every secret', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.plan.arrangement_schema.fields = [{
      key: 'setup::external_arrs', resource_id: 'setup', label: 'External Arr services', type: 'list', item_label: 'External Arr',
      item_fields: [
        { key: 'id', label: 'Reference ID', type: 'string' },
        { key: 'service_key', label: 'Arr type', type: 'select', default: 'sonarr', options: [{ value: 'sonarr', label: 'Sonarr' }, { value: 'radarr', label: 'Radarr' }] },
        { key: 'url', label: 'Arr URL', type: 'url' },
        { key: 'api_key', label: 'Arr API key', type: 'password', default: 'never-copy-schema-secret' },
        { key: 'verify_tls', label: 'Verify Arr TLS', type: 'boolean', default: true },
        { key: 'authorize_changes', label: 'Authorize external changes', type: 'boolean', default: false },
        { key: 'policy', label: 'External policy', type: 'object', fields: [
          { key: 'priority', label: 'Policy priority', type: 'number', default: 25 },
          { key: 'enabled', label: 'Enable policy', type: 'boolean', default: false },
          { key: 'description', label: 'Policy note', type: 'string', visible_when: { key: 'enabled', equals: true } },
        ] },
      ],
    }]
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.evaluate(() => setupWizard.jump('arrangement'))
      await page.getByRole('button', { name: 'Add External Arr', exact: true }).click()
      assert.equal(await page.getByLabel('Arr type', { exact: true }).inputValue(), 'sonarr')
      assert.equal(await page.getByLabel('Verify Arr TLS', { exact: true }).isChecked(), true)
      assert.equal(await page.getByLabel('Authorize external changes', { exact: true }).isChecked(), false)
      assert.equal(await page.getByLabel('Arr API key', { exact: true }).inputValue(), '')
      assert.equal(await page.getByLabel('Arr API key', { exact: true }).getAttribute('type'), 'password')
      assert.equal(await page.getByLabel('Policy note', { exact: true }).count(), 0)
      await page.getByLabel('Reference ID', { exact: true }).fill('series')
      await page.getByLabel('Arr URL', { exact: true }).fill('https://arr.example.test')
      await page.getByLabel('Arr API key', { exact: true }).fill('private-registry-secret')
      await page.getByLabel('Policy priority', { exact: true }).fill('10')
      await page.getByLabel('Enable policy', { exact: true }).check()
      await page.getByLabel('Policy note', { exact: true }).fill('Chosen explicitly')
      await page.getByRole('button', { name: 'Next', exact: true }).click()
      await page.getByRole('heading', { name: 'Review Configuration' }).waitFor()
      const payload = (await snapshot(page)).requests.filter(request => request.method === 'plan').at(-1).payload
      const row = payload.arrangement.values['setup::external_arrs'][0]
      assert.deepEqual(row.policy, { priority: 10, enabled: true, description: 'Chosen explicitly' })
      assert.equal(row.verify_tls, true)
      assert.equal(row.authorize_changes, false)
      assert.equal(row.api_key, 'private-registry-secret')
      const review = await page.locator('[data-setup-choices]').innerText()
      assert.match(review, /Chosen explicitly/)
      assert.equal(review.includes('private-registry-secret'), false)
      assert.equal((await page.locator('body').innerText()).includes('never-copy-schema-secret'), false)
      assert.deepEqual((await snapshot(page)).storage, {})
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': existing configuration changes require a fresh masked preview and draft-bound approval', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.run.actions = [{ id: 'adopt', source: 'seerr.Requests', service_key: 'seerr', label: 'Review Seerr connection', automation: 'after_input', required: true, execution: 'waiting_input', previewable: true, retryable: true, input_fields: ['seerr.Requests::url', 'seerr.Requests::adopt_existing', 'seerr.Requests::adoption_preview_id'] }]
    input.run.arrangement_schema.fields = [
      { key: 'seerr.Requests::url', label: 'Connection URL', type: 'url' },
      { key: 'seerr.Requests::adopt_existing', label: 'Raw adoption switch', type: 'boolean' },
      { key: 'seerr.Requests::adoption_preview_id', label: 'Raw preview identifier', type: 'string' },
    ]
    input.actionPreviews = { adopt: { preview_status: 'ready', preview_id: 'preview-one', changes: [
      { field: 'url', before: 'https://user:private@example.test/old?token=private', after: 'https://example.test/new', managed: false, requires_consent: true },
      { field: 'api_key', before: 'private-old', after: 'private-new', secret: true, requires_consent: true },
    ] } }
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.goto(fixture.origin + '/adoption-checklist#status')
      const task = page.locator('[data-setup-action="adopt"]')
      await task.locator('summary').click()
      assert.equal(await task.getByLabel('Raw adoption switch').count(), 0)
      assert.equal(await task.getByRole('button', { name: 'Retry this action', exact: true }).count(), 0)
      await task.getByLabel('Connection URL', { exact: true }).fill('https://example.test/new')
      await task.getByRole('button', { name: 'Preview changes', exact: true }).click()
      await task.getByRole('table').waitFor()
      assert.equal((await task.innerText()).includes('private'), false)
      const consent = task.getByRole('checkbox', { name: 'I reviewed these changes and authorize updating this existing configuration.', exact: true })
      assert.equal(await task.getByRole('button', { name: 'Apply configuration', exact: true }).isDisabled(), true)
      await consent.check()
      assert.equal(await task.getByRole('button', { name: 'Apply configuration', exact: true }).isDisabled(), false)
      await task.getByLabel('Connection URL', { exact: true }).fill('https://example.test/changed')
      assert.equal(await consent.isChecked(), false)
      assert.equal(await consent.isDisabled(), true)
      assert.equal(await task.getByRole('button', { name: 'Apply configuration', exact: true }).isDisabled(), true)
      await task.getByRole('button', { name: 'Preview changes', exact: true }).click()
      await consent.check()
      await task.getByRole('button', { name: 'Apply configuration', exact: true }).click()
      const requests = (await snapshot(page)).requests.filter(request => request.method === 'action')
      assert.deepEqual(requests.map(request => request.payload.values.operation), ['preview', 'preview', 'apply'])
      assert.deepEqual(requests.at(-1).payload.values.values, {
        'seerr.Requests::url': 'https://example.test/changed',
        'seerr.Requests::adopt_existing': true,
        'seerr.Requests::adoption_preview_id': 'preview-one',
      })
      assert.deepEqual((await snapshot(page)).storage, { 'dumb.setup.run': 'run-one' })
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': explicit consumer checks show namespace and bounded evidence without automatic execution', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.run.actions = [{ id: 'consumer', source: 'sonarr.Series', service_key: 'sonarr', label: 'Check consumer paths', automation: 'after_input', required: false, execution: 'waiting_input', explicit_only: true, previewable: true, retryable: true, input_fields: ['sonarr.Series::consumer_paths'], evidence: { level: 'consumer_namespace', namespace_verified: true, uid: 1000, gid: 1000, paths: [{ path: '/media/series', accessible: true, content_checked: true, read_bytes: 65536, sample_complete: false }, { path: '/media/unverified', accessible: null, content_checked: false }] } }]
    input.run.actions.push({ id: 'awaiting-evidence', source: 'sonarr.Series', service_key: 'sonarr', label: 'Waiting for native check evidence', automation: 'unknown', required: true, execution: 'pending', evidence: null })
    input.run.arrangement_schema.fields = [{ key: 'sonarr.Series::consumer_paths', label: 'Consumer paths', type: 'list', item_label: 'Path', item_fields: [{ key: 'path', label: 'Consumer path', type: 'string' }, { key: 'max_bytes', label: 'Maximum bytes to read', type: 'number', default: 65536 }] }]
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.goto(fixture.origin + '/consumer-checklist#status')
      const task = page.locator('[data-setup-action="consumer"]')
      await task.getByText('Consumer filesystem namespace: Verified', { exact: false }).waitFor()
      await page.getByText('Waiting for native check evidence', { exact: true }).waitFor()
      assert.match(await task.innerText(), /Bounded sample/)
      assert.match(await task.innerText(), /\/media\/unverified · Not verified/)
      assert.equal((await snapshot(page)).requests.some(request => request.method === 'action'), false)
      await task.locator('summary').click()
      await task.getByRole('button', { name: 'Add Path', exact: true }).click()
      await task.getByLabel('Consumer path', { exact: true }).fill('/media/series')
      await task.getByRole('button', { name: 'Run this check', exact: true }).click()
      const request = (await snapshot(page)).requests.filter(request => request.method === 'action').at(-1)
      assert.equal(request.payload.values.operation, 'apply')
      assert.deepEqual(request.payload.values.values['sonarr.Series::consumer_paths'], [{ max_bytes: 65536, path: '/media/series' }])
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })


  test(name + ': workflow probes require scoped authorization and a fresh preview before any execution', { timeout: 90000 }, async () => {
    const input = makeInput()
    input.run.actions = [{ id: 'workflow', source: 'radarr.Movies', service_key: 'radarr', action: 'workflow_test', label: 'Test the selected movie workflow', automation: 'after_input', required: false, execution: 'waiting_input', explicit_only: true, previewable: true, input_fields: ['radarr.Movies::workflow_probe', 'radarr.Movies::workflow_preview_id', 'radarr.Movies::workflow_cleanup'], evidence: { level: 'workflow_test', stage: 'playback', checks: [{ label: 'Native import', ok: true }, { label: 'Decoded frame', ok: null, reason: 'Not yet checked' }], download_bytes: 65536, decoded_frames: 0, cleanup_complete: false } }]
    input.run.arrangement_schema.fields = [
      { key: 'radarr.Movies::workflow_probe', label: 'Workflow test scope', type: 'object', fields: [
        { key: 'provider', label: 'Test provider', type: 'select', default: 'infinidysk', options: [{ value: 'infinidysk', label: 'InfiniDysk' }] },
        { key: 'source_url', label: 'Authorized test NZB URL', type: 'password' },
        { key: 'item_id', label: 'Native item ID', type: 'integer' },
        { key: 'max_download_bytes', label: 'Download byte limit', type: 'integer', default: 8388608 },
        { key: 'timeout_seconds', label: 'Test time limit', type: 'integer', default: 60 },
        { key: 'authorize_download_import_scan', label: 'Authorize this download, import and refresh', type: 'boolean', default: false },
        { key: 'cleanup_after', label: 'Clean up owned test artifacts', type: 'boolean', default: true },
        { key: 'authorize_library_scan', label: 'Authorize a whole-library Audiobookshelf scan', type: 'boolean', default: false },
      ] },
      { key: 'radarr.Movies::workflow_preview_id', label: 'Raw workflow preview identifier', type: 'string' },
      { key: 'radarr.Movies::workflow_cleanup', label: 'Recover cleanup for the recorded test only', type: 'boolean', default: false },
    ]
    input.actionPreviews = { workflow: { preview_status: 'ready', preview_id: 'workflow-preview-one', changes: [{ field: 'item_id', before: null, after: 10, managed: true, requires_consent: true }], side_effects: ['Downloads only the authorized sample within your limits.', 'Imports the selected native item and refreshes the chosen media server.'] } }
    const { browser, page, errors } = await open(browserType, input)
    try {
      await page.goto(fixture.origin + '/workflow-checklist#status')
      const task = page.locator('[data-setup-action="workflow"]')
      await task.getByText('Decoded frame · Not verified · Not yet checked', { exact: true }).waitFor()
      await task.getByText('Test artifact cleanup: Needs attention', { exact: true }).waitFor()
      assert.equal((await snapshot(page)).requests.some(request => request.method === 'action'), false)
      await task.locator('summary').click()
      assert.equal(await task.getByLabel('Raw workflow preview identifier', { exact: true }).count(), 0)
      const run = task.getByRole('button', { name: 'Run this check', exact: true })
      assert.equal(await run.isDisabled(), true)
      await task.getByLabel('Authorized test NZB URL', { exact: true }).fill('https://example.test/private-sample.nzb')
      await task.getByLabel('Native item ID', { exact: true }).fill('10')
      await task.getByLabel('Authorize this download, import and refresh', { exact: true }).check()
      assert.equal(await run.isDisabled(), true)
      await task.getByRole('button', { name: 'Preview changes', exact: true }).click()
      assert.equal(await run.isDisabled(), false)
      await task.getByLabel('Native item ID', { exact: true }).fill('11')
      assert.equal(await run.isDisabled(), true)
      await task.getByRole('button', { name: 'Preview changes', exact: true }).click()
      await run.click()
      const requests = (await snapshot(page)).requests.filter(request => request.method === 'action')
      assert.deepEqual(requests.map(request => request.payload.values.operation), ['preview', 'preview', 'apply'])
      const submitted = requests.at(-1).payload.values.values
      assert.equal(submitted['radarr.Movies::workflow_preview_id'], 'workflow-preview-one')
      assert.equal(submitted['radarr.Movies::workflow_probe'].item_id, 11)
      assert.equal(submitted['radarr.Movies::workflow_probe'].authorize_download_import_scan, true)
      assert.equal(submitted['radarr.Movies::workflow_probe'].authorize_library_scan, false)
      assert.equal('radarr.Movies::adopt_existing' in submitted, false)
      await task.getByLabel('Recover cleanup for the recorded test only', { exact: true }).check()
      await task.getByRole('button', { name: 'Clean up test artifacts', exact: true }).click()
      const cleanup = (await snapshot(page)).requests.filter(request => request.method === 'action').at(-1).payload.values
      assert.equal(cleanup.operation, 'apply')
      assert.deepEqual(cleanup.values, { 'radarr.Movies::workflow_cleanup': true })
      assert.deepEqual((await snapshot(page)).storage, { 'dumb.setup.run': 'run-one' })
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

}
