import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium, firefox } from 'playwright'
import { createOnboardingBrowserFixture } from '../support/onboardingBrowserFixture.mjs'

let fixture
before(async () => { fixture = await createOnboardingBrowserFixture() })
after(async () => { await fixture?.close() })

const metadata = (key, name, supportsInstances = false) => ({
  key,
  name,
  description: `${name} fixture description. Documentation: https://example.test/${key}`,
  supports_instances: supportsInstances,
  dependencies: [],
  service_options: {},
})
const mediaStormDescription = [
  "mediastorm",
  "- Fully self-hosted streaming server for Debrid, Torrent, and Usenet sources.",
  "- Includes an admin UI and browser player plus native mobile and TV clients.",
  "- Uses DUMB-managed PostgreSQL for accounts, watch history, and playback state.",
  "- Current builds use `admin` / `admin` for first login and require a replacement password during",
  "  that same sign-in before creating the first admin session.",
  "",
  "Documentation: https://dumbarr.com/services/optional/mediastorm"
].join('\n')
const coreDescription = [
  "Radarr",
  "- Movie management and automation tool.",
  "- Organizes movie files under `/media/movies` and preserves your library",
  "  when changing quality profiles.",
  "",
  "Documentation: https://example.test/services/radarr"
].join('\n')
const untrustedDescription = [
  "Untrusted backend description",
  "",
  "<img src=\"https://example.test/description-probe\" onerror=\"window.__descriptionExecuted = true\">",
  "<script>window.__descriptionExecuted = true</script>",
  "<iframe src=\"https://example.test/description-probe\"></iframe>",
  "",
  "![remote image](https://example.test/description-probe)",
  "[unsafe JavaScript](javascript:window.__descriptionExecuted=true)",
  "[unsafe data](data:text/html,description-probe)",
  "",
  "Documentation: https://example.test/safe-guide"
].join('\n')

const optionalCatalog = [
  metadata('future_zenith', 'Zenith utility'),
  metadata('zilean', 'Zilean'),
  metadata('tautulli', 'Tautulli'),
  metadata('traefik_proxy_admin', 'Traefik Proxy Admin'),
  metadata('riven_frontend', 'Riven Frontend'),
  metadata('pulsarr', 'Pulsarr'),
  metadata('postgres', 'Postgres'),
  metadata('pgadmin', 'PgAdmin'),
  { ...metadata('mediastorm', 'mediastorm'), description: mediaStormDescription },
  metadata('maintainerr', 'Maintainerr'),
  metadata('cloudflared', 'Cloudflared'),
  metadata('bazarr', 'Bazarr'),
  metadata('authelia', 'Authelia'),
  metadata('audiobookshelf', 'Audiobookshelf'),
  metadata('aiostreams', 'AIOStreams'),
  metadata('future_amber', 'Amber utility'),
]
const coreCatalog = [
  metadata('whisparr', 'Whisparr', true),
  metadata('sonarr', 'Sonarr', true),
  metadata('seerr', 'Seerr', true),
  metadata('riven_backend', 'Riven'),
  { ...metadata('radarr', 'Radarr', true), description: coreDescription },
  metadata('prowlarr', 'Prowlarr', true),
  metadata('profilarr', 'Profilarr', true),
  metadata('plex', 'Plex Media Server'),
  metadata('neutarr', 'NeutArr', true),
  metadata('lidarr', 'Lidarr', true),
  metadata('jellyfin', 'Jellyfin Media Server'),
  metadata('infinidysk', 'InfiniDysk'),
  metadata('emby', 'Emby Media Server'),
  metadata('decypharr', 'Decypharr'),
  metadata('cli_debrid', 'CLID'),
  metadata('altmount', 'AltMount'),
]
const categories = page => page.locator('details[data-service-category]')
const category = (page, key) => page.locator(`details[data-service-category="${key}"]`)
const summary = group => group.locator(':scope > summary')
const checkbox = (page, name) => page.getByRole('checkbox', { name, exact: true })
const serviceDetails = (page, name) => page.locator('details[data-service-category] details')
  .filter({ has: page.locator('summary').filter({ hasText: name }) }).last()
const snapshot = page => page.evaluate(() => window.onboardingFixture.snapshot())

