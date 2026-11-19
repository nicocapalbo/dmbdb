import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium, firefox } from 'playwright'
import { createSetupWizardFixture } from '../support/setupWizardFixture.mjs'

let fixture
before(async () => { fixture = await createSetupWizardFixture() })
after(async () => { await fixture?.close() })

for (const [name, type, view] of [['chromium', chromium], ['firefox', firefox]].flatMap(([name, type]) => ['guided', 'checklist'].map(view => [name, type, view]))) {
  test(name + ': ' + view + ' handoff saves navigation before opening app configuration and retries without reinstalling', { timeout: 90000 }, async () => {
    const browser = await type.launch()
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => {
      const action = { id: 'plex::account', source: 'plex', service_key: 'plex', action: 'account', automation: 'manual', label: 'Sign in to Plex', required: true, execution: 'waiting_input', verification: 'not_checked', ui_url: '/services/Plex' }
      const services = [{ id: 'plex', service_key: 'plex', name: 'Plex', selection_kind: 'chosen' }]
      window.__setupWizardInput = {
        capabilities: { setup_arrangements: true, optional_only_onboarding: true },
        coreServices: [{ name: 'plex' }], coreCatalog: [{ key: 'plex', name: 'Plex', dependencies: [], service_options: {}, debrid_providers: [] }],
        plan: { plan_id: 'handoff-plan', services, actions: [action], arrangement_schema: { fields: [] }, checks: [] },
        run: { run_id: 'handoff-run', status: 'waiting_input', services, actions: [action], arrangement_schema: { fields: [] } },
        rejectOnboardingComplete: true,
      }
    })
    try {
      const button = view === 'checklist' ? 'Show full checklist' : 'Walk me through setup'
      const destination = view === 'checklist' ? '/setup-connections?view=checklist' : '/setup-connections'
      await page.goto(fixture.origin)
      await page.waitForFunction(() => window.setupWizard)
      await page.evaluate(() => setupWizard.jump('review'))
      await page.getByRole('heading', { name: 'Review your setup', exact: true }).waitFor()
      await page.waitForFunction(() => setupWizard.snapshot().plan && !setupWizard.snapshot().loading)
      await page.getByRole('button', { name: 'Start services', exact: true }).click()
      await page.locator('[data-setup-walkthrough-offer]').waitFor()
      assert.equal(await page.locator('[data-setup-full-checklist]').count(), 0, 'New users should not start with every task expanded')
      const logs = page.locator('details').filter({ has: page.getByText('Installation logs', { exact: true }) })
      assert.equal(await logs.evaluate(element => element.open), false)
      await page.getByRole('button', { name: button, exact: true }).click()
      await page.getByText(/Could not save the onboarding navigation preference/).waitFor()
      let state = await page.evaluate(() => setupWizard.snapshot())
      assert.equal(state.navigation, undefined, 'An unsaved completion flag would redirect app links back to onboarding')
      assert.notEqual(state.needsOnboarding, false)
      assert.equal(state.run.run_id, 'handoff-run')
      await page.evaluate(() => { window.__setupWizardInput.rejectOnboardingComplete = false })
      await page.getByRole('button', { name: button, exact: true }).click()
      await page.waitForFunction(expected => setupWizard.snapshot().navigation === expected, destination)
      state = await page.evaluate(() => setupWizard.snapshot())
      assert.equal(state.needsOnboarding, false)
      assert.equal(state.run.actions[0].execution, 'waiting_input', 'Finishing onboarding navigation must not finish a connection task')
      assert.equal(state.requests.filter(request => request.method === 'start').length, 1)
      assert.equal(state.requests.some(request => ['legacy-start', 'action', 'retry'].includes(request.method)), false)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })
}
