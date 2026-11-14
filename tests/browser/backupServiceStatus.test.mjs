import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { chromium, firefox } from 'playwright'
import { buildVueComponentHarness } from '../support/vueComponentHarness.mjs'

const entry = [
  "import { createApp, h, ref, reactive, computed, onMounted, onBeforeUnmount, onUnmounted, watch, watchEffect, nextTick } from 'vue'",
  "import { createPinia } from 'pinia'",
  "import App from '~/app.vue'",
  "import Card from '~/components/ServiceCard.vue'",
  "import Sidebar from '~/components/SideBar.vue'",
  "import { useStatusStore } from '~/stores/status.js'",
  "import { useProcessesStore } from '~/stores/processes.js'",
  "const values = new Map(), route = reactive({path:'/',hash:''})",
  "globalThis.useState=(key,init)=>{if(!values.has(key))values.set(key,ref(init()));return values.get(key)}",
  "Object.assign(globalThis,{ref,computed,onMounted,onBeforeUnmount,onUnmounted,watch,watchEffect,nextTick,useRoute:()=>route,useRouter:()=>({push(){}}),useToast:()=>({success(){},warning(){},error(){}}),useHead(){},useProcessesStore})",
  "globalThis.fixtureProcesses = reactive({projectName:'DUMB',processesList:[{process_name:'Example Media',config_key:'plex',config:{enabled:true}},{process_name:'DUMB API',config_key:'dumb',config:{enabled:true}}],getProcesses:async()=>[]})",
  "Object.defineProperties(fixtureProcesses,{getProcessesList:{get:()=>fixtureProcesses.processesList},enabledProcesses:{get:()=>fixtureProcesses.processesList}})",
  "const app=createApp(App);app.use(createPinia());const status=useStatusStore();status.applyPayload({type:'status',processes:fixtureProcesses.processesList.map(p=>({...p,status:'running',healthy:true,health_status:'healthy'}))})",
  "globalThis.fixtureFreshStatus=()=>status.applyPayload({type:'status',processes:fixtureProcesses.processesList.map(p=>({...p,status:'running',healthy:true,health_status:'healthy'}))})",
  "const Link={props:['to'],setup:(props,{slots,attrs})=>()=>h('a',{...attrs,href:typeof props.to==='string'?props.to:'/services/'+encodeURIComponent(props.to.params?.serviceId||'')},slots.default?.())}",
  "app.component('NuxtLink',Link)",
  "app.component('NuxtLayout',{setup:(_, {slots})=>()=>h('main',[h(Sidebar),slots.default?.()])})",
  "app.component('NuxtPage',{setup:()=>()=>h('div',{'data-testid':'fixture-dashboard'},fixtureProcesses.processesList.map(p=>h(Card,{process:p,'data-testid':p.config_key==='plex'?'fixture-media-card':'fixture-api-card'})))})",
  "for(const name of ['InfiniDyskMigrationNotice','InfiniDyskV2Notice','UpdateNotice'])app.component(name,{render:()=>null})",
  "app.mount('#app');addEventListener('pagehide',()=>app.unmount(),{once:true})",
].join('\n')
let bundle
const fixture = async () => {
  bundle ||= await buildVueComponentHarness(entry, { defines: { 'process.client': 'false', 'import.meta.client': 'true' }, modules: {
    '~/stores/processes.js': "export const useProcessesStore=()=>globalThis.fixtureProcesses",
    '~/stores/auth.js': "export const useAuthStore=()=>({_initialized:true,isAuthEnabled:false,isAuthenticated:true,user:{username:'fixture_operator'}})",
    '~/stores/config.js': "export const useConfigStore=()=>({getAutoRestartPolicy:async()=>({enabled:false})})",
    '~/stores/logs.js': "export const useLogsStore=()=>({getAllLogs:async()=>[]})",
    '~/stores/metrics.js': "export const useMetricsStore=()=>({latestSnapshot:null})",
    '~/stores/ui.js': "export const useUiStore=()=>({sidebarPreferences:{},getSidebarPreferences:async()=>({}),saveSidebarPreferences:async()=>({})})",
    '~/composables/useAppearance.js': "export const useAppearance=()=>({initAppearance(){}})",
    '@/services/auth': "export const refreshTokenForWebSocket=async()=>true",
    '~/services/useService.js': "export default()=>({processService:{getCapabilities:async()=>({}),fetchProcessStatusDetails:async()=>({status:'running',healthy:true,health_status:'healthy'})}})",
  } })
  const state = { job: null, calls: [], pageLoads: 0 }
  const server=http.createServer((req,res)=>{
    const path=new URL(req.url,'http://fixture.invalid').pathname
    if(path==='/fixture.js'){res.setHeader('content-type','text/javascript');res.end(bundle);return}
    if(path==='/'){state.pageLoads++;res.setHeader('content-type','text/html');res.end('<!doctype html><div id="app"></div><script type="module" src="/fixture.js"></script>');return}
    if(!path.startsWith('/api/')){res.statusCode=404;res.end();return}
    state.calls.push({path,method:req.method});res.setHeader('content-type','application/json')
    if(path==='/api/process/capabilities'){res.end(JSON.stringify({installation_backup:true,installation_backup_protocol:1,startup_lifecycle:false}));return}
    if(path==='/api/process/installation-backups/status'){res.end(JSON.stringify({protocol:1,job:state.job,preparation:null}));return}
    if(path==='/api/metrics'){res.end('{}');return}
    res.statusCode=404;res.end('{}')
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  return {state,origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})}
}
for(const [name,browserType] of [['chromium',chromium],['firefox',firefox]]) {
  test(name+': scheduled backup replaces cached green dashboard and sidebar statuses without a reload', {timeout:60000},async()=>{
    const app=await fixture();let browser
    try {
      browser=await browserType.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
      await page.route('**/*',r=>new URL(r.request().url()).origin===app.origin?r.continue():r.abort())
      await page.goto(app.origin)
      const media=page.getByTestId('fixture-media-card'), api=page.getByTestId('fixture-api-card'), sidebar=page.locator('[data-service-name="Example Media"]')
      await media.locator('[data-service-status="running"]').waitFor({state:'attached'})
      await sidebar.locator('.bg-emerald-400').waitFor({state:'attached'})
      app.state.job={job_id:'scheduled_one',job_type:'installation_backup',status:'running',stage:'quiescing',scheduled:true,created_at:100,updated_at:101,services_stopped:false}
      await media.locator('[data-service-status="unknown"]').waitFor({timeout:12000,state:'attached'})
      assert.equal(await sidebar.locator('.bg-emerald-400').count(),0)
      assert.equal(await api.locator('[data-service-status="running"]').count(),1)
      app.state.job={...app.state.job,stage:'archiving',updated_at:102,services_stopped:true,stopped_process_names:['Example Media']}
      await media.locator('[data-service-status="stopped"]').waitFor({timeout:12000,state:'attached'})
      await sidebar.locator('.bg-slate-500').waitFor({state:'attached'})
      assert.match(await page.getByTestId('installation-scheduled-downtime').innerText(),/Scheduled backup.*applications are stopped.*hours/)
      app.state.job={...app.state.job,status:'cancelled',stage:'cancelled',updated_at:103,services_stopped:false,stopped_process_names:[]}
      await media.locator('[data-service-status="unknown"]').waitFor({timeout:12000,state:'attached'})
      assert.equal(await media.locator('[data-service-status="unknown"]').getAttribute('title'),'Status: unknown','Old per-card health must not override the invalidated snapshot')
      await page.evaluate(()=>window.fixtureFreshStatus())
      await media.locator('[data-service-status="running"]').waitFor({state:'attached'});await sidebar.locator('.bg-emerald-400').waitFor({state:'attached'})
      assert.equal(app.state.pageLoads,1,'Backup transition must not reload the dashboard')
      assert.equal(app.state.calls.some(c=>c.method!=='GET'),false,'Global backup observation must stay read-only')
      assert.deepEqual(errors,[])
    } finally {await browser?.close();await app.close()}
  })
}
