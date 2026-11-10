import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const entry = "import { createApp, h, ref } from 'vue'; import Selector from '~/components/BackupStorageSelector.vue'; const selected = ref(''); const capabilities = ref({ backup_storage_selection: true, backup_storage_protocol: 1, backup_storage_kinds: ['symlink_manifest'] }); globalThis.setFixtureSharedCapability = enabled => { capabilities.value = { ...capabilities.value, backup_storage_shared_permissions: enabled } }; createApp({ render: () => h(Selector, { modelValue: selected.value, 'onUpdate:modelValue': value => { selected.value = value }, capabilities: capabilities.value }) }).mount('#app');"
const messages = {
  preview: 'The selected directory is not an existing mounted backup location.',
  save: 'The owned backup directory must enforce private mode 0700.',
  default: 'The selected backup destination is unavailable; reconnect the mount.',
  catalog: 'The backup storage catalog could not be read; retry after checking storage.',
}
let bundle
const fixture = async () => {
  bundle ||= await buildVueComponentHarness(entry)
  const profile = id => ({ id, name: id === 'archive' ? 'Primary archive' : 'Second archive', path: '/mnt/' + id, enabled: true, registered: true, ready: true, storage_type: 'network', filesystem_type: 'nfs', blockers: [] })
  const state = { calls: [], defaultId: 'archive', destinations: [profile('archive'), profile('archive2')], fail: '', requireShared: false }
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://fixture.invalid').pathname
    if (pathname === '/') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>'); return }
    if (pathname === '/fixture.js') { response.setHeader('content-type', 'text/javascript'); response.end(bundle); return }
    let raw = ''; for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : null
    state.calls.push({ path: pathname, method: request.method, body })
    response.setHeader('content-type', 'application/json')
    const send = value => response.end(JSON.stringify(value))
    const base = '/api/process/backup-storage'
    const kind = pathname === base ? 'catalog' : pathname === base + '/preview' ? 'preview' : pathname === base + '/profiles' ? 'save' : pathname === base + '/default' ? 'default' : ''
    if (kind && state.fail === kind) { response.statusCode = 409; send({ detail: messages[kind] }); return }
    if (['preview', 'save'].includes(kind) && state.requireShared && body.allow_shared_permissions !== true) { response.statusCode = 409; send({ detail: messages.save }); return }
    if (kind === 'catalog') { send({ protocol: 1, default_destination_id: state.defaultId, destinations: state.destinations }); return }
    if (kind === 'preview') { send({ protocol: 1, ready: true, profile: { ...body, registered: false }, blockers: [], warnings: body.allow_shared_permissions ? ['Shared archive permissions require trusted mount ACLs.'] : [], observed_permissions: { directory_mode: '0777', file_mode: null } }); return }
    if (kind === 'save') { const saved = { ...profile(body.id), ...body }; state.destinations.push(saved); send({ protocol: 1, profile: saved }); return }
    if (kind === 'default') { state.defaultId = body.destination_id; send({ protocol: 1, default_destination_id: state.defaultId }); return }
    response.statusCode = 404; send({ detail: 'Unknown fixture route' })
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { state, origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections() }) }
}
const open = async (type, app) => {
  const browser = await type.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.route('**/*', route => new URL(route.request().url()).origin === app.origin ? route.continue() : route.abort())
    await page.goto(app.origin)
    await page.getByTestId('backup-storage-current-default').waitFor()
    return { browser, page }
  } catch (error) { await browser.close(); throw error }
}

