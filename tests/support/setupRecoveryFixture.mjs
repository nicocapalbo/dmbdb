import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { compileScript, parse } from 'vue/compiler-sfc'
const root = fileURLToPath(new URL('../../', import.meta.url))
const entry = [
  "import { createApp, h, ref, computed, onMounted, onBeforeUnmount, watchEffect } from 'vue'",
  "import { createPinia } from 'pinia'",
  "import App from './app.vue'",
  "import SetupStatusPanel from './components/SetupStatusPanel.vue'",
  "import { useSetupArrangementsStore } from './stores/setupArrangements.js'",
  "import { processRepository } from './services/process.js'",
  "import { setupErrorText } from './helper/setupArrangements.js'",
  "Object.assign(globalThis, { ref, computed, onMounted, onBeforeUnmount, watchEffect, useRoute: () => ({path:'/'}), useToast: () => ({success(){},warning(){},error(){}}), useHead(){} })",
  "const app = createApp(App);const pinia=createPinia();app.use(pinia);const setup=useSetupArrangementsStore(pinia)",
  "app.component('NuxtLayout',{setup:(_, {slots})=>()=>h('main', slots.default?.())})",
  "app.component('NuxtPage',{setup:()=>()=>h(SetupStatusPanel)})",
  "for(const name of ['InfiniDyskMigrationNotice','InfiniDyskV2Notice','UpdateNotice']) app.component(name,{render:()=>null})",
  "app.mount('#app')",
  "globalThis.setupRecovery = { snapshot(){return {lookupState:setup.lookupState,run_id:setup.run?.run_id}}, async timeout(){try{await processRepository().getLatestSetupRun({timeout:30});return ''}catch(error){return setupErrorText(error,'Request failed.','/api/process/setup/runs/latest')}} }",
  "addEventListener('pagehide',()=>app.unmount(),{once:true})",
].join('\n')
const shims = {
  'services/useService.js': "import { processRepository } from " + JSON.stringify(path.join(root, 'services/process.js')) + ";export default()=>({processService:processRepository()})",
  'stores/processes.js': "export const useProcessesStore=()=>({projectName:'DUMB',getProcesses:async()=>[]})",
  'stores/logs.js': "export const useLogsStore=()=>({getAllLogs:async()=>[]})",
  'stores/metrics.js': "export const useMetricsStore=()=>({latestSnapshot:null})",
  'stores/status.js': "export const useStatusStore=()=>({resume(){}})",
  'stores/auth.js': "export const useAuthStore=()=>({isAuthEnabled:false,isAuthenticated:true})",
  'stores/ui.js': "export const useUiStore=()=>({loadLogTimestampFormat(){},logTimestampFormat:'iso'})",
  'composables/useAppearance.js': "export const useAppearance=()=>({initAppearance(){}})",
  'composables/useWebSocket.js': "export const useWebSocket=()=>({on(){},reset(){}})",
}
export async function createSetupRecoveryFixture() {
  const result = await build({
    stdin:{contents:entry,resolveDir:root,sourcefile:'setup-recovery-fixture.js'},bundle:true,format:'iife',platform:'browser',write:false,logLevel:'silent',
    define:{'process.env.NODE_ENV':'"production"','import.meta.client':'true'},
    plugins:[{name:'actual-setup-recovery',setup(plugin){
      plugin.onResolve({filter:/^[~@]\//},args=>{
        const name=args.path.slice(2)
        if(shims[name])return {path:name,namespace:'setup-recovery'}
        return {path:path.resolve(root,name)}
      })
      plugin.onLoad({filter:/.*/,namespace:'setup-recovery'},args=>({contents:shims[args.path],loader:'js',resolveDir:root}))
      plugin.onLoad({filter:/\.vue$/},async args=>{
        const {descriptor,errors}=parse(await fs.readFile(args.path,'utf8'),{filename:args.path})
        if(errors.length)throw errors[0]
        return {contents:compileScript(descriptor,{id:args.path,inlineTemplate:true}).content.replace(/import\((['"][^'"]+\.vue['"])\)/g,'import($1).then(module=>module.default||module)'),loader:descriptor.scriptSetup?.lang==='ts'?'ts':'js',resolveDir:path.dirname(args.path)}
      })
    }}],
  })
  const state = {}
  const requests=[]
  const reset = updates => {
    Object.keys(state).forEach(key=>delete state[key])
    Object.assign(state,{capabilityStatus:200,runStatus:404,runDetail:'No setup run has been created.',startup:{phase:'ready',terminal:true,expected_services:[],services:{}},delay:0,offline:false},updates)
    requests.splice(0)
  }
  reset()
  const server=http.createServer((request,response)=>{
    const pathname=new URL(request.url,'http://fixture.test').pathname
    if(pathname==='/fixture.js'){response.setHeader('content-type','text/javascript');response.end(result.outputFiles[0].contents);return}
    if(!pathname.startsWith('/api/')){response.setHeader('content-type','text/html');response.end('<!doctype html><html><body><div id="app"></div><script src="/fixture.js"></script></body></html>');return}
    requests.push(pathname)
    const send=(status,value)=>{response.statusCode=status;response.setHeader('content-type','application/json');response.end(JSON.stringify(value))}
    if(pathname==='/api/process/capabilities'){send(state.capabilityStatus,state.capabilityStatus===200?{setup_arrangements:true,startup_lifecycle:true}:{detail:'private-input-proxy-body'});return}
    if(pathname==='/api/process/startup-status'){send(200,state.startup);return}
    if(pathname.startsWith('/api/process/setup/runs/')){
      if(state.offline){request.socket.destroy();return}
      const reply=()=>send(state.runStatus,state.runStatus===200?{run_id:'a'.repeat(32),status:'partial',services:[],actions:[]}: {detail:state.runDetail})
      if(state.delay)setTimeout(reply,state.delay);else reply()
      return
    }
    send(200,{})
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  return {origin:'http://127.0.0.1:'+server.address().port,state,requests,reset,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}}
}
