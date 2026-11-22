import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { chromium, firefox } from 'playwright'
import { createSetupWizardFixture } from '../support/setupWizardFixture.mjs'
import { checklistTaskIds, expandSetupPanel, expandSetupTask } from '../support/setupChecklistBrowser.mjs'

let fixture
before(async () => { fixture = await createSetupWizardFixture() })
after(async () => { await fixture?.close() })

const task = (id, service, extra = {}) => ({ id, label: id, service_key: service, source: service, required: true, automation: 'after_input', execution: 'waiting_input', verification: 'not_checked', ...extra })
const input = () => ({
  capabilities: { setup_arrangements: true }, coreServices: [], coreCatalog: [], plan: { actions: [], services: [], checks: [] },
  run: {
    run_id: 'compact-checklist', status: 'partial', values: {},
    services: [
      { id: 'infinidysk', service_key: 'infinidysk', process_name: 'InfiniDysk' },
      { id: 'sonarr.Series', service_key: 'sonarr', instance_key: 'Series', process_name: 'Sonarr Series' },
      { id: 'sonarr.4K', service_key: 'sonarr', instance_key: '4K', process_name: 'Sonarr 4K' },
      { id: 'seerr', service_key: 'seerr', process_name: 'Seerr' },
      { id: 'plex', service_key: 'plex', process_name: 'Plex' },
      { id: 'postgres', service_key: 'postgres', process_name: 'PostgreSQL' },
    ],
    actions: [
      task('provider-input', 'infinidysk', { label: 'Enter provider details', input_fields: ['infinidysk::provider'] }),
      task('saved-unchecked', 'sonarr', { label: 'Check the saved Series connection', source: 'sonarr.Series', instance_key: 'sonarr.Series', execution: 'applied' }),
      task('failed-check', 'sonarr', { label: 'Review the failed optional Series check', source: 'sonarr.Series', instance_key: 'Series', execution: 'failed', verification: 'failed', required: false }),
      task('left-for-later', 'seerr', { label: 'Finish the deferred request connection', deferred_by_user: true }),
      task('4k-only', 'sonarr', { label: 'Connect the 4K library', source: 'sonarr.4K', instance_key: '4K' }),
      task('checked-provider', 'infinidysk', { label: 'Provider checked successfully', execution: 'already_present', verification: 'passed' }),
      task('confirmed-library', 'plex', { label: 'Library confirmed by you', execution: 'user_confirmed', evidence: { level: 'user_attested' } }),
      task('not-needed', 'postgres', { label: 'Separate database not required', execution: 'not_applicable', required: false }),
    ],
    arrangement_schema: { fields: [{ key: 'infinidysk::provider', resource_id: 'infinidysk', service_key: 'infinidysk', label: 'Provider name', type: 'string', required: true }] },
  },
})
const mutations = snapshot => snapshot.requests.filter(request => ['action', 'start', 'legacy-start', 'retry', 'recheck', 'complete'].includes(request.method))

async function open(type, values = input(), suffix = '/#status') {
  const browser = await type.launch()
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(value => { window.__setupWizardInput = value }, values)
  await page.goto(fixture.origin + suffix)
  await page.locator('[data-setup-summary]').waitFor()
  return { browser, page, errors }
}
async function capture(page, browser, label) {
  if (!process.env.DUMB_CHECKLIST_SCREENSHOT_DIR) return
  await mkdir(process.env.DUMB_CHECKLIST_SCREENSHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(process.env.DUMB_CHECKLIST_SCREENSHOT_DIR, browser + '-' + label + '.png'), fullPage: true })
}

