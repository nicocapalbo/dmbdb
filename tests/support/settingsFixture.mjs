import http from 'node:http'
import { once } from 'node:events'
import { buildVueComponentHarness } from './vueComponentHarness.mjs'

const entry = `
import * as Vue from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory, RouterView, useRoute } from 'vue-router';
import Settings from '~/pages/settings.vue';
import SettingsSection from '~/components/SettingsSection.vue';
import UpdateNotice from '~/components/UpdateNotice.vue';
import { useStatusStore } from '~/stores/status.js';
import { useProcessesStore } from '~/stores/processes.js';
import { useProjectUpdateNoticesStore } from '~/stores/projectUpdateNotices.js';
Object.assign(globalThis, { ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, onMounted: Vue.onMounted, onBeforeUnmount: Vue.onBeforeUnmount, watch: Vue.watch, useRoute });
const processes = [
 { process_name: 'DUMB API', config_key: 'dumb', version: '2.24.0-dev.30', config: { enabled: true } },
 { process_name: 'DUMB Frontend', config_key: 'dumb_frontend', version: '1.92.0', config: { enabled: true } },
 { process_name: 'Plex Main', config_key: 'plex', config: { enabled: true } },
 { process_name: 'Plex Retained', config_key: 'plex', config: { enabled: false } },
 { process_name: 'InfiniDysk', config_key: 'infinidysk', config: { enabled: true, mount_backend: 'fuse' } },
 { process_name: 'Sonarr Main', config_key: 'sonarr', config: { enabled: true } },
 { process_name: 'Manual Jellyfin', config_key: 'jellyfin', config: { enabled: false } },
 { process_name: 'Unused Jellyfin', config_key: 'jellyfin', config: { enabled: false } },
];
const capabilities = { media_library_protection: true, media_library_protection_service_keys: ['plex','jellyfin','emby'], plex_library_settings: false, symlink_repair: true, database_health: true, database_health_metrics: true, postgres_migration: true, postgres_migration_service_keys: ['sonarr'], infinidysk_v2_migration: true, infinidysk_v2_migration_protocol: 1, infinidysk_v2_runtime: true };
const calls = [];
globalThis.settingsBackend = {
 processService: {
  getCapabilities: async () => capabilities,
  getUpdateNotices: async () => ({ available: [{ id: 'stale', process_name: 'DUMB Frontend', current_version: '1.90.0', available_version: 'v1.91.0' }] }),
  getMediaProtectionPolicy: async name => { calls.push({kind:'policy',name}); return { enabled:true, protected_mounts:[] } },
  getMediaProtectionStatus: async name => { calls.push({kind:'protection-status',name}); return {enabled:true,active:[]} },
 },
 authRepository: () => ({}),
 configService: {
  getConfig: async () => ({ dumb: { media_protection: { services: [{process_name:'Plex Retained',enabled:true,protected_mounts:['/mnt/media']}] } } }),
  getServiceUiStatus: async () => ({ enabled:false, services:[] }),
 },
};
const router = createRouter({ history: createWebHistory(), routes: [{path:'/settings',component:Settings},{path:'/services/:serviceId',component:{render:()=>Vue.h('div',{'data-testid':'navigated-service'},'Existing service utility route')}}] });
const app = Vue.createApp({ render: () => Vue.h(Vue.Fragment, [Vue.h(RouterView), Vue.h(UpdateNotice)]) });
app.use(createPinia()); app.use(router); app.component('SettingsSection',SettingsSection);
app.component('InfoBar', { render: () => null }); app.component('NotificationSettings', { render: () => Vue.h(SettingsSection,{sectionId:'notifications',title:'Notifications'}) });
const store = useProcessesStore(); store.processesList = processes;
const statuses = useStatusStore();
globalThis.settingsFixture = { router, calls, setRuntimeStatus: (name,status) => {statuses.statusByName.set(name,{status})}, setStatusConnected: value => {statuses.status=value?'connected':'disconnected'}, setProcesses: rows => {store.processesList=rows}, setNotices: rows => {useProjectUpdateNoticesStore().notices=rows}, rawNotices: () => useProjectUpdateNoticesStore().notices, setCapabilities: value => {Object.assign(capabilities,value)}, remount: () => location.reload() };
router.isReady().then(() => { app.mount('#app'); globalThis.settingsFixture.ready=true });
`
const modules = {
  '~/stores/status.js': `import {defineStore} from 'pinia';export const useStatusStore=defineStore('settings-status-fixture',{state:()=>({status:'connected',statusByName:new Map([['Manual Jellyfin',{status:'running'}]])})})`,
  '~/services/useService.js': 'export default () => globalThis.settingsBackend',
  '~/stores/auth.js': `import { defineStore } from 'pinia'; export const useAuthStore=defineStore('settings-auth-fixture',{state:()=>({authSupported:true,isAuthEnabled:false,isAuthenticated:true,hasUsers:false})})`,
  '~/stores/onboarding.js': `import { defineStore } from 'pinia'; export const useOnboardingStore=defineStore('settings-onboarding-fixture',{state:()=>({})})`,
  '~/stores/ui.js': `import { defineStore } from 'pinia'; export const useUiStore=defineStore('settings-ui-fixture',{state:()=>({sidebarPreferences:{geek_mode:false},logTimestampFormat:{dateOrder:'MDY',hourFormat:'12',zeroPad:false}}),actions:{async getSidebarPreferences(){return this.sidebarPreferences},async loadLogTimestampFormat(){},async saveSidebarPreferences(value){this.sidebarPreferences=value}}})`,
  '~/components/InstallationBackupPanel.vue': `import {h} from 'vue'; export default {render:()=>h('div',{'data-testid':'installation-backup-fixture'},'Installation backup utilities')}`,
  '~/composables/useAppearance.js': `import {ref} from 'vue'; const selectedTheme=ref('system'); export const useAppearance=()=>({selectedTheme,setAppearanceTheme:theme=>{selectedTheme.value=theme},initAppearance:()=>{}})`,
}
let bundle
export const createSettingsFixture = async ({ css = '', assets = {} } = {}) => {
  bundle ||= await buildVueComponentHarness(entry, { modules, defines: { 'import.meta.client':'true' } })
  const server = http.createServer((request,response) => {
    if (Object.hasOwn(assets,request.url)) {response.setHeader('content-type','font/woff2');response.end(assets[request.url]);return}
    if (request.url === '/fixture.js') {response.setHeader('content-type','text/javascript');response.end(bundle);return}
    if (request.url === '/fixture.css') {response.setHeader('content-type','text/css');response.end(css);return}
    response.setHeader('content-type','text/html');response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="app"></div><script type="module" src="/fixture.js"></script></body></html>')
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  return {origin:'http://127.0.0.1:'+server.address().port, close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections()})}
}