for (const [name, type] of [['Chromium', chromium], ['Firefox', firefox]]) {
  test(name + ': global default is visible before registration and set/clear failures preserve the draft', { timeout: 45000 }, async () => {
    const app = await fixture(); let browser
    try {
      const opened = await open(type, app); browser = opened.browser; const page = opened.page
      const current = page.getByTestId('backup-storage-current-default')
      assert.match(await current.innerText(), /Primary archive \(archive\)/)
      assert.equal(await page.locator('details').evaluate(element => element.open), false)
      assert.equal(await page.getByTestId('backup-storage-default-management').isVisible(), true)
      assert.equal(app.state.calls.filter(call => call.method === 'POST').length, 0)
      const draft = page.getByTestId('backup-storage-default')
      await draft.selectOption('archive2'); app.state.fail = 'default'
      const reads = app.state.calls.length
      await page.getByTestId('backup-storage-save-default').click()
      await page.getByTestId('backup-storage-error').filter({ hasText: messages.default }).waitFor()
      assert.equal(app.state.calls.length, reads + 1)
      assert.equal(await draft.inputValue(), 'archive2')
      assert.match(await current.innerText(), /Primary archive/)
      await page.getByTestId('backup-storage-clear-default').click()
      await page.getByTestId('backup-storage-error').filter({ hasText: messages.default }).waitFor()
      assert.equal(await draft.inputValue(), 'archive2')
      app.state.fail = ''
      await page.getByTestId('backup-storage-save-default').click()
      await current.filter({ hasText: 'Second archive (archive2)' }).waitFor()
      assert.equal(app.state.defaultId, 'archive2')
      await page.getByTestId('backup-storage-clear-default').click()
      await current.filter({ hasText: 'No global default configured.' }).waitFor()
      assert.equal(app.state.defaultId, '')
      assert.equal(await page.getByTestId('backup-storage-selection').inputValue(), '')
      assert.equal(app.state.calls.some(call => call.path.endsWith('/profiles')), false)
      assert.deepEqual(app.state.calls.filter(call => call.method === 'POST').map(call => call.body), [{ destination_id: 'archive2' }, { destination_id: '' }, { destination_id: 'archive2' }, { destination_id: '' }])
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': probe and registration errors remain visible through catalog failures without losing input', { timeout: 45000 }, async () => {
    const app = await fixture(); let browser
    try {
      const opened = await open(type, app); browser = opened.browser; const page = opened.page
      await page.getByText('Register a backup destination', { exact: true }).click()
      await page.getByTestId('backup-storage-id').fill('archive3')
      await page.getByTestId('backup-storage-name').fill('Third archive')
      await page.getByTestId('backup-storage-path').fill('/mnt/archive3')
      await page.getByTestId('backup-storage-default').selectOption('archive2')
      app.state.fail = 'preview'; await page.getByTestId('backup-storage-preview').click()
      await page.getByTestId('backup-storage-error').filter({ hasText: messages.preview }).waitFor()
      assert.equal(await page.getByTestId('backup-storage-register').isEnabled(), false)
      app.state.fail = ''; await page.getByTestId('backup-storage-preview').click()
      await page.getByText('Metadata checks passed.', { exact: false }).waitFor()
      app.state.fail = 'save'; const reads = app.state.calls.length
      await page.getByTestId('backup-storage-register').click()
      await page.getByTestId('backup-storage-error').filter({ hasText: messages.save }).waitFor()
      assert.equal(app.state.calls.length, reads + 1)
      app.state.fail = 'catalog'; await page.getByRole('button', { name: 'Refresh destinations', exact: true }).click()
      await page.getByTestId('backup-storage-catalog-error').filter({ hasText: messages.catalog }).waitFor()
      assert.equal(await page.getByTestId('backup-storage-error').innerText(), messages.save)
      assert.equal(await page.getByTestId('backup-storage-id').inputValue(), 'archive3')
      assert.equal(await page.getByTestId('backup-storage-name').inputValue(), 'Third archive')
      assert.equal(await page.getByTestId('backup-storage-path').inputValue(), '/mnt/archive3')
      assert.equal(await page.getByTestId('backup-storage-default').inputValue(), 'archive2')
      app.state.fail = ''; await page.getByTestId('backup-storage-register').click()
      await page.getByText('Destination registered. Existing service paths and defaults were preserved.', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('backup-storage-error').count(), 0)
      assert.equal(await page.getByTestId('backup-storage-catalog-error').count(), 0)
      assert.equal(await page.getByTestId('backup-storage-default').inputValue(), 'archive2')
      assert.equal(app.state.defaultId, 'archive')
      assert.equal(app.state.calls.some(call => call.path.endsWith('/default')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': shared archive registration requires visible explicit consent and invalidates prior reviews', { timeout: 45000 }, async () => {
    const app = await fixture(); let browser
    try {
      const opened = await open(type, app); browser = opened.browser; const page = opened.page
      await page.getByText('Register a backup destination', { exact: true }).click()
      await page.getByTestId('backup-storage-id').fill('archive3')
      await page.getByTestId('backup-storage-path').fill('/mnt/archive3')
      assert.equal(await page.getByTestId('backup-storage-shared-permissions').count(), 0)
      await page.getByTestId('backup-storage-preview').click()
      await page.getByText('Metadata checks passed.', { exact: false }).waitFor()
      assert.equal('allow_shared_permissions' in app.state.calls.at(-1).body, false)
      assert.equal(app.state.calls.at(-1).body.name, 'archive3')
      await page.evaluate(() => globalThis.setFixtureSharedCapability(true))
      const consent = page.getByTestId('backup-storage-shared-permissions')
      await consent.waitFor(); assert.equal(await consent.isChecked(), false)
      assert.equal(await page.getByTestId('backup-storage-register').isEnabled(), false)
      app.state.requireShared = true
      await page.getByTestId('backup-storage-preview').click()
      await page.getByTestId('backup-storage-error').filter({ hasText: messages.save }).waitFor()
      assert.equal(app.state.calls.at(-1).body.allow_shared_permissions, false)
      await consent.check()
      await page.getByTestId('backup-storage-preview').click()
      await page.getByText('Shared archive permissions require trusted mount ACLs.', { exact: true }).waitFor()
      await page.getByText('Permission details', { exact: true }).click()
      await page.getByText(/Observed directory mode: 0777/).waitFor()
      assert.equal(app.state.calls.at(-1).body.allow_shared_permissions, true)
      await consent.uncheck(); assert.equal(await page.getByTestId('backup-storage-register').isEnabled(), false)
      await consent.check(); await page.getByTestId('backup-storage-preview').click()
      await page.getByText('Metadata checks passed.', { exact: false }).waitFor()
      await page.getByTestId('backup-storage-register').click()
      await page.getByText('Destination registered. Existing service paths and defaults were preserved.', { exact: true }).waitFor()
      await page.getByTestId('backup-storage-selection').selectOption('archive3')
      await page.getByText(/Shared archive permissions were explicitly accepted/).waitFor()
      assert.equal(app.state.destinations.at(-1).allow_shared_permissions, true)
      assert.equal(app.state.defaultId, 'archive')
      assert.equal(app.state.calls.some(call => call.path.endsWith('/default')), false)
    } finally { await browser?.close(); await app.close() }
  })
}
