import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const entry = `
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import VersionBox from '~/components/VersionBox.vue';
import { useProcessesStore } from '~/stores/processes.js';
window.useRuntimeConfig = () => ({ public: { appVersion: '1.91.0' } });
const app = createApp(VersionBox).use(createPinia());
window.versionFixture = { setProcesses: rows => { useProcessesStore().processesList = rows; } };
app.mount('#app');
`
let bundle

for (const [name, browserType] of [['chromium', chromium], ['firefox', firefox]]) {
  test(`${name}: actual version label follows validated installed metadata and clears replaced provenance`, { timeout: 60000 }, async () => {
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
      const label = page.getByTestId('frontend-version')
      await label.filter({ hasText: /^v1[.]91[.]0$/ }).waitFor()
      const source = { schema_version: 1, repository: 'nicocapalbo/dmbdb', source_kind: 'branch', requested_ref: 'dev', commit_sha: 'a'.repeat(40), package_version: '1.91.0' }
      const setSource = async value => page.evaluate(installed_source => window.versionFixture.setProcesses([{ config_key: 'dumb_frontend', config: { branch_enabled: false, branch: 'main', commit_sha: '' }, installed_source }]), value)
      await setSource(source)
      await label.filter({ hasText: 'v1.91.0 · dev aaaaaaaa' }).waitFor()
      assert.equal(await label.getAttribute('title'), `dev · ${'a'.repeat(40)}`)
      await setSource({ ...source, source_kind: 'commit', commit_sha: 'b'.repeat(40) })
      await label.filter({ hasText: 'v1.91.0 · commit bbbbbbbb' }).waitFor()
      await setSource(null)
      await label.filter({ hasText: /^v1[.]91[.]0$/ }).waitFor()
      assert.equal(await label.getAttribute('title'), null)
      await setSource({ ...source, package_version: '1.92.0' })
      await label.filter({ hasText: /^v1[.]91[.]0$/ }).waitFor()
      await setSource({ ...source, source_kind: 'release', requested_ref: 'v1.91.0' })
      await label.filter({ hasText: /^v1[.]91[.]0$/ }).waitFor()
      assert.deepEqual(errors, [])
    } finally {
      await browser?.close()
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
    }
  })
}
