import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { chromium, firefox } from 'playwright'
import { createSettingsFixture } from '../support/settingsFixture.mjs'
let fixture
before(async () => { fixture = await createSettingsFixture() })
after(async () => { await fixture?.close() })

const open = async (type, { hash = '', storage = {}, denyStorage = false } = {}) => {
  const browser = await type.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin
      ? route.continue() : route.fulfill({status:200,contentType:'application/json',body:'[]'}))
    await page.addInitScript(values => { for (const [key,value] of Object.entries(values)) localStorage.setItem(key,value) }, storage)
    if (denyStorage) await page.addInitScript(() => { Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage denied','SecurityError')}}) })
    await page.goto(fixture.origin + '/settings' + hash)
    await page.waitForFunction(() => globalThis.settingsFixture?.ready)
    await page.getByTestId('settings-section-about').waitFor()
    return { browser, page, errors }
  } catch(error) { await browser.close(); throw error }
}
const section = (page,id) => page.getByTestId('settings-section-'+id)
const expanded = async (page,id) => section(page,id).getByRole('button').first().getAttribute('aria-expanded')
for (const [name,type] of [['Chromium',chromium],['Firefox',firefox]]) {
  test(name+': Settings defaults collapsed, backups sit below account controls and only user choices persist', {timeout:60000}, async () => {
    const {browser,page,errors}=await open(type,{storage:{'dmbdb.settings.section.about.open':'true','dmbdb.settings.section.backups.open':'false'}})
    try {
      const headings=page.locator('[data-testid^="settings-section-"] > .settings-section-heading button')
      for (const open of await headings.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-expanded')))) assert.equal(open,'false')
      const ids=await page.locator('[data-testid^="settings-section-"]').evaluateAll(nodes=>nodes.map(node=>node.id))
      assert.ok(ids.indexOf('backups')>ids.indexOf('advanced'))
      assert.ok(ids.indexOf('backups')>ids.indexOf('authentication'))
      assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(key=>key.endsWith('.user-choice'))),false)
      await section(page,'about').getByRole('button').first().click()
      assert.equal(await expanded(page,'about'),'true')
      await page.reload();await page.waitForFunction(()=>globalThis.settingsFixture?.ready)
      assert.equal(await expanded(page,'about'),'true')
      await section(page,'about').getByRole('button').first().click()
      await page.reload();await page.waitForFunction(()=>globalThis.settingsFixture?.ready)
      assert.equal(await expanded(page,'about'),'false')
      assert.deepEqual(errors,[])
    } finally { await browser.close() }
  })
  test(name+': denied browser storage leaves Settings controls usable without exceptions', {timeout:60000}, async () => {
    const {browser,page,errors}=await open(type,{denyStorage:true})
    try {
      assert.equal(await expanded(page,'about'),'false')
      await section(page,'about').getByRole('button').first().click()
      assert.equal(await expanded(page,'about'),'true')
      await section(page,'about').getByRole('button').first().click()
      assert.equal(await expanded(page,'about'),'false')
      assert.deepEqual(errors,[])
    } finally { await browser.close() }
  })
  test(name+': hash navigation temporarily reveals a section without changing a saved closed choice', {timeout:60000}, async () => {
    const saved=JSON.stringify({schema_version:1,user_applied:true,open:false})
    const {browser,page,errors}=await open(type,{hash:'#backups',storage:{'dmbdb.settings.section.backups.user-choice':saved}})
    try {
      assert.equal(await expanded(page,'backups'),'true')
      assert.equal(await page.evaluate(()=>localStorage.getItem('dmbdb.settings.section.backups.user-choice')),saved)
      await page.evaluate(()=>globalThis.settingsFixture.router.push('/settings#advanced'))
      await page.waitForFunction(()=>document.querySelector('#advanced button')?.getAttribute('aria-expanded')==='true')
      assert.equal(await expanded(page,'backups'),'false')
      await page.goBack()
      await page.waitForFunction(()=>document.querySelector('#backups button')?.getAttribute('aria-expanded')==='true')
      await page.evaluate(()=>globalThis.settingsFixture.router.push('/settings'))
      await page.waitForFunction(()=>document.querySelector('#backups button')?.getAttribute('aria-expanded')==='false')
      assert.equal(await page.evaluate(()=>localStorage.getItem('dmbdb.settings.section.backups.user-choice')),saved)
      assert.deepEqual(errors,[])
    } finally { await browser.close() }
  })
  test(name+': actual About and banner hide an older stable notice but keep genuine branch and pinned updates', {timeout:60000}, async () => {
    const {browser,page,errors}=await open(type,{hash:'#about'})
    try {
      await page.waitForFunction(()=>globalThis.settingsFixture.rawNotices().length===1)
      assert.equal(await page.getByRole('button',{name:'Stable release available',exact:false}).count(),0)
      assert.equal(await page.getByText('1 update available',{exact:true}).count(),0)
      const notice={type:'available',id:'branch',process_name:'DUMB Frontend',current_version:'1.92.0',available_version:'dev-fedcba12',configured_target_kind:'branch',configured_target_installed:false}
      await page.evaluate(row=>globalThis.settingsFixture.setNotices([row]),notice)
      await page.getByText('1 update available',{exact:true}).waitFor()
      await page.getByText('DUMB Frontend dev-fedcba12 is ready to review.',{exact:true}).waitFor()
      await page.getByRole('button',{name:'Update available',exact:true}).waitFor()
      await page.evaluate(row=>globalThis.settingsFixture.setNotices([{...row,id:'pinned',available_version:'v1.91.0',configured_target_kind:'release'}]),notice)
      await page.getByText('DUMB Frontend v1.91.0 is ready to review.',{exact:true}).waitFor()
      await page.evaluate(row=>globalThis.settingsFixture.setNotices([{...row,configured_target_installed:true}]),notice)
      await page.waitForFunction(()=>!document.body.textContent.includes('1 update available'))
      assert.deepEqual(errors,[])
    } finally { await browser.close() }
  })
  test(name+': Advanced reuses exact connected runtime evidence for a manually started disabled instance', {timeout:60000}, async () => {
    const {browser,page,errors}=await open(type,{hash:'#advanced'})
    try {
      const select=page.getByTestId('settings-utility-service')
      await select.selectOption('Manual Jellyfin')
      await page.getByTestId('settings-utility-library-protection').waitFor()
      await page.evaluate(()=>globalThis.settingsFixture.setStatusConnected(false))
      await page.waitForFunction(()=>!Array.from(document.querySelector('#settings-utility-service').options).some(option=>option.value==='Manual Jellyfin'))
      await page.evaluate(()=>{globalThis.settingsFixture.setRuntimeStatus('Manual Jellyfin - unrelated','running');globalThis.settingsFixture.setRuntimeStatus('Manual Jellyfin','stopped');globalThis.settingsFixture.setStatusConnected(true)})
      assert.equal(await select.locator('option[value="Manual Jellyfin"]').count(),0)
      assert.equal(await page.evaluate(()=>globalThis.settingsFixture.calls.length),0)
      assert.deepEqual(errors,[])
    } finally { await browser.close() }
  })
  test(name+': Advanced symlink shortcut opens the exact existing instance utility route', {timeout:60000}, async () => {
    const {browser,page,errors}=await open(type,{hash:'#advanced'})
    try {
      await page.getByTestId('settings-utility-service').selectOption('InfiniDysk')
      await page.getByTestId('settings-utility-symlinks').click()
      await page.getByTestId('navigated-service').waitFor()
      assert.equal(new URL(page.url()).pathname,'/services/InfiniDysk')
      assert.equal(new URL(page.url()).searchParams.get('utility'),'symlinks')
      assert.equal(await page.evaluate(()=>globalThis.settingsFixture.calls.length),0)
      assert.deepEqual(errors,[])
    } finally { await browser.close() }
  })
  test(name+': Advanced chooses an exact media-server instance and reuses its protection panel', {timeout:60000}, async () => {
    const {browser,page,errors}=await open(type,{hash:'#advanced'})
    try {
      // The utility catalog retains an explicitly configured inactive instance,
      // while unused default media-server configuration does not create a tool.
      assert.equal(await section(page,'advanced').getByText('Unused Jellyfin',{exact:true}).count(),0)
      const select=page.getByTestId('settings-utility-service')
      await select.waitFor()
      await select.selectOption('Plex Retained')
      await section(page,'advanced').getByRole('button',{name:'Media Protection',exact:false}).click()
      await page.waitForFunction(()=>globalThis.settingsFixture.calls.some(call=>call.kind==='policy'&&call.name==='Plex Retained'))
      assert.equal(await page.evaluate(()=>globalThis.settingsFixture.calls.some(call=>call.kind==='policy'&&call.name==='Plex Main')),false)
      assert.deepEqual(errors,[])
    } finally { await browser.close() }
  })
}
