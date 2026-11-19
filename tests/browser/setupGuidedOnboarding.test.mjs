import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { chromium, firefox } from 'playwright'
import { createSetupWizardFixture } from '../support/setupWizardFixture.mjs'

let fixture
before(async () => { fixture = await createSetupWizardFixture() })
after(async () => { await fixture?.close() })
const input = () => ({
  capabilities: { setup_arrangements: true, optional_only_onboarding: true },
  coreServices: [{ name: 'infinidysk' }, { name: 'lidarr' }, { name: 'plex' }],
  coreCatalog: ['infinidysk', 'lidarr', 'plex'].map(key => ({ key, name: key, dependencies: [], service_options: {}, debrid_providers: [] })),
  plan: {
    plan_id: 'novice-plan',
    services: ['plex', 'lidarr', 'infinidysk'].map(key => ({ id: key, service_key: key, name: key === 'infinidysk' ? 'InfiniDysk' : key === 'lidarr' ? 'Lidarr' : 'Plex', selection_kind: 'chosen' })),
    checks: [{ key: 'storage:bazarr:0', resource_id: 'bazarr', label: 'Application installation: /opt/bazarr', critical: true, ok: true, detail: 'Directory metadata and configured primary UID/GID permissions checked; supplementary ACLs and media contents were not checked.' }],
    actions: [
      { id: 'provider', service_key: 'infinidysk', automation: 'after_input', required: true, input_fields: ['infinidysk::nntp'], missing_inputs: ['infinidysk::nntp'], ui_url: '/services/InfiniDysk', label: 'Configure Usenet provider' },
      { id: 'music', service_key: 'lidarr', automation: 'after_input', required: true, input_fields: ['lidarr::root_folder', 'lidarr::quality_profile'], missing_inputs: ['lidarr::root_folder'], prerequisites: ['provider'], ui_url: '/services/Lidarr', label: 'Choose music preferences' },
      { id: 'download', service_key: 'lidarr', automation: 'after_input', required: true, input_fields: ['lidarr::download_client'], missing_inputs: ['lidarr::download_client'], prerequisites: ['provider'], label: 'Connect the downloader' },
      { id: 'trial', service_key: 'lidarr', automation: 'after_input', required: false, explicit_only: true, input_fields: ['lidarr::workflow_probe'], label: 'Optional complete workflow test' },
    ],
    arrangement_schema: { fields: [
      { key: 'lidarr::quality_profile', resource_id: 'lidarr', service_key: 'lidarr', label: 'Default music quality profile', type: 'select', options: [] },
      { key: 'plex::libraries', resource_id: 'plex', service_key: 'plex', label: 'Media libraries', type: 'libraries' },
      { key: 'infinidysk::nntp', resource_id: 'infinidysk', service_key: 'infinidysk', label: 'Usenet providers', type: 'nntp_providers', required: true },
      { key: 'lidarr::root_folder', resource_id: 'lidarr', service_key: 'lidarr', label: 'Music root folder to configure', type: 'select', options: [] },
      { key: 'lidarr::consumer_paths', resource_id: 'lidarr', service_key: 'lidarr', label: 'Verify paths as this running service', type: 'list', item_fields: [{ key: 'path', label: 'Media folder', type: 'string' }] },
      { key: 'lidarr::workflow_probe', resource_id: 'lidarr', service_key: 'lidarr', label: 'Optional complete workflow test', type: 'object', fields: [{ key: 'provider', label: 'Download provider', type: 'select', options: [] }] },
      { key: 'lidarr::download_client', resource_id: 'lidarr', service_key: 'lidarr', label: 'Download client', type: 'connection', options: [{ value: 'infinidysk', label: 'InfiniDysk' }] },
    ] },
  },
  run: { run_id: 'novice-run', status: 'waiting_input', actions: [] },
})

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  test(name + ': fresh users postpone connection choices and can still enter advanced settings before startup', { timeout: 90000 }, async () => {
    const browser = await type.launch()
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(value => { window.__setupWizardInput = value }, input())
    const capture = async label => {
      if (!process.env.DUMB_ONBOARDING_SCREENSHOT_DIR) return
      await mkdir(process.env.DUMB_ONBOARDING_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.DUMB_ONBOARDING_SCREENSHOT_DIR, name + '-' + label + '.png'), fullPage: true })
    }
    try {
      await page.goto(fixture.origin)
      await page.waitForFunction(() => window.setupWizard)
      await page.evaluate(() => setupWizard.jump('arrangement'))
      await page.getByRole('heading', { name: 'Installation choices', exact: true }).waitFor()
      await page.waitForFunction(() => setupWizard.snapshot().plan && !setupWizard.snapshot().loading)
      assert.equal(await page.locator('[data-setup-guided-choice]').count(), 0)
      assert.equal(await page.locator('[data-setup-field="lidarr::quality_profile"]').count(), 0)
      assert.equal(await page.getByRole('button', { name: 'Review setup', exact: true }).isEnabled(), true)
      await capture('installation')
      await page.getByRole('button', { name: 'Show connection settings before startup', exact: true }).click()
      for (const group of await page.locator('[data-setup-expert-group]').all()) assert.equal(await group.evaluate(element => element.open), false)
      await page.locator('[data-setup-expert-group="infinidysk"] > summary').click()
      await page.getByRole('button', { name: 'Add provider', exact: true }).click()
      await page.getByLabel('Server hostname', { exact: true }).fill('news.example.test')
      await page.getByLabel('Password', { exact: true }).fill('novice-fixture-secret')
      await page.locator('[data-setup-expert-group="lidarr"] > summary').click()
      const quality = page.locator('[data-setup-field="lidarr::quality_profile"]')
      assert.equal(await quality.locator('select').isDisabled(), true)
      assert.match(await quality.innerText(), /no available choices yet|initial setup/i)
      await page.getByRole('button', { name: 'Show installation choices', exact: true }).click()
      assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0)
      await page.getByRole('button', { name: 'Show connection settings before startup', exact: true }).click()
      await page.locator('[data-setup-expert-group="infinidysk"] > summary').click()
      assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), 'novice-fixture-secret')
      await page.getByRole('button', { name: 'Review setup', exact: true }).click()
      await page.getByRole('heading', { name: 'Review your setup', exact: true }).waitFor()
      const review = page.locator('[data-setup-review]')
      await page.waitForFunction(() => setupWizard.snapshot().plan && !setupWizard.snapshot().loading)
      assert.match(await review.innerText(), /What happens when you start|Finish after the apps start/)
      assert.equal(await review.locator('a[href^="/services/"]').count(), 0)
      for (const selector of ['[data-setup-technical-review]', '[data-setup-review-choices]', '[data-setup-payload]']) assert.equal(await page.locator(selector).evaluate(element => element.open), false)
      assert.doesNotMatch(await page.locator('body').innerText(), /UID\/GID|supplementary ACLs|novice-fixture-secret/)
      assert.equal(await page.getByRole('button', { name: 'Start services', exact: true }).isEnabled(), true)
      await capture('review')
      await page.setViewportSize({ width: 430, height: 850 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await capture('review-mobile')
      const snapshot = await page.evaluate(() => setupWizard.snapshot())
      assert.equal(snapshot.choices['infinidysk::nntp'][0].password, 'novice-fixture-secret')
      assert.equal('lidarr::root_folder' in snapshot.choices, false, 'Unavailable native folder IDs must never be invented')
      assert.equal(snapshot.requests.some(request => ['start', 'legacy-start', 'action'].includes(request.method)), false)
      await page.getByRole('button', { name: 'Back to installation choices', exact: true }).click()
      await page.locator('[data-setup-installation-choices]').waitFor()
      assert.equal((await page.evaluate(() => setupWizard.snapshot())).choices['infinidysk::nntp'][0].password, 'novice-fixture-secret')
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': optional companions explain empty selections when advanced pre-start settings are requested', { timeout: 90000 }, async () => {
    const browser = await type.launch()
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const choices = ['bazarr', 'seerr']
    await page.addInitScript(value => { window.__setupWizardInput = value }, {
      capabilities: { setup_arrangements: true, optional_only_onboarding: true },
      coreServices: [],
      coreCatalog: [{ key: 'sonarr', name: 'Sonarr', dependencies: [], service_options: {}, debrid_providers: [] }],
      optionalServices: choices,
      optionalCatalog: choices.map(key => ({ key, name: key === 'bazarr' ? 'Bazarr' : 'Seerr', service_options: {} })),
      plan: {
        plan_id: 'optional-companions',
        services: choices.map(key => ({ id: key, service_key: key, name: key === 'bazarr' ? 'Bazarr' : 'Seerr', selection_kind: 'chosen' })),
        checks: [],
        actions: [
          { id: 'bazarr::connection', service_key: 'bazarr', label: 'Connect selected library apps', required: true, automation: 'after_input', input_fields: ['bazarr::arr_instances'], missing_inputs: ['bazarr::arr_instances'] },
          { id: 'seerr::connection', service_key: 'seerr', label: 'Connect selected request targets', required: true, automation: 'after_input', input_fields: ['seerr::arrs', 'seerr::api_key'], missing_inputs: ['seerr::arrs'] },
        ],
        arrangement_schema: { fields: [
          { key: 'bazarr::arr_instances', resource_id: 'bazarr', service_key: 'bazarr', label: 'Arr instances to connect', type: 'multiselect', options: [] },
          { key: 'seerr::arrs', resource_id: 'seerr', service_key: 'seerr', label: 'Request targets', type: 'multiselect', options: [] },
          { key: 'seerr::api_key', resource_id: 'seerr', service_key: 'seerr', label: 'Application API key', type: 'password', secret: true },
        ] },
      },
      run: { run_id: 'optional-companions-run', status: 'waiting_input', actions: [] },
    })
    const assertEmptySelection = async container => {
      const menu = container.locator('select')
      assert.equal(await menu.isDisabled(), true)
      assert.equal(await menu.evaluate(element => [...element.options].filter(option => option.value).length), 0, 'The app inventory must not invent a target or native ID')
      assert.match(await container.innerText(), /No compatible library apps are selected/)
      assert.doesNotMatch(await container.innerText(), /after startup|after the app|initial setup|once.*running/i)
    }
    try {
      await page.goto(fixture.origin)
      await page.waitForFunction(() => window.setupWizard)
      await page.evaluate(() => setupWizard.jump('arrangement'))
      await page.waitForFunction(() => setupWizard.snapshot().plan && !setupWizard.snapshot().loading)
      assert.equal(await page.locator('[data-setup-field="bazarr::arr_instances"]').count(), 0)
      await page.getByRole('button', { name: 'Show connection settings before startup', exact: true }).click()
      for (const key of choices) {
        const group = page.locator(`[data-setup-expert-group="${key}"]`)
        assert.equal(await group.evaluate(element => element.open), false)
        await group.locator('summary').click()
        const field = group.locator(`[data-setup-field="${key === 'bazarr' ? 'bazarr::arr_instances' : 'seerr::arrs'}"]`)
        await assertEmptySelection(field)
      }
      await page.getByLabel('Application API key', { exact: true }).fill('optional-companion-fixture-secret')
      await page.getByRole('button', { name: 'Show installation choices', exact: true }).click()
      await page.getByRole('button', { name: 'Review setup', exact: true }).click()
      await page.getByRole('heading', { name: 'Review your setup', exact: true }).waitFor()
      await page.waitForFunction(() => setupWizard.snapshot().plan && !setupWizard.snapshot().loading)
      const snapshot = await page.evaluate(() => setupWizard.snapshot())
      assert.deepEqual(snapshot.payload.core_services, [])
      assert.equal(snapshot.choices['seerr::api_key'], 'optional-companion-fixture-secret')
      for (const key of ['bazarr::arr_instances', 'seerr::arrs']) assert.equal(key in snapshot.choices, false, 'Continuing cannot manufacture a target selection')
      assert.equal(snapshot.requests.some(request => ['start', 'legacy-start', 'action'].includes(request.method)), false)
      assert.doesNotMatch(await page.locator('body').innerText(), /optional-companion-fixture-secret/)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })
}
