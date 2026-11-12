import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const entry = "import { createApp, h, ref } from 'vue'; import Selector from '~/components/BackupStorageSelector.vue'; const selected = ref(''); const capabilities = ref({ backup_storage_selection: true, backup_storage_protocol: 1, backup_storage_kinds: ['symlink_manifest'] }); globalThis.setFixtureSharedCapability = enabled => { capabilities.value = { ...capabilities.value, backup_storage_shared_permissions: enabled } }; globalThis.setFixtureManagementCapability = enabled => { capabilities.value = { ...capabilities.value, backup_storage_profile_management: enabled, backup_storage_management_protocol: 1, backup_storage_revalidation: enabled } }; createApp({ render: () => h(Selector, { modelValue: selected.value, 'onUpdate:modelValue': value => { selected.value = value }, capabilities: capabilities.value }) }).mount('#app');"
const messages = {
  update: 'The registration could not be updated. Its saved settings were preserved.',
  remove: 'This destination is referenced by a saved schedule. Change that schedule before removing the registration.',
  check: 'The selected backup mount is missing or replaced. Reconnect the original storage, then check availability again.',
  runtime: 'This controller observed a changed mount identity after its last successful check.',
  revalidate: 'The mount review expired or storage changed. Review the mount again.',

  preview: 'The selected directory is not an existing mounted backup location.',
  save: 'The owned backup directory must enforce private mode 0700.',
  default: 'The selected backup destination is unavailable; reconnect the mount.',
  catalog: 'The backup storage catalog could not be read; retry after checking storage.',
}
let bundle
const fixture = async () => {
  bundle ||= await buildVueComponentHarness(entry)
  const profile = id => ({ id, name: id === 'archive' ? 'Primary archive' : 'Second archive', path: '/mnt/' + id, enabled: true, registered: true, ready: true, storage_type: 'network', filesystem_type: 'nfs', blockers: [] })
  const state = { calls: [], defaultId: 'archive', destinations: [profile('archive'), profile('archive2')], fail: '', requireShared: false, unavailable: false, runtimeChanged: false, removeBlocked: false, archiveFiles: ['retained-backup.tar'] }
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
    const profileMatch = pathname.match(/^\/api\/process\/backup-storage\/profiles\/([^/]+)(\/.*)?$/)
    const profileId = profileMatch ? decodeURIComponent(profileMatch[1]) : ''
    const suffix = profileMatch?.[2] || ''
    const existing = state.destinations.find(item => item.id === profileId)
    const kind = pathname === base ? 'catalog' : pathname === base + '/preview' ? 'preview' : pathname === base + '/profiles' ? 'save' : pathname === base + '/default' ? 'default'
      : profileMatch && request.method === 'PUT' && !suffix ? 'update'
        : profileMatch && request.method === 'DELETE' && !suffix ? 'remove'
          : suffix === '/check' ? 'check' : suffix === '/revalidate/preview' ? 'review' : suffix === '/revalidate' ? 'revalidate' : ''
    if (kind && state.fail === kind) { response.statusCode = 409; send({ detail: messages[kind] }); return }
    if (['preview', 'save'].includes(kind) && state.requireShared && body.allow_shared_permissions !== true) { response.statusCode = 409; send({ detail: messages.save }); return }
    if (kind === 'catalog') { send({ protocol: 1, default_destination_id: state.defaultId, destinations: state.destinations.map(item => ({ ...item, usage: item.id === state.defaultId ? [{ kind: 'global_default', label: 'Current global default' }] : item.usage || [] })) }); return }
    if (kind === 'preview') { send({ protocol: 1, ready: true, profile: { ...body, registered: false }, blockers: [], warnings: body.allow_shared_permissions ? ['Shared archive permissions require trusted mount ACLs.'] : [], observed_permissions: { directory_mode: '0777', file_mode: null } }); return }
    if (kind === 'save') { const saved = { ...profile(body.id), ...body }; state.destinations.push(saved); send({ protocol: 1, profile: saved }); return }
    if (kind === 'default') { state.defaultId = body.destination_id; send({ protocol: 1, default_destination_id: state.defaultId }); return }
    if (kind === 'update' && existing) {
      if (body.id !== profileId || body.path !== existing.path) { response.statusCode = 409; send({ detail: 'Registered destination identity and path must stay fixed.' }); return }
      Object.assign(existing, body); send({ protocol: 1, profile: existing }); return
    }
    const checkedProfile = () => {
      const ready = !state.unavailable && !state.runtimeChanged
      Object.assign(existing, { ready, live_checked: true, validation_state: ready ? 'ready' : 'blocked', checked_at: Math.floor(Date.now() / 1000), revalidation_required: state.runtimeChanged, blockers: ready ? [] : [state.unavailable ? messages.check : messages.runtime] })
      return existing
    }
    if (kind === 'check' && existing) { send({ protocol: 1, profile: checkedProfile(), checked_at: existing.checked_at, usage: existing.usage || [] }); return }
    if (kind === 'remove' && existing) {
      if (state.removeBlocked || state.defaultId === profileId) { response.statusCode = 409; send({ detail: messages.remove }); return }
      state.destinations = state.destinations.filter(item => item.id !== profileId)
      send({ protocol: 1, destination_id: profileId, removed: true, archives_preserved: true, receipts_preserved: true }); return
    }
    if (kind === 'review' && existing) {
      const descriptor = { path: existing.path, filesystem_type: 'nfs', storage_type: 'network', root_inode: 47, root_mode: 448, mount_signature: 'a'.repeat(64) }
      send({ protocol: 1, ready: !state.unavailable, token: 'private-mount-review-token', expires_at: state.reviewExpiry ?? Math.floor(Date.now() / 1000) + 300, revalidation_required: state.runtimeChanged, registered: { ...descriptor, root_device: 63 }, observed: { ...descriptor, root_device: 62 }, changes: ['The controller mount identity changed. Durable archive coordinates and the owned marker match.'], blockers: state.unavailable ? [messages.check] : [] }); return
    }
    if (kind === 'revalidate' && existing) {
      if (body.token !== 'private-mount-review-token' || body.confirm !== true) { response.statusCode = 409; send({ detail: messages.revalidate }); return }
      state.runtimeChanged = false; send({ protocol: 1, profile: checkedProfile() }); return
    }
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

  test(name + ': registered availability requires an explicit check and row errors survive refresh', { timeout: 45000 }, async () => {
    const app = await fixture(); let browser
    try {
      const opened = await open(type, app); browser = opened.browser; const page = opened.page
      const row = page.getByTestId('backup-destination-archive')
      await row.getByText('Not checked', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('backup-destination-check-archive').count(), 0)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/check')), false)
      await page.evaluate(() => globalThis.setFixtureManagementCapability(true))
      app.state.fail = 'check'
      await page.getByTestId('backup-destination-check-archive').click()
      await page.getByTestId('backup-destination-error-archive').filter({ hasText: messages.check }).waitFor()
      await page.getByRole('button', { name: 'Refresh destinations', exact: true }).click()
      await page.getByTestId('backup-destination-error-archive').filter({ hasText: messages.check }).waitFor()
      assert.equal(await row.getByText('Available at last check', { exact: true }).count(), 0)
      app.state.fail = ''; app.state.unavailable = true
      await page.getByTestId('backup-destination-check-archive').click()
      await row.getByText('Unavailable at last check', { exact: true }).waitFor()
      await row.getByText(messages.check, { exact: true }).waitFor()
      assert.equal(await page.getByTestId('backup-destination-error-archive').count(), 0)
      assert.equal(app.state.calls.some(call => call.method === 'PUT' || call.method === 'DELETE' || call.path.endsWith('/revalidate')), false)
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': edit keeps identity, registration drafts and failed input while saving only explicit metadata', { timeout: 45000 }, async () => {
    const app = await fixture(); let browser
    try {
      const opened = await open(type, app); browser = opened.browser; const page = opened.page
      await page.evaluate(() => globalThis.setFixtureManagementCapability(true))
      await page.getByText('Register a backup destination', { exact: true }).click()
      await page.getByTestId('backup-storage-id').fill('new_archive')
      await page.getByTestId('backup-storage-path').fill('/mnt/new-archive')
      await page.getByTestId('backup-storage-default').selectOption('archive2')
      await page.getByTestId('backup-destination-edit-archive2').click()
      await page.getByTestId('backup-destination-name-archive2').fill('Renamed archive')
      app.state.fail = 'update'
      await page.getByTestId('backup-destination-save-archive2').click()
      await page.getByTestId('backup-destination-error-archive2').filter({ hasText: messages.update }).waitFor()
      await page.getByRole('button', { name: 'Refresh destinations', exact: true }).click()
      await page.getByTestId('backup-destination-error-archive2').filter({ hasText: messages.update }).waitFor()
      assert.equal(await page.getByTestId('backup-destination-name-archive2').inputValue(), 'Renamed archive')
      assert.equal(await page.getByTestId('backup-storage-id').inputValue(), 'new_archive')
      assert.equal(await page.getByTestId('backup-storage-path').inputValue(), '/mnt/new-archive')
      assert.equal(await page.getByTestId('backup-storage-default').inputValue(), 'archive2')
      await page.getByTestId('backup-destination-cancel-archive2').click()
      assert.equal(await page.getByTestId('backup-destination-name-archive2').count(), 0)
      await page.getByTestId('backup-destination-edit-archive2').click()
      assert.equal(await page.getByTestId('backup-destination-name-archive2').inputValue(), 'Second archive')
      await page.getByTestId('backup-destination-name-archive2').fill('Renamed archive')
      app.state.fail = ''
      await page.getByTestId('backup-destination-save-archive2').click()
      await page.getByTestId('backup-destination-archive2').getByText('Renamed archive', { exact: false }).waitFor()
      const writes = app.state.calls.filter(call => call.method === 'PUT')
      assert.equal(writes.length, 2)
      assert.equal(writes.at(-1).body.path, '/mnt/archive2')
      assert.equal(writes.at(-1).body.id, 'archive2')
      assert.equal('make_default' in writes.at(-1).body, false)
      assert.equal(app.state.defaultId, 'archive')
      assert.equal(app.state.calls.some(call => call.path.endsWith('/default')), false)
      assert.equal(await page.getByTestId('backup-storage-id').inputValue(), 'new_archive')
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': remove registration preserves archives and saved selection and refuses references', { timeout: 45000 }, async () => {
    const app = await fixture(); let browser
    try {
      const opened = await open(type, app); browser = opened.browser; const page = opened.page
      await page.evaluate(() => globalThis.setFixtureManagementCapability(true))
      await page.getByTestId('backup-destination-check-archive').click()
      await page.getByTestId('backup-destination-archive').getByText('Available at last check', { exact: true }).waitFor()
      await page.getByTestId('backup-destination-remove-archive').click()
      await page.getByText('Restoring old backups requires registering the same destination ID and storage again.', { exact: false }).waitFor()
      assert.equal(await page.getByTestId('backup-destination-confirm-remove-archive').isDisabled(), true)
      assert.equal(app.state.calls.some(call => call.method === 'DELETE'), false)
      await page.getByTestId('backup-storage-clear-default').click()
      await page.getByTestId('backup-storage-current-default').filter({ hasText: 'No global default configured.' }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="backup-destination-confirm-remove-archive"]')?.disabled === false)
      await page.getByTestId('backup-storage-default').selectOption('archive')
      await page.getByTestId('backup-storage-save-default').click()
      await page.getByTestId('backup-storage-current-default').filter({ hasText: 'Primary archive (archive)' }).waitFor()
      await page.waitForFunction(() => document.querySelector('[data-testid="backup-destination-confirm-remove-archive"]')?.disabled === true)
      await page.getByTestId('backup-storage-selection').selectOption('archive2')
      await page.getByTestId('backup-destination-remove-archive2').click()
      app.state.removeBlocked = true
      await page.getByTestId('backup-destination-confirm-remove-archive2').click()
      await page.getByTestId('backup-destination-error-archive2').filter({ hasText: messages.remove }).waitFor()
      await page.getByRole('button', { name: 'Refresh destinations', exact: true }).click()
      await page.getByTestId('backup-destination-error-archive2').filter({ hasText: messages.remove }).waitFor()
      assert.equal(await page.getByTestId('backup-storage-selection').inputValue(), 'archive2')
      app.state.removeBlocked = false
      await page.getByTestId('backup-destination-confirm-remove-archive2').click()
      await page.getByText('archive2: Registration removed.', { exact: false }).waitFor()
      assert.equal(await page.getByTestId('backup-destination-archive2').count(), 0)
      assert.equal(await page.getByTestId('backup-storage-selection').inputValue(), 'archive2')
      assert.equal(app.state.defaultId, 'archive')
      assert.deepEqual(app.state.archiveFiles, ['retained-backup.tar'])
      assert.equal(app.state.calls.filter(call => call.method === 'DELETE').length, 2)
      assert.deepEqual(app.state.calls.filter(call => call.path.endsWith('/default')).map(call => call.body), [{ destination_id: '' }, { destination_id: 'archive' }])
    } finally { await browser?.close(); await app.close() }
  })

  test(name + ': mount refresh needs explicit backend review, fresh token and current capability', { timeout: 45000 }, async () => {
    const app = await fixture(); let browser
    try {
      const opened = await open(type, app); browser = opened.browser; const page = opened.page
      await page.evaluate(() => globalThis.setFixtureManagementCapability(true))
      await page.getByTestId('backup-destination-check-archive2').click()
      await page.getByTestId('backup-destination-archive2').getByText('Available at last check', { exact: true }).waitFor()
      assert.equal(await page.getByTestId('backup-destination-review-archive2').count(), 0)
      assert.equal(app.state.calls.some(call => call.path.includes('/revalidate')), false)
      app.state.runtimeChanged = true
      await page.getByTestId('backup-destination-check-archive2').click()
      await page.getByTestId('backup-destination-review-archive2').waitFor()
      app.state.reviewExpiry = Math.floor(Date.now() / 1000) - 1
      await page.getByTestId('backup-destination-review-archive2').click()
      await page.getByText('This mount review expired.', { exact: false }).waitFor()
      assert.equal(await page.getByTestId('backup-destination-confirm-mount-archive2').isDisabled(), true)
      app.state.reviewExpiry = Math.floor(Date.now() / 1000) + 300
      await page.getByTestId('backup-destination-review-archive2').click()
      assert.equal(await page.getByTestId('backup-destination-confirm-mount-archive2').isDisabled(), true)
      await page.getByTestId('backup-destination-mount-consent-archive2').check()
      await page.evaluate(() => globalThis.setFixtureManagementCapability(false))
      assert.equal(await page.getByTestId('backup-destination-confirm-mount-archive2').count(), 0)
      assert.equal(app.state.calls.some(call => call.path.endsWith('/revalidate')), false)
      await page.evaluate(() => globalThis.setFixtureManagementCapability(true))
      await page.getByTestId('backup-destination-review-archive2').click()
      await page.getByTestId('backup-destination-mount-consent-archive2').check()
      app.state.fail = 'revalidate'
      await page.getByTestId('backup-destination-confirm-mount-archive2').click()
      await page.getByTestId('backup-destination-error-archive2').filter({ hasText: messages.revalidate }).waitFor()
      assert.equal(await page.getByTestId('backup-destination-confirm-mount-archive2').count(), 0)
      app.state.fail = ''
      await page.getByTestId('backup-destination-review-archive2').click()
      await page.getByTestId('backup-destination-mount-consent-archive2').check()
      await page.getByTestId('backup-destination-confirm-mount-archive2').click()
      await page.getByTestId('backup-destination-archive2').getByText('Available at last check', { exact: true }).waitFor()
      const confirmations = app.state.calls.filter(call => call.path.endsWith('/revalidate'))
      assert.equal(confirmations.length, 2)
      assert.deepEqual(confirmations.at(-1).body, { token: 'private-mount-review-token', confirm: true })
      assert.equal(app.state.defaultId, 'archive')
    } finally { await browser?.close(); await app.close() }
  })
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