async function openFixture(browserType, input) {
  const browser = await browserType.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
    const errors = []
    const externalRequests = []
    page.on('request', request => {
      if (new URL(request.url()).origin !== fixture.origin) externalRequests.push(request.url())
    })
    await page.route('**/*', route => {
      if (new URL(route.request().url()).origin === fixture.origin) return route.continue()
      return route.abort()
    })
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(value => {
      window.__onboardingFixtureInput = value
      window.__descriptionExecuted = false
    }, input)
    await page.goto(fixture.origin)
    await page.waitForFunction(() => window.onboardingFixture)
    await page.waitForFunction(() => document.querySelector('details[data-service-category]') || /Failed to load/.test(document.body.textContent))
    assert.equal(errors.length, 0, errors.join('\n'))
    assert.equal(await page.locator('details[data-service-category]').count() > 0, true, await page.locator('body').innerText())
    return { browser, page, errors, externalRequests }
  } catch (error) {
    await browser.close()
    throw error
  }
}
async function assertAlphabetical(page, catalog) {
  const groups = await categories(page).evaluateAll((nodes, services) => nodes.map(group => {
    const summaries = [...group.querySelectorAll('summary')]
    const names = summaries.slice(1).map(row =>
      services.find(service => row.textContent.includes(service.name))?.name
    )
    return {
      title: summaries[0].querySelector('.font-semibold').textContent.trim(),
      names,
    }
  }), catalog)
  const compare = (left, right) => left.localeCompare(right, 'en', { sensitivity: 'base' })
  assert.deepEqual(groups.map(group => group.title), groups.map(group => group.title).sort(compare))
  for (const group of groups) {
    assert.ok(group.names.every(Boolean), `Every rendered service has its catalog label in ${group.title}`)
    assert.deepEqual(group.names, [...group.names].sort(compare), group.title)
  }
}

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: actual optional-service categories keep selection, enabled entries and keyboard controls`, { timeout: 90000 }, async () => {
    const { browser, page, errors } = await openFixture(browserType, {
      step: 'optional',
      coreCatalog: [],
      optionalCatalog,
      config: { audiobookshelf: { enabled: true } },
      capabilities: { authelia_integration: true },
      userServiceOptions: { aiostreams: { port: 3006 } },
    })
    try {
      await assertAlphabetical(page, optionalCatalog)
      assert.equal(await categories(page).count(), 7)
      assert.equal(await page.locator('details[data-service-category][open]').count(), 0)
      const other = category(page, 'other-services')
      assert.match(await summary(other).textContent(), /Other services/)
      assert.match(await summary(category(page, 'media-playback')).textContent(), /1 already enabled/)

      // Native summary keyboard behavior remains available around nested service details.
      const playback = category(page, 'media-playback')
      await summary(playback).focus()
      await page.keyboard.press('Enter')
      await page.waitForFunction(() => document.querySelector('[data-service-category="media-playback"]').open)
      assert.equal(await checkbox(page, 'Audiobookshelf').count(), 0)
      assert.equal(await playback.getByText('already enabled', { exact: false }).count() >= 1, true)
      await checkbox(page, 'AIOStreams').focus()
      await page.keyboard.press('Space')
      await page.waitForFunction(() => window.onboardingFixture.snapshot().optionalServices.includes('aiostreams'))
      assert.match(await summary(playback).textContent(), /1 selected/)

      const beforeToggle = await snapshot(page)
      await page.getByRole('button', { name: 'Collapse all', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('details[data-service-category][open]'))
      assert.deepEqual((await snapshot(page)).optionalServices, ['aiostreams'])
      assert.match(await summary(playback).textContent(), /1 selected/)
      await page.getByRole('button', { name: 'Expand all', exact: true }).click()
      await page.waitForFunction(() => [...document.querySelectorAll('details[data-service-category]')].every(group => group.open))
      assert.equal(await checkbox(page, 'AIOStreams').isChecked(), true)
      assert.equal(await checkbox(page, 'Amber utility').isVisible(), true)
      assert.deepEqual((await snapshot(page)).reviewPayload, beforeToggle.reviewPayload)
      assert.deepEqual((await snapshot(page)).userServiceOptions, beforeToggle.userServiceOptions)
      assert.equal((await snapshot(page)).metadataUnchanged, true)
      assert.deepEqual(errors, [])
      if (name === 'chromium' && process.env.DUMB_ONBOARDING_SCREENSHOTS === '1') {
        await checkbox(page, 'mediastorm').check()
        await page.screenshot({ path: '/tmp/onboarding-categories-optional.png', fullPage: true })
      }
    } finally {
      await browser.close()
    }
  })


  test(`${name}: onboarding descriptions retain lists, paragraphs and code without activating backend markup`, { timeout: 90000 }, async () => {
    for (const alreadyEnabled of [false, true]) {
      const { browser, page, errors, externalRequests } = await openFixture(browserType, {
        step: 'optional',
        coreCatalog: [],
        optionalCatalog: [
          { ...metadata('mediastorm', 'mediastorm'), description: mediaStormDescription },
          { ...metadata('future_markup', 'Untrusted utility'), description: untrustedDescription },
        ],
        config: { mediastorm: { enabled: alreadyEnabled } },
      })
      try {
        await page.getByRole('button', { name: 'Expand all', exact: true }).click()
        const storm = serviceDetails(page, 'mediastorm')
        if (!await storm.evaluate(element => element.open)) await summary(storm).click()
        assert.equal(await checkbox(page, 'mediastorm').count(), alreadyEnabled ? 0 : 1)
        assert.equal(await storm.locator('ul').count(), 1)
        const items = await storm.locator('ul > li').allInnerTexts()
        assert.equal(items.length, 4)
        assert.match(items[0], /^Fully self-hosted streaming server/)
        assert.match(items[3].replace(/\s+/g, ' '), /password during that same sign-in before creating the first admin session\./)
        assert.doesNotMatch(items[3], /Documentation:/)
        assert.deepEqual(await storm.locator('li').last().locator('code').allTextContents(), ['admin', 'admin'])
        assert.equal(await storm.locator('p').filter({ hasText: /^mediastorm$/ }).count(), 1)
        const documentation = storm.locator('p').filter({ hasText: /^Documentation:/ })
        assert.equal(await documentation.count(), 1)
        const link = documentation.getByRole('link', { name: 'https://dumbarr.com/services/optional/mediastorm', exact: true })
        assert.equal(await link.getAttribute('href'), 'https://dumbarr.com/services/optional/mediastorm')
        assert.equal(await link.getAttribute('target'), '_blank')
        assert.match(await link.getAttribute('rel'), /noopener/)
        assert.match(await link.getAttribute('rel'), /noreferrer/)

        const untrusted = serviceDetails(page, 'Untrusted utility')
        await summary(untrusted).click()
        assert.equal(await untrusted.locator('img, script, iframe, svg, object, embed').count(), 0)
        assert.equal(await untrusted.locator('[onerror], [onload], [onclick], [srcdoc]').count(), 0)
        assert.match(await untrusted.innerText(), /<img src=/)
        assert.match(await untrusted.innerText(), /<script>window\.__descriptionExecuted = true<\/script>/)
        const links = await untrusted.locator('a').evaluateAll(anchors => anchors.map(anchor => ({
          href: anchor.getAttribute('href'), protocol: new URL(anchor.href).protocol,
        })))
        assert.ok(links.length > 0)
        assert.ok(links.every(anchor => ['http:', 'https:'].includes(anchor.protocol)), JSON.stringify(links))
        assert.equal(await untrusted.getByRole('link', { name: 'unsafe JavaScript', exact: true }).count(), 0)
        assert.equal(await untrusted.getByRole('link', { name: 'unsafe data', exact: true }).count(), 0)
        assert.equal(await page.evaluate(() => window.__descriptionExecuted), false)
        assert.deepEqual(externalRequests, [])
        assert.equal((await snapshot(page)).metadataUnchanged, true)
        assert.deepEqual(errors, [])
      } finally {
        await browser.close()
      }
    }
  })

  test(`${name}: category grouping preserves optional catalog intersection and older-backend gates`, { timeout: 90000 }, async () => {
    const shared = ['bazarr', 'authelia', 'tautulli']
    const byKey = key => optionalCatalog.find(service => service.key === key)
    const { browser, page, errors } = await openFixture(browserType, {
      step: 'optional',
      coreCatalog,
      coreServices: [{ name: 'radarr', instance_name: 'Movies' }, { name: 'sonarr', instance_name: 'TV' }],
      optionalServices: ['pulsarr', 'authelia', 'aiostreams', 'bazarr'],
      optionalCatalog,
      optionalByCore: {
        radarr: ['aiostreams', ...shared].map(byKey),
        sonarr: ['pulsarr', ...shared].map(byKey),
      },
      config: { tautulli: { enabled: true } },
      capabilities: {},
    })
    try {
      await page.getByRole('button', { name: 'Expand all', exact: true }).click()
      const state = await snapshot(page)
      assert.deepEqual(state.optionalServices, ['bazarr'])
      assert.equal(await checkbox(page, 'Bazarr').isChecked(), true)
      for (const hidden of ['AIOStreams', 'Authelia', 'Pulsarr', 'Tautulli']) {
        assert.equal(await checkbox(page, hidden).count(), 0, hidden)
      }
      assert.match(await summary(category(page, 'utilities-interfaces')).textContent(), /1 already enabled/)
      const calls = state.requests.filter(request => request.kind === 'optional')
      assert.deepEqual(calls.map(request => request.core).sort(), ['radarr', 'sonarr'])
      assert.ok(calls.every(request => JSON.stringify(request.preferred) === JSON.stringify(['pulsarr', 'authelia', 'aiostreams', 'bazarr'])))
      assert.equal(state.metadataUnchanged, true)
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  })

  test(`${name}: actual core categories preserve instance validation and reveal guided recommendations`, { timeout: 90000 }, async () => {
    const { browser, page, errors } = await openFixture(browserType, {
      step: 'core',
      coreCatalog,
      coreServices: [{ name: 'radarr', instance_name: '' }, { name: 'sonarr', instance_name: 'TV' }],
      config: { emby: { enabled: true }, radarr: { instances: { Existing: { enabled: true } } } },
      capabilities: { optional_only_onboarding: true },
      userServiceOptions: { 'sonarr::TV': { port: 8989 } },
    })
    try {
      await assertAlphabetical(page, coreCatalog)
      assert.equal(await checkbox(page, 'Emby Media Server').count(), 0)
      const automation = category(page, 'library-automation')
      assert.equal(await automation.evaluate(group => group.open), true)
      assert.equal((await snapshot(page)).instanceNameBlocked, true)
      assert.match(await summary(automation).textContent(), /1 needs attention/)

      const radarrDescription = serviceDetails(page, 'Radarr').locator('.not-prose')
      assert.equal(await radarrDescription.locator('ul').count(), 1)
      const descriptionItems = await radarrDescription.locator('ul > li').allInnerTexts()
      assert.equal(descriptionItems.length, 2)
      assert.match(descriptionItems[1].replace(/\s+/g, ' '), /preserves your library when changing quality profiles\./)
      assert.deepEqual(await radarrDescription.locator('code').allTextContents(), ['/media/movies'])
      assert.equal(await radarrDescription.locator('p').filter({ hasText: /^Radarr$/ }).count(), 1)
      assert.equal(await radarrDescription.locator('p').filter({ hasText: /^Documentation:/ }).count(), 1)
      assert.equal(await radarrDescription.getByRole('link', { name: 'https://example.test/services/radarr', exact: true }).getAttribute('href'), 'https://example.test/services/radarr')
      const radarrName = page.getByRole('textbox', { name: 'Radarr instance 1 name', exact: true })
      await radarrName.fill('Existing')
      await page.waitForFunction(() => window.onboardingFixture.snapshot().coreServices[0].instance_name === 'Existing')
      assert.equal((await snapshot(page)).instanceNameBlocked, true)
      await radarrName.fill('Movies')
      await page.waitForFunction(() => !window.onboardingFixture.snapshot().instanceNameBlocked)
      const radarrDetails = page.locator('details').filter({ has: checkbox(page, 'Radarr') }).last()
      await radarrDetails.getByRole('button', { name: 'Add another instance', exact: true }).click()
      assert.equal((await snapshot(page)).instanceNameBlocked, true)
      const secondName = page.getByRole('textbox', { name: 'Radarr instance 2 name', exact: true })
      await secondName.fill('Movies')
      await page.waitForFunction(() => window.onboardingFixture.snapshot().coreServices.filter(service => service.name === 'radarr')[1]?.instance_name === 'Movies')
      assert.equal((await snapshot(page)).instanceNameBlocked, true)
      await secondName.fill('4K')
      await page.waitForFunction(() => !window.onboardingFixture.snapshot().instanceNameBlocked)
      const beforeCollapseState = await snapshot(page)
      const beforeCollapse = beforeCollapseState.coreServices
      await page.getByRole('button', { name: 'Collapse all', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('details[data-service-category][open]'))
      assert.deepEqual((await snapshot(page)).coreServices, beforeCollapse)
      assert.equal((await snapshot(page)).instanceNameBlocked, false)
      await summary(automation).focus()
      await page.keyboard.press('Space')
      await page.waitForFunction(() => document.querySelector('[data-service-category="library-automation"]').open)
      assert.equal(await radarrName.inputValue(), 'Movies')
      assert.equal(await secondName.inputValue(), '4K')
      assert.deepEqual((await snapshot(page)).reviewPayload, beforeCollapseState.reviewPayload)
      assert.deepEqual((await snapshot(page)).userServiceOptions, beforeCollapseState.userServiceOptions)

      await checkbox(page, 'Radarr').uncheck()
      await page.waitForFunction(() => !window.onboardingFixture.snapshot().coreServices.some(service => service.name === 'radarr'))
      assert.deepEqual((await snapshot(page)).coreServices, [{ name: 'sonarr', instance_name: 'TV' }])
      await checkbox(page, 'Radarr').check()
      await page.waitForFunction(() => window.onboardingFixture.snapshot().instanceNameBlocked)
      assert.equal(await radarrName.inputValue(), '')
      // Invalid collapsed groups still contribute to the parent Next-button guard.
      await page.getByRole('button', { name: 'Collapse all', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('details[data-service-category][open]'))
      assert.equal((await snapshot(page)).instanceNameBlocked, true)
      assert.match(await summary(automation).textContent(), /1 needs attention/)

      await page.getByRole('button', { name: 'Apply recommendations', exact: true }).click()
      await page.waitForFunction(() => window.onboardingFixture.snapshot().coreServices.some(service => service.name === 'plex'))
      const state = await snapshot(page)
      assert.ok(state.coreServices.some(service => service.name === 'plex'))
      assert.ok(state.coreServices.some(service => service.name === 'decypharr'))
      assert.ok(state.coreServices.some(service => service.name === 'radarr'))
      const selectedGroups = await page.locator('details[data-service-category]').evaluateAll(groups =>
        groups.filter(group => Number(group.querySelector('summary').textContent.match(/([0-9]+) selected/)?.[1]) > 0)
          .map(group => ({ key: group.dataset.serviceCategory, open: group.open }))
      )
      assert.ok(selectedGroups.length > 0)
      assert.ok(selectedGroups.every(group => group.open), JSON.stringify(selectedGroups))
      assert.equal(state.guidedApplied, true)
      assert.equal(state.guidedWorkflowIntent.stack, 'debrid')
      await page.getByRole('button', { name: 'Collapse all', exact: true }).click()
      await page.waitForFunction(() => !document.querySelector('details[data-service-category][open]'))
      await page.getByRole('button', { name: 'Apply recommendations', exact: true }).click()
      await page.waitForFunction(() => [...document.querySelectorAll('details[data-service-category]')]
        .filter(group => Number(group.querySelector('summary').textContent.match(/([0-9]+) selected/)?.[1]) > 0)
        .every(group => group.open))
      const repeated = await snapshot(page)
      assert.equal(repeated.guidedApplied, true)
      assert.deepEqual(repeated.guidedWorkflowIntent, state.guidedWorkflowIntent)
      assert.deepEqual(repeated.reviewPayload, state.reviewPayload)
      assert.equal(state.instanceNameBlocked, false)
      assert.equal(state.metadataUnchanged, true)
      assert.deepEqual(errors, [])
      if (name === 'chromium' && process.env.DUMB_ONBOARDING_SCREENSHOTS === '1') {
        await checkbox(page, 'Enable guided mode').uncheck()
        await page.getByRole('button', { name: 'Expand all', exact: true }).click()
        await page.screenshot({ path: '/tmp/onboarding-categories-core.png', fullPage: true })
      }
      await checkbox(page, 'Jellyfin Media Server').check()
      await page.waitForFunction(() => window.onboardingFixture.snapshot().guidedApplied === false)
      assert.equal((await snapshot(page)).guidedWorkflowIntent, null)
      assert.ok((await snapshot(page)).coreServices.some(service => service.name === 'jellyfin'))
    } finally {
      await browser.close()
    }
  })
}
