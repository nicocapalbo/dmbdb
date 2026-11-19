import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { chromium, firefox } from 'playwright'
import { createSetupWizardFixture } from '../support/setupWizardFixture.mjs'

let fixture
before(async () => { fixture = await createSetupWizardFixture() })
after(async () => { await fixture?.close() })

const waiting = (id, extra = {}) => ({ id, label: id, automation: 'after_input', required: true, execution: 'waiting_input', verification: 'not_checked', ...extra })
const operations = snapshot => snapshot.requests.filter(request => request.method === 'action').map(request => request.payload)
const inputs = () => {
  const fields = [
    { key: 'infinidysk::nntp', resource_id: 'infinidysk', service_key: 'infinidysk', label: 'Usenet providers', type: 'nntp_providers', required: true },
    { key: 'infinidysk::adopt_existing', resource_id: 'infinidysk', service_key: 'infinidysk', label: 'Update existing configuration', type: 'boolean' },
    { key: 'infinidysk::adoption_preview_id', resource_id: 'infinidysk', service_key: 'infinidysk', label: 'Preview identifier', type: 'string' },
    { key: 'prowlarr::indexer', resource_id: 'prowlarr', service_key: 'prowlarr', label: 'Indexer to connect', type: 'select', options: [], required: true },
    { key: 'lidarr.Music::quality_profile', resource_id: 'lidarr.Music', service_key: 'lidarr', label: 'Default music quality profile', type: 'select', options: [], required: true },
  ]
  const freshFields = structuredClone(fields)
  freshFields.find(field => field.key === 'prowlarr::indexer').options = [{ value: 'indexer-7', label: 'Example indexer supplied by Prowlarr' }]
  freshFields.find(field => field.key === 'lidarr.Music::quality_profile').options = [{ value: 'profile-12', label: 'Lossless profile supplied by Lidarr' }]
  return {
    capabilities: { setup_arrangements: true }, coreServices: [], coreCatalog: [], plan: { plan_id: 'post-start-plan', services: [], actions: [], checks: [] },
    run: {
      run_id: 'post-start-run', status: 'waiting_input', values: {},
      services: ['plex', 'infinidysk', 'prowlarr', 'lidarr.Music'].map(id => ({ id, service_key: id.split('.')[0], process_name: id, status: 'running' })),
      arrangement_schema: { fields },
      actions: [
        waiting('music-profile', { service_key: 'lidarr', source: 'lidarr.Music', instance_key: 'Music', label: 'Choose a music quality profile', prerequisites: ['indexer'], input_fields: ['lidarr.Music::quality_profile'] }),
        waiting('indexer', { service_key: 'prowlarr', source: 'prowlarr', label: 'Connect your indexer', prerequisites: ['provider'], input_fields: ['prowlarr::indexer'] }),
        waiting('provider', { service_key: 'infinidysk', source: 'infinidysk', label: 'Connect your Usenet provider', prerequisites: ['account'], previewable: true, input_fields: ['infinidysk::nntp', 'infinidysk::adopt_existing', 'infinidysk::adoption_preview_id'] }),
        waiting('account', { service_key: 'plex', source: 'plex', label: 'Sign in and create your library', automation: 'manual', reason: 'Sign in to Plex in a new tab.', instructions: ['Sign in to Plex in a new tab.', 'Create your first library in Plex.', 'Return here when you have finished.'], ui_url: 'https://app.example.test/' }),
      ],
    },
    actionPreviews: {
      provider: { preview_id: 'provider-preview', preview_status: 'ready', requires_consent: true, changes: [{ field: 'provider', before: 'Existing provider', after: 'Your selected provider', requires_consent: true }] },
    },
    actionResults: {
      account: { confirm: { action: { execution: 'user_confirmed', verification: 'not_checked', evidence: { level: 'user_attested' } } } },
      provider: { apply: { action: { execution: 'applied', verification: 'passed', evidence: { level: 'connection', checks: [{ name: 'authentication', label: 'Provider authentication', passed: true }] } }, run: { values: { 'infinidysk::nntp': [{ host: 'news.example.test', password: '[configured]' }] } } } },
      indexer: {
        recheck: { run: { arrangement_schema: { fields: freshFields } } },
        apply: { action: { execution: 'applied', verification: 'passed' }, run: { values: { 'infinidysk::nntp': [{ host: 'news.example.test', password: '[configured]' }], 'prowlarr::indexer': 'indexer-7' } } },
      },
      'music-profile': {
        defer: { action: { execution: 'waiting_input', verification: 'not_checked', deferred_by_user: true, reason: 'This required connection is left for later.' } },
        recheck: { action: { execution: 'waiting_input', verification: 'not_checked', deferred_by_user: false, reason: 'Choose the profile supplied by your running app.' } },
      },
    },
  }
}

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  test(name + ': retained setup guides live choices, explicit writes and honest pause/resume outcomes', { timeout: 90000 }, async () => {
    const browser = await type.launch()
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 } })
    let page = await context.newPage()
    const errors = []
    const observe = target => target.on('pageerror', error => errors.push(error.message))
    observe(page)
    const capture = async label => {
      if (!process.env.DUMB_POSTSETUP_SCREENSHOT_DIR) return
      await mkdir(process.env.DUMB_POSTSETUP_SCREENSHOT_DIR, { recursive: true })
      await page.screenshot({ path: path.join(process.env.DUMB_POSTSETUP_SCREENSHOT_DIR, name + '-' + label + '.png'), fullPage: true })
    }
    const input = inputs()
    await page.addInitScript(value => { window.__setupWizardInput = value }, input)
    try {
      await page.goto(fixture.origin + '/#status')
      await page.getByRole('button', { name: 'Walk me through setup', exact: true }).click()
      let guide = page.locator('[data-setup-walkthrough]')
      let current = guide.locator('[data-setup-walkthrough-action]')
      await page.waitForFunction(() => document.querySelector('[data-setup-walkthrough-action]')?.dataset.setupWalkthroughAction === 'account')
      assert.equal(await current.locator('ol > li').count(), 2)
      assert.equal(await current.getByText('Sign in to Plex in a new tab.', { exact: true }).count(), 1)
      const appLink = current.getByRole('link', { name: 'Open app in a new tab', exact: true })
      assert.equal(await appLink.getAttribute('target'), '_blank')
      await capture('manual-guide')
      await page.setViewportSize({ width: 430, height: 850 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'The mobile guide must fit without horizontal scrolling')
      await capture('manual-guide-mobile')
      await page.setViewportSize({ width: 1100, height: 850 })
      await current.getByRole('button', { name: 'I completed this in the app', exact: true }).click()
      await current.getByText('Confirmed by you; not automatically checked', { exact: true }).waitFor()
      assert.equal(await current.getAttribute('data-setup-walkthrough-action'), 'account', 'A returned result must remain visible until the user advances')
      await guide.getByRole('button', { name: 'Next step', exact: true }).click()
      await current.getByRole('heading', { name: 'Connect your Usenet provider', exact: true }).waitFor()
      await current.getByRole('button', { name: 'Add provider', exact: true }).click()
      await current.getByLabel('Server hostname', { exact: true }).fill('news.example.test')
      await current.getByLabel('Password', { exact: true }).fill('post-start-private-fixture-password')
      assert.equal(await current.getByLabel('Password', { exact: true }).getAttribute('type'), 'password')
      await capture('provider-form')
      assert.equal(operations(await page.evaluate(() => setupWizard.snapshot())).some(item => item.values.operation === 'apply'), false)
      await current.getByRole('button', { name: 'Preview changes', exact: true }).click()
      const consent = current.getByRole('checkbox', { name: 'I reviewed these changes and authorize updating this existing configuration.', exact: true })
      await consent.waitFor()
      assert.equal(await current.getByRole('button', { name: 'Apply configuration', exact: true }).isDisabled(), true)
      assert.equal(operations(await page.evaluate(() => setupWizard.snapshot())).some(item => item.values.operation === 'apply'), false, 'Preview must not write configuration')
      await consent.check()
      await current.getByRole('button', { name: 'Apply configuration', exact: true }).click()
      await current.getByText('Checked successfully', { exact: true }).waitFor()
      const evidence = current.locator('[data-setup-walkthrough-evidence]')
      assert.equal(await evidence.evaluate(element => element.open), false)
      await evidence.locator('summary').click()
      await evidence.getByText(/Provider authentication/).waitFor()
      await guide.getByRole('button', { name: 'Next step', exact: true }).click()
      await current.getByRole('heading', { name: 'Connect your indexer', exact: true }).waitFor()
      const indexer = current.locator('[data-setup-field="prowlarr::indexer"] select')
      assert.equal(await indexer.isDisabled(), true)
      assert.equal(await indexer.locator('option[value="indexer-7"]').count(), 0)
      await guide.getByRole('button', { name: 'Refresh app choices and status', exact: true }).click()
      await indexer.locator('option[value="indexer-7"]').waitFor({ state: 'attached' })
      await indexer.selectOption('indexer-7')
      await current.getByRole('button', { name: 'Apply configuration', exact: true }).click()
      await current.getByText('Checked successfully', { exact: true }).waitFor()
      await guide.getByRole('button', { name: 'Next step', exact: true }).click()
      await current.getByRole('heading', { name: 'Choose a music quality profile', exact: true }).waitFor()
      await current.locator('select').selectOption('profile-12')
      await current.getByRole('button', { name: 'Do this later', exact: true }).click()
      await current.getByText('Left for later', { exact: true }).waitFor()
      await guide.getByRole('button', { name: 'Pause walkthrough', exact: true }).click()
      assert.equal(await guide.count(), 0)
      const paused = await page.evaluate(() => setupWizard.snapshot())
      const preference = JSON.parse(paused.storage['dumb.setup.walkthrough.v1'])
      assert.equal(preference.paused, true)
      assert.equal(preference.activeActionId, 'music-profile')
      assert.doesNotMatch(JSON.stringify(paused.storage), /post-start-private-fixture-password|news\.example\.test|profile-12/)
      assert.equal(paused.run.actions.find(action => action.id === 'music-profile').verification, 'not_checked')

      // A new document receives the same retained backend run, while only guide
      // navigation metadata survives in browser localStorage.
      const retained = structuredClone(input)
      retained.run = paused.run
      await page.close()
      page = await context.newPage()
      observe(page)
      await page.addInitScript(value => { window.__setupWizardInput = value }, retained)
      await page.goto(fixture.origin + '/#status')
      await page.getByRole('button', { name: 'Resume guided setup', exact: true }).click()
      guide = page.locator('[data-setup-walkthrough]')
      current = guide.locator('[data-setup-walkthrough-action]')
      const summary = guide.locator('[data-setup-walkthrough-summary]')
      await summary.waitFor()
      assert.equal(await current.count(), 0, 'A run with only deferred outstanding work resumes at its honest summary')
      assert.match(await summary.innerText(), /1 required task remains and 1 task was left for later/)
      assert.match(await summary.innerText(), /1 step was confirmed by you/)
      assert.match(await summary.innerText(), /confirmed by you.*separately from automatically checked/s)
      assert.match(await summary.innerText(), /Choose a music quality profile · Left for later/)
      assert.match(await guide.locator('[data-setup-walkthrough-count]').innerText(), /2 checked · 1 confirmed by you · 1 still need attention/)
      await capture('resumed-summary')
      await summary.getByRole('button', { name: 'Review unfinished steps', exact: true }).click()
      await current.getByRole('heading', { name: 'Choose a music quality profile', exact: true }).waitFor()
      await current.getByText('Left for later', { exact: true }).waitFor()
      await current.getByRole('button', { name: 'Recheck this step', exact: true }).click()
      await current.getByText('Ready for your review', { exact: true }).waitFor()
      const snapshot = await page.evaluate(() => setupWizard.snapshot())
      assert.equal(snapshot.run.actions.find(action => action.id === 'account').verification, 'not_checked')
      assert.equal(snapshot.requests.some(request => ['start', 'legacy-start'].includes(request.method)), false)
      assert.deepEqual(errors, [])
    } finally { await context.close(); await browser.close() }
  })

  test(name + ': service walkthrough excludes siblings and requires explicit workflow authorization', { timeout: 90000 }, async () => {
    const browser = await type.launch()
    const page = await browser.newPage({ viewport: { width: 1000, height: 850 } })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const workflow = 'lidarr.Music::workflow_test'
    const probe = 'lidarr.Music::workflow_probe'
    const input = {
      capabilities: { setup_arrangements: true }, coreServices: [], coreCatalog: [], plan: { actions: [], services: [], checks: [] },
      run: {
        run_id: 'service-scoped-run', status: 'waiting_input', values: {},
        services: [{ id: 'lidarr.Music', service_key: 'lidarr', instance_key: 'Music', process_name: 'Lidarr Music', status: 'running' }],
        arrangement_schema: { fields: [{ key: probe, resource_id: 'lidarr.Music', service_key: 'lidarr', label: 'Optional complete workflow test', type: 'object', fields: [{ key: 'authorize_download_import_scan', label: 'Authorize download, import and media refresh', type: 'boolean' }] }] },
        actions: [
          waiting('other-instance', { service_key: 'lidarr', source: 'lidarr.4K', instance_key: '4K', label: 'Other instance credentials' }),
          waiting('manual', { service_key: 'lidarr', source: 'lidarr.Music', instance_key: 'Music', automation: 'manual', label: 'Review the music library', instructions: 'Open Lidarr and confirm your media folder.' }),
          waiting(workflow, { service_key: 'lidarr', source: 'lidarr.Music', instance_key: 'Music', action: 'workflow_test', label: 'Check a sample music workflow', explicit_only: true, required: false, previewable: true, input_fields: [probe] }),
          waiting('other-workflow', { service_key: 'lidarr', source: 'lidarr.4K', instance_key: '4K', label: 'Other instance workflow', explicit_only: true, required: false }),
        ],
      },
      actionPreviews: { [workflow]: { preview_id: 'music-workflow-preview', preview_status: 'ready', changes: [] } },
    }
    await page.addInitScript(value => { window.__setupWizardInput = value }, input)
    try {
      await page.goto(fixture.origin + '/#service:Lidarr%20Music')
      await page.getByRole('button', { name: 'Walk me through setup', exact: true }).click()
      const guide = page.locator('[data-setup-walkthrough]')
      assert.doesNotMatch(await guide.innerText(), /Other instance/)
      assert.equal(await guide.getByText('Check a sample music workflow', { exact: true }).count(), 0)
      await guide.getByRole('checkbox', { name: 'Include optional workflow checks', exact: true }).check()
      await guide.getByRole('button', { name: 'See another task', exact: true }).click()
      const current = guide.locator('[data-setup-walkthrough-action]')
      await current.getByRole('heading', { name: 'Check a sample music workflow', exact: true }).waitFor()
      assert.doesNotMatch(await guide.innerText(), /Other instance/)
      assert.equal(await current.getByRole('button', { name: 'Run this check', exact: true }).isDisabled(), true)
      assert.equal(operations(await page.evaluate(() => setupWizard.snapshot())).some(item => item.values.operation === 'apply'), false)
      await current.getByRole('checkbox', { name: 'Authorize download, import and media refresh', exact: true }).check()
      assert.equal(await current.getByRole('button', { name: 'Run this check', exact: true }).isDisabled(), true, 'Authorization also requires a preview for these choices')
      await current.getByRole('button', { name: 'Preview changes', exact: true }).click()
      await page.waitForFunction(() => setupWizard.snapshot().run.actions.find(action => action.id === 'lidarr.Music::workflow_test')?.evidence?.preview_id === 'music-workflow-preview')
      assert.equal(operations(await page.evaluate(() => setupWizard.snapshot())).some(item => item.values.operation === 'apply'), false)
      await current.getByRole('button', { name: 'Run this check', exact: true }).click()
      const request = operations(await page.evaluate(() => setupWizard.snapshot())).find(item => item.values.operation === 'apply')
      assert.equal(request.action, workflow)
      assert.equal(request.values.values[probe].authorize_download_import_scan, true)
      assert.equal(request.values.values['lidarr.Music::workflow_preview_id'], 'music-workflow-preview')
      assert.equal(request.values.operation, 'apply')
      assert.equal(await current.getAttribute('data-setup-walkthrough-action'), workflow)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })
}
