import assert from 'node:assert/strict'
import { before,after,test } from 'node:test'
import {chromium,firefox} from 'playwright'
import {createSetupRecoveryFixture} from '../support/setupRecoveryFixture.mjs'
let fixture
before(async()=>{fixture=await createSetupRecoveryFixture()})
after(async()=>{await fixture?.close()})
async function open(type,state={}){
  fixture.reset(state)
  const browser=await type.launch()
  const page=await browser.newPage()
  await page.goto(fixture.origin)
  await page.waitForFunction(()=>window.setupRecovery)
  return {browser,page}
}
for(const [name,type]of[['Chromium',chromium],['Firefox',firefox]]){
  test(name+' clean missing setup hides panel; real storage503 preserves distinction and manual retry loads run',async()=>{
    const {browser,page}=await open(type)
    try{
      await page.waitForFunction(()=>window.setupRecovery.snapshot().lookupState==='empty')
      assert.equal(await page.locator('[data-setup-status]').count(),0)
      fixture.state.runStatus=503
      fixture.state.runDetail={code:'setup_storage_unavailable',controller_uid:0,configured_service_uid:1000,message:'private-input-never-render'}
      await page.reload()
      const panel=page.locator('[data-setup-status]')
      await panel.getByRole('alert').waitFor()
      assert.match(await panel.innerText(),/HTTP 503.*setup\/runs\/latest/)
      assert.match(await panel.innerText(),/Controller UID 0/)
      assert.doesNotMatch(await panel.innerText(),/No saved setup run|private-input-never-render/)
      fixture.state.runStatus=200
      await panel.getByRole('button',{name:'Retry loading checklist'}).click()
      await panel.getByRole('button',{name:'Recheck connections'}).waitFor()
      fixture.state.runStatus=401
      await panel.getByRole('button',{name:'Refresh',exact:true}).click()
      await panel.getByRole('alert').waitFor()
      assert.match(await panel.innerText(),/Sign in again.*HTTP 401/)
      assert.match(await panel.innerText(),/Showing the last saved result/)
      assert.equal(await page.evaluate(()=>localStorage.getItem('dumb.setup.run')),'a'.repeat(32))
    }finally{await browser.close()}
  })
  test(name+' unavailable capability retries automatically and real timeout/socket failures remain safe',async()=>{
    const {browser,page}=await open(type,{capabilityStatus:503,runStatus:200})
    try{
      const panel=page.locator('[data-setup-status]')
      await panel.getByRole('alert').waitFor()
      assert.match(await panel.innerText(),/HTTP 503.*capabilities/)
      assert.doesNotMatch(await panel.innerText(),/No saved setup run|private-input-proxy-body/)
      fixture.state.capabilityStatus=200
      await panel.getByRole('button',{name:'Recheck connections'}).waitFor({timeout:12000})
      fixture.state.delay=200
      const timeout=await page.evaluate(()=>window.setupRecovery.timeout())
      assert.match(timeout,/timed out.*request timeout.*setup\/runs\/latest/)
      fixture.state.delay=0;fixture.state.offline=true
      await panel.getByRole('button',{name:'Refresh',exact:true}).click()
      await panel.getByRole('alert').waitFor()
      assert.match(await panel.innerText(),/could not be reached.*no HTTP response/)
      assert.doesNotMatch(await panel.innerText(),/No saved setup run/)
    }finally{await browser.close()}
  })
  test(name+' actual app labels recovery as an intentional restart hold without a readiness spinner',async()=>{
    const startup={phase:'recovery_required',terminal:true,started_at:1000,completed_at:1010,expected_services:['DUMB API'],services:{'DUMB API':{state:'starting',reason:'Probe pending.'}},failures:{'Installation recovery':'Complete recovery, then restart DUMB.'}}
    const {browser,page}=await open(type,{startup})
    try{
      const banner=page.locator('[data-startup-status]')
      await banner.waitFor()
      assert.match(await banner.innerText(),/Installation recovery requires attention/)
      assert.match(await banner.innerText(),/Normal services and background workers are paused/)
      assert.match(await banner.innerText(),/restart DUMB/)
      assert.match(await banner.innerText(),/Recovery details:/)
      assert.doesNotMatch(await banner.innerText(),/missed.*deadline|Probe pending|Waiting for the services|Health alerts.*until/)
    }finally{await browser.close()}
  })
  test(name+' actual app startup banner identifies pending service and all-ready stabilization with elapsed time',async()=>{
    const startup={phase:'stabilizing',terminal:false,started_at:Date.now()/1000-72,expected_services:['API','Sonarr'],services:{API:{state:'ready'},Sonarr:{state:'starting',reason:'HTTP health check has not passed.'}},failures:{}}
    const {browser,page}=await open(type,{startup})
    try{
      const banner=page.locator('[data-startup-status]')
      await banner.waitFor()
      assert.match(await banner.innerText(),/1 of 2 expected services/)
      assert.match(await banner.innerText(),/Sonarr: HTTP health check has not passed/)
      assert.match(await banner.innerText(),/Startup elapsed: 1m/)
      fixture.state.startup={...startup,services:{API:{state:'ready'},Sonarr:{state:'ready'}}}
      await page.waitForFunction(()=>document.querySelector('[data-startup-status]')?.textContent.includes('confirming that readiness remains stable'),{timeout:12000})
      assert.match(await banner.innerText(),/2 of 2 expected services/)
    }finally{await browser.close()}
  })
}
