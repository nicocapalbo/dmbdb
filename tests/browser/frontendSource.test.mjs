import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const entry = `
import { createApp, h, ref } from 'vue';
import AboutServiceVersion from '~/components/AboutServiceVersion.vue';
const service = ref({ process_name: 'DUMB Frontend', config_key: 'dumb_frontend', version: 'v1.91.0', repo_url: 'https://github.com/nicocapalbo/dmbdb/releases/tag/v1.91.0' });
window.versionFixture = { setService: row => { service.value = row; } };
createApp({ setup() { return () => h(AboutServiceVersion, { service: service.value }); } }).mount('#app');
`
let bundle

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: actual About version keeps API Dev build flags and release links while identifying frontend source`, { timeout: 60000 }, async () => {
    bundle ||= await buildVueComponentHarness(entry)
    const server = http.createServer((req, res) => {
      if (req.url === '/fixture.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle); return }
      if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'); return }
      res.statusCode = 404; res.end()
    })
    let browser
    try {
      server.listen(0, '127.0.0.1'); await once(server, 'listening')
      const origin = `http://127.0.0.1:${server.address().port}`
      browser = await browserType.launch({ headless: true })
      const page = await browser.newPage()
      await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
      const errors = []; page.on('pageerror', error => errors.push(error.message))
      await page.goto(origin)
      const label = page.getByTestId('about-service-version')
      const versionText = label.locator('span').last()
      const badge = page.getByTestId('about-dev-build')
      await versionText.filter({ hasText: /^v1[.]91[.]0$/ }).waitFor()
      const source = { schema_version: 1, repository: 'nicocapalbo/dmbdb', source_kind: 'branch', requested_ref: 'dev', commit_sha: 'a'.repeat(40), package_version: '1.91.0' }
      const repoUrl = 'https://github.com/nicocapalbo/dmbdb/releases/tag/v1.91.0'
      const setSource = async value => page.evaluate(installed_source => window.versionFixture.setService({ process_name: 'DUMB Frontend', config_key: 'dumb_frontend', version: 'v1.91.0', repo_url: 'https://github.com/nicocapalbo/dmbdb/releases/tag/v1.91.0', config: { branch_enabled: false, branch: 'main', commit_sha: '' }, installed_source }), value)
      assert.equal(await badge.count(), 0)
      await setSource(source)
      await versionText.filter({ hasText: 'v1.91.0 · dev aaaaaaaa' }).waitFor()
      assert.equal(await label.getAttribute('title'), `dev · ${'a'.repeat(40)}`)
      assert.equal(await label.getAttribute('href'), repoUrl)
      await badge.filter({ hasText: 'Dev build' }).waitFor()
      const badgeClass = await badge.getAttribute('class')
      await setSource({ ...source, source_kind: 'commit', commit_sha: 'b'.repeat(40) })
      await versionText.filter({ hasText: 'v1.91.0 · commit bbbbbbbb' }).waitFor()
      assert.equal(await label.getAttribute('title'), `commit · ${'b'.repeat(40)}`)
      assert.equal(await label.getAttribute('href'), repoUrl)
      await badge.filter({ hasText: 'Dev build' }).waitFor()
      await setSource(null)
      await versionText.filter({ hasText: /^v1[.]91[.]0$/ }).waitFor()
      assert.equal(await label.getAttribute('title'), null)
      assert.equal(await badge.count(), 0)
      await setSource({ ...source, package_version: '1.92.0' })
      await versionText.filter({ hasText: /^v1[.]91[.]0$/ }).waitFor()
      assert.equal(await badge.count(), 0)
      await setSource({ ...source, source_kind: 'release', requested_ref: 'v1.91.0' })
      await versionText.filter({ hasText: /^v1[.]91[.]0$/ }).waitFor()
      assert.equal(await label.getAttribute('href'), repoUrl)
      assert.equal(await badge.count(), 0)
      await page.evaluate(() => window.versionFixture.setService({ process_name: 'DUMB API', config_key: 'dumb_api_service', version: 'v2.24.0-dev.3', repo_url: 'https://github.com/I-am-PUID-0/DUMB' }))
      await versionText.filter({ hasText: 'v2.24.0-dev.3' }).waitFor()
      await badge.filter({ hasText: 'Dev build' }).waitFor()
      assert.equal(await badge.getAttribute('class'), badgeClass)
      assert.equal(await label.getAttribute('href'), 'https://github.com/I-am-PUID-0/DUMB')
      assert.deepEqual(errors, [])
    } finally {
      await browser?.close()
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
    }
  })
}