for (const [name, type] of [['chromium', chromium], ['firefox', firefox]]) {
  test(name + ': checklist starts compact and app/status browsing never operates on services', { timeout: 60000 }, async () => {
    const { browser, page, errors } = await open(type)
    try {
      const panel = page.locator('[data-setup-status]')
      const toggle = panel.locator('[data-setup-toggle]')
      const body = panel.locator('[data-setup-panel-content]')
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(await toggle.getAttribute('aria-controls'), await body.getAttribute('id'))
      assert.equal(await body.isVisible(), false)
      assert.match(await panel.locator('[data-setup-summary]').innerText(), /4 required · 1 optional tasks need attention.*1 checked.*1 confirmed by you/s)
      assert.equal(await panel.locator('[data-setup-action-details]').count(), 0)
      assert.equal(await panel.locator('[data-setup-action-form]').count(), 0)
      await capture(page, name, 'dashboard-collapsed')

      // The disclosure is a real keyboard-accessible button.
      await toggle.focus()
      await page.keyboard.press('Enter')
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
      assert.equal(await body.isVisible(), true)
      assert.equal(await panel.getByLabel('Task status', { exact: true }).inputValue(), 'attention')
      assert.equal(await panel.getByLabel('App', { exact: true }).inputValue(), 'all')
      assert.equal(await panel.locator('[data-setup-group][open]').count(), 0)
      assert.equal(await panel.locator('[data-setup-action-details]').count(), 0)
      assert.deepEqual(await checklistTaskIds(page), ['4k-only', 'failed-check', 'left-for-later', 'provider-input', 'saved-unchecked'])

      await panel.getByLabel('App', { exact: true }).selectOption({ label: 'Sonarr Series' })
      const group = panel.locator('[data-setup-group="sonarr.Series"]')
      await group.locator('[data-setup-action="saved-unchecked"]').waitFor()
      assert.equal(await group.evaluate(element => element.open), true)
      assert.equal(await panel.locator('[data-setup-group]').count(), 1)
      const saved = await expandSetupTask(page, 'saved-unchecked')
      await saved.getByText('Configuration saved; connection not verified', { exact: true }).waitFor()
      const failed = await expandSetupTask(page, 'failed-check')
      assert.equal(await saved.evaluate(element => element.open), false)
      assert.equal(await failed.evaluate(element => element.open), true)
      assert.equal(await panel.locator('[data-setup-action-details]').count(), 1)
      await page.setViewportSize({ width: 430, height: 850 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await capture(page, name, 'series-task-mobile')

      await panel.getByLabel('App', { exact: true }).selectOption('all')
      await panel.getByLabel('Task status', { exact: true }).selectOption('checked')
      assert.deepEqual(await checklistTaskIds(page), ['checked-provider', 'confirmed-library'])
      const confirmed = await expandSetupTask(page, 'confirmed-library')
      assert.match(await confirmed.innerText(), /Confirmed by you; not automatically checked/)
      await panel.getByLabel('Task status', { exact: true }).selectOption('all')
      assert.equal((await checklistTaskIds(page)).length, 8)
      await panel.getByLabel('App', { exact: true }).selectOption('sonarr.Series')
      await panel.getByLabel('Task status', { exact: true }).selectOption('checked')
      await panel.locator('[data-setup-filter-empty]').waitFor()
      assert.equal(await panel.locator('[data-setup-action]').count(), 0)
      await toggle.click()
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(await body.isVisible(), false)
      assert.equal(mutations(await page.evaluate(() => setupWizard.snapshot())).length, 0)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': service scope stays compact while deliberate guided and checklist entry stays open', { timeout: 60000 }, async () => {
    const { browser, page, errors } = await open(type, input(), '/#service:Sonarr%20Series')
    try {
      let panel = page.locator('[data-setup-status]')
      assert.equal(await panel.locator('[data-setup-toggle]').getAttribute('aria-expanded'), 'false')
      assert.match(await panel.locator('[data-setup-summary]').innerText(), /1 required · 1 optional tasks need attention/)
      await expandSetupPanel(page)
      assert.deepEqual(await checklistTaskIds(page), ['failed-check', 'saved-unchecked'])
      await page.goto(fixture.origin + '/?view=checklist#walkthrough')
      panel = page.locator('[data-setup-status]')
      await panel.locator('[data-setup-full-checklist]').waitFor()
      assert.equal(await panel.locator('[data-setup-toggle]').getAttribute('aria-expanded'), 'true')
      assert.equal(await panel.locator('[data-setup-group][open]').count(), 0)
      assert.equal(mutations(await page.evaluate(() => setupWizard.snapshot())).length, 0)
      await page.goto(fixture.origin + '/#walkthrough')
      panel = page.locator('[data-setup-status]')
      await panel.locator('[data-setup-walkthrough]').waitFor()
      assert.equal(await panel.locator('[data-setup-toggle]').getAttribute('aria-expanded'), 'true')
      const guidedOperations = mutations(await page.evaluate(() => setupWizard.snapshot()))
      assert.equal(guidedOperations.every(request => request.method === 'action' && request.payload.values.operation === 'recheck'), true, 'The deliberate guide may refresh its current task, without applying or confirming it')
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': collapsed checklist keeps polling and updates the summary without opening itself', { timeout: 30000 }, async () => {
    const values = input()
    values.run.status = 'running'
    const { browser, page, errors } = await open(type, values)
    try {
      const panel = page.locator('[data-setup-status]')
      const toggle = panel.locator('[data-setup-toggle]')
      const reads = () => setupWizard.snapshot().requests.filter(request => ['get', 'latest'].includes(request.method)).length
      const initial = await page.evaluate(reads)
      await page.evaluate(() => {
        window.__setupWizardInput.run.status = 'complete'
        for (const action of window.__setupWizardInput.run.actions) {
          action.execution = 'applied'
          action.verification = 'passed'
          delete action.deferred_by_user
          delete action.evidence
        }
      })
      await page.waitForFunction(before => setupWizard.snapshot().requests.filter(request => ['get', 'latest'].includes(request.method)).length > before, initial, { timeout: 7000 })
      await panel.getByText('Setup actions completed', { exact: true }).waitFor()
      assert.match(await panel.locator('[data-setup-summary]').innerText(), /No unfinished tasks.*8 checked/s)
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(await panel.locator('[data-setup-panel-content]').isVisible(), false)
      assert.equal(mutations(await page.evaluate(() => setupWizard.snapshot())).length, 0)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': a successful recheck stays open for review and closing it restores filter focus', { timeout: 30000 }, async () => {
    const values = input()
    values.run.actions = [
      task('resolve-me', 'sonarr', { source: 'sonarr.Series', instance_key: 'Series', label: 'Check the Series connection', automation: 'automatic', execution: 'applied' }),
      task('still-needed', 'sonarr', { source: 'sonarr.Series', instance_key: 'Series', label: 'Choose the Series library folder' }),
    ]
    values.actionResults = { 'resolve-me': { recheck: { action: { execution: 'already_present', verification: 'passed' } } } }
    const { browser, page, errors } = await open(type, values)
    try {
      const panel = page.locator('[data-setup-status]')
      const resolved = await expandSetupTask(page, 'resolve-me')
      const recheck = resolved.getByRole('button', { name: 'Recheck', exact: true })
      await recheck.click()
      const result = resolved.getByRole('status')
      await result.waitFor()
      assert.match(await result.innerText(), /Checked successfully\. This result stays open until you close this task\./)
      assert.equal(await resolved.evaluate(element => element.open), true)
      assert.equal(await recheck.evaluate(element => document.activeElement === element), true, 'The completed result must not remove its focused control')
      assert.match(await panel.locator('[data-setup-summary]').innerText(), /1 required · 0 optional task needs attention.*1 checked/s)
      assert.equal(await panel.getByLabel('Task status', { exact: true }).inputValue(), 'attention')
      const requests = await page.evaluate(() => setupWizard.snapshot().requests)
      assert.deepEqual(requests.filter(request => request.method === 'action').map(request => request.payload.values.operation), ['recheck'])
      await resolved.locator('summary').first().click()
      await resolved.waitFor({ state: 'detached' })
      const status = panel.getByLabel('Task status', { exact: true })
      assert.equal(await status.evaluate(element => document.activeElement === element), true)
      assert.equal((await page.evaluate(() => setupWizard.snapshot().requests)).length, requests.length, 'Closing a result is presentation only')
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  test(name + ': closing an app group releases its resolved result and restores filter focus', { timeout: 30000 }, async () => {
    const values = input()
    values.run.actions = [task('group-result', 'sonarr', { source: 'sonarr.Series', instance_key: 'Series', label: 'Check the final Series connection', automation: 'automatic', execution: 'applied' })]
    values.actionResults = { 'group-result': { recheck: { action: { execution: 'already_present', verification: 'passed' } } } }
    const { browser, page, errors } = await open(type, values)
    try {
      const panel = page.locator('[data-setup-status]')
      const resolved = await expandSetupTask(page, 'group-result')
      await resolved.getByRole('button', { name: 'Recheck', exact: true }).click()
      await resolved.getByRole('status').waitFor()
      const group = panel.locator('[data-setup-group="sonarr.Series"]')
      assert.equal(await group.evaluate(element => element.open), true)
      assert.match(await panel.locator('[data-setup-summary]').innerText(), /No unfinished tasks.*1 checked/s)
      const before = await page.evaluate(() => setupWizard.snapshot().requests.length)
      await group.locator('summary').first().click()
      await group.waitFor({ state: 'detached' })
      await panel.locator('[data-setup-filter-empty]').waitFor()
      assert.equal(await panel.getByLabel('Task status', { exact: true }).evaluate(element => document.activeElement === element), true)
      assert.equal(await panel.locator('[data-setup-action-details]').count(), 0)
      assert.equal(await page.evaluate(() => setupWizard.snapshot().requests.length), before, 'Closing the app group must not repeat the check')
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })

  for (const destination of ['another task', 'another app']) {
    test(name + ': switching directly from a resolved result to ' + destination + ' preserves the new summary focus', { timeout: 30000 }, async () => {
      const values = input()
      values.actionResults = { 'saved-unchecked': { recheck: { action: { execution: 'already_present', verification: 'passed' } } } }
      const { browser, page, errors } = await open(type, values)
      try {
        const panel = page.locator('[data-setup-status]')
        const resolved = await expandSetupTask(page, 'saved-unchecked')
        await resolved.getByRole('button', { name: 'Recheck', exact: true }).click()
        await resolved.getByRole('status').waitFor()
        assert.equal(await resolved.evaluate(element => element.open), true)
        const before = await page.evaluate(() => setupWizard.snapshot().requests.length)

        // Click the rendered destination directly: opening groups through a
        // helper here would hide native details[name] event-ordering problems.
        const destinationGroup = panel.locator('[data-setup-group="infinidysk"]')
        const destinationTask = panel.locator('[data-setup-action="failed-check"]')
        const next = (destination === 'another app' ? destinationGroup : destinationTask).locator('summary').first()
        await next.click()
        if (destination === 'another app') await destinationGroup.locator(':scope > div').waitFor()
        else await destinationTask.locator('[data-setup-action-details]').waitFor()
        await resolved.waitFor({ state: 'detached' })
        assert.equal(await next.evaluate(element => document.activeElement === element), true, 'Closing the old resolved result must not redirect focus away from the new disclosure')
        assert.equal(await panel.getByLabel('Task status', { exact: true }).evaluate(element => document.activeElement === element), false)
        assert.equal(await page.evaluate(() => setupWizard.snapshot().requests.length), before)
        assert.deepEqual(errors, [])
      } finally { await browser.close() }
    })
  }
}
