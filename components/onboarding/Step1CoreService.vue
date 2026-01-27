<script setup>
import { ref, watch, onMounted, computed, reactive, nextTick, triggerRef } from 'vue'
import useService from '~/services/useService.js'
import { useOnboardingStore } from '~/stores/onboarding.js'

const store = useOnboardingStore()

// dynamic core services state
const coreServiceOptions = ref([])
const pending = ref(true)
const error = ref(null)

// selection of service KEYS (unique per service)
const selectedNames = ref(store.coreServices.map(s => s.name))
const prevSelected = ref([...selectedNames.value])
const selectedKey = ref(0)

const guidedMode = ref(true)
const guided = reactive({
  stack: 'debrid', // debrid | usenet | both
  useArrs: true,
  combineArrs: true,
  orchestrator: 'cli', // riven | cli | both
  mediaServer: 'plex', // plex | jellyfin | emby | none
  useSeerr: true,
  useHuntarr: true,
  splitHuntarr: false,
  includeMusic: false,
  includeAdult: false,
  multiQuality: false,
  qualityInstances: ['1080p', '4K'],
  enableMetadata: true,
  enableMonitoring: false,
  enableDbTools: true
})
const arrsRequired = computed(() => guided.stack === 'usenet' || guided.stack === 'both')
const suppressCoreSync = ref(false)

function stripHtml(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

watch(() => guided.stack, (val) => {
  if (val === 'usenet' || val === 'both') {
    guided.useArrs = true
  }
})
watch(() => guided.useArrs, (val) => {
  if (!val && arrsRequired.value) guided.useArrs = true
  if (!val) guided.useHuntarr = false
  if (!val) guided.splitHuntarr = false
})

onMounted(async () => {
  try {
    const { processService } = useService()
    const { core_services } = await processService.getCoreServices()

    // Filter: always show instance-based cores even if enabled (so users can add more);
    // hide already-enabled singletons.
    const config = store._Config || {}
    coreServiceOptions.value = core_services.filter(service => {
      const serviceConfig = config[service.key]
      if (service.supports_instances) return true
      return !(serviceConfig?.enabled === true)
    })
  } catch (e) {
    error.value = e
  } finally {
    pending.value = false
  }
})

// augment descriptions with hyperlink HTML
const servicesWithLinks = computed(() =>
  coreServiceOptions.value.map(s => {
    let html = s.description
      .replace(/(https?:\/\/[^\s]+)/g, `<a href="$1" target="_blank" class="text-blue-500 underline break-words">$1</a>`)
      .replace(/\n/g, '<br/>')

    let tosNotice = null
    if (s.key === 'emby') {
      tosNotice = `By enabling Emby, you agree to the <a href="https://emby.media/terms.html" target="_blank" rel="noopener noreferrer" class="underline">Emby Terms of Service</a>.`
    } else if (s.key === 'plex') {
      tosNotice = `By enabling Plex, you agree to the <a href="https://www.plex.tv/about/privacy-legal/plex-terms-of-service/" target="_blank" rel="noopener noreferrer" class="underline">Plex Terms of Service</a>.`
    }
    return { ...s, descriptionHtml: html, descriptionText: stripHtml(html), tosNotice }
  })
)

const coreKeySet = computed(() => new Set(coreServiceOptions.value.map(s => s.key)))
const findKey = (candidates) => candidates.find(k => coreKeySet.value.has(k)) || null

async function applyGuidedSelection() {
  const available = coreKeySet.value
  const selected = new Set()
  const add = (key) => { if (key && available.has(key)) selected.add(key) }

  const rivenKey = findKey(['riven_backend', 'riven'])
  const cliKey = findKey(['cli_debrid'])
  const decypharrKey = findKey(['decypharr'])
  const nzbdavKey = findKey(['nzbdav'])

  const arrKeys = ['sonarr', 'radarr', 'lidarr', 'whisparr', 'prowlarr']
  const arrsForSelection = ['sonarr', 'radarr']
  const qualityArrs = new Set(['sonarr', 'radarr'])
  if (guided.includeMusic) arrsForSelection.push('lidarr')
  if (guided.includeAdult) arrsForSelection.push('whisparr')
  const qualityNames = guided.multiQuality
    ? guided.qualityInstances.map(v => String(v || '').trim()).filter(Boolean)
    : []
  const defaultArrInstanceName = (svc) => {
    if ((svc === 'sonarr' || svc === 'radarr') && guided.stack === 'both' && guided.combineArrs) return 'Combined'
    if ((svc === 'sonarr' || svc === 'radarr') && guided.stack === 'debrid') return 'Debrid'
    if ((svc === 'sonarr' || svc === 'radarr') && guided.stack === 'usenet') return 'Usenet'
    if (svc === 'lidarr') return 'Music'
    if (svc === 'whisparr') return 'Adult'
    return ''
  }
  const instanceNamesForArr = (svc) => {
    if (guided.multiQuality && qualityArrs.has(svc)) return [...qualityNames]
    const defName = defaultArrInstanceName(svc)
    return defName ? [defName] : ['']
  }
  const mediaKeys = { plex: 'plex', jellyfin: 'jellyfin', emby: 'emby' }

  if (guided.stack === 'debrid' || guided.stack === 'both') {
    if (guided.useArrs) add(decypharrKey)
    else {
      if (guided.orchestrator === 'riven' || guided.orchestrator === 'both') add(rivenKey)
      if (guided.orchestrator === 'cli' || guided.orchestrator === 'both') add(cliKey)
      add('prowlarr')
    }
  }
  if (guided.stack === 'usenet' || guided.stack === 'both') {
    if (guided.useArrs) add(nzbdavKey)
  }

  if (guided.useArrs) {
    arrsForSelection.forEach(add)
    add('prowlarr')
    if (guided.useHuntarr) add('huntarr')
  }

  if (guided.useSeerr) add('seerr')

  if (guided.mediaServer !== 'none') {
    add(mediaKeys[guided.mediaServer])
  }

  suppressCoreSync.value = true

  const optional = new Set()
  if (guided.enableMetadata) optional.add('zilean')
  if (guided.enableMonitoring && guided.mediaServer === 'plex') optional.add('tautulli')
  if (guided.enableDbTools) {
    optional.add('postgres')
    optional.add('pgadmin')
  }
  if ((guided.orchestrator === 'riven' || guided.orchestrator === 'both') && (guided.stack === 'debrid' || guided.stack === 'both')) {
    optional.add('riven_frontend')
  }
  if (rivenKey && selected.has(rivenKey)) {
    optional.add('riven_frontend')
  }
  store.optionalServices = Array.from(optional)

  if (guided.useArrs) {
    const targetArrs = [...arrsForSelection]
    const enableHuntarrForArrs = (svc, instName = '') => {
      if (!guided.useHuntarr) return
      const key = instName ? `${svc}::${instName}` : svc
      store._userServiceOptions[key] = {
        ...(store._userServiceOptions[key] || {}),
        use_huntarr: true
      }
    }
    const selectedList = Array.from(selected)
    const arrSet = new Set(targetArrs)
    const existingByName = new Map()
    for (const cs of store.coreServices) {
      if (!existingByName.has(cs.name)) existingByName.set(cs.name, cs)
    }
    const baseCore = selectedList
      .filter(k => !arrSet.has(k))
      .map(k => {
        if (existingByName.has(k)) return existingByName.get(k)
        if (k === 'seerr') return { name: k, instance_name: 'Requests' }
        if (k === 'prowlarr') return { name: k, instance_name: 'Indexers' }
        if (k === 'huntarr') return { name: k, instance_name: 'Automation' }
        if (k === 'lidarr') return { name: k, instance_name: 'Music' }
        if (k === 'whisparr') return { name: k, instance_name: 'Adult' }
        return { name: k, instance_name: '' }
      })

    if (guided.stack === 'both' && !guided.combineArrs) {
      targetArrs.forEach((svc) => {
        const names = instanceNamesForArr(svc)
        if (names.length === 0) names.push('')
        names.forEach((q) => {
          const debridName = q ? `Debrid ${q}` : 'Debrid'
          const usenetName = q ? `Usenet ${q}` : 'Usenet'
          baseCore.push({ name: svc, instance_name: debridName })
          baseCore.push({ name: svc, instance_name: usenetName })
          enableHuntarrForArrs(svc, debridName)
          enableHuntarrForArrs(svc, usenetName)
          store._userServiceOptions[`${svc}::${debridName}`] = {
            ...(store._userServiceOptions[`${svc}::${debridName}`] || {}),
            core_service: 'decypharr'
          }
          store._userServiceOptions[`${svc}::${usenetName}`] = {
            ...(store._userServiceOptions[`${svc}::${usenetName}`] || {}),
            core_service: 'nzbdav'
          }
        })
      })
    } else {
      const coreServiceValue = guided.stack === 'both' ? 'decypharr, nzbdav' : guided.stack === 'debrid' ? 'decypharr' : 'nzbdav'
      targetArrs.forEach((svc) => {
        const names = instanceNamesForArr(svc)
        if (names.length === 0) names.push('')
        names.forEach((q) => {
          if (q) {
            baseCore.push({ name: svc, instance_name: q })
            enableHuntarrForArrs(svc, q)
            store._userServiceOptions[`${svc}::${q}`] = {
              ...(store._userServiceOptions[`${svc}::${q}`] || {}),
              core_service: coreServiceValue
            }
          } else {
            baseCore.push({ name: svc, instance_name: '' })
            enableHuntarrForArrs(svc)
            store._userServiceOptions[svc] = {
              ...(store._userServiceOptions[svc] || {}),
              core_service: coreServiceValue
            }
          }
        })
      })
    }
    if (guided.useHuntarr) {
      const coreServiceValue = guided.stack === 'both' ? 'decypharr, nzbdav' : guided.stack === 'debrid' ? 'decypharr' : 'nzbdav'
      const withoutHuntarr = baseCore.filter(cs => cs.name !== 'huntarr')
      if (guided.stack === 'both' && !guided.combineArrs && guided.splitHuntarr) {
        const debridName = 'Debrid'
        const usenetName = 'Usenet'
        withoutHuntarr.push({ name: 'huntarr', instance_name: debridName })
        withoutHuntarr.push({ name: 'huntarr', instance_name: usenetName })
        store._userServiceOptions[`huntarr::${debridName}`] = {
          ...(store._userServiceOptions[`huntarr::${debridName}`] || {}),
          core_service: 'decypharr'
        }
        store._userServiceOptions[`huntarr::${usenetName}`] = {
          ...(store._userServiceOptions[`huntarr::${usenetName}`] || {}),
          core_service: 'nzbdav'
        }
      } else {
        withoutHuntarr.push({ name: 'huntarr', instance_name: 'Automation' })
        store._userServiceOptions['huntarr::Automation'] = {
          ...(store._userServiceOptions['huntarr::Automation'] || {}),
          core_service: coreServiceValue
        }
      }
      store.coreServices = withoutHuntarr
    } else {
      store.coreServices = baseCore.filter(cs => cs.name !== 'huntarr')
    }
  } else {
    const selectedList = Array.from(selected)
    const existingByName = new Map()
    for (const cs of store.coreServices) {
      if (!existingByName.has(cs.name)) existingByName.set(cs.name, cs)
    }
    store.coreServices = selectedList.map(k => {
      if (existingByName.has(k)) return existingByName.get(k)
        if (k === 'seerr') return { name: k, instance_name: 'Requests' }
        if (k === 'prowlarr') return { name: k, instance_name: 'Indexers' }
        if (k === 'huntarr') return { name: k, instance_name: 'Automation' }
        if (k === 'lidarr') return { name: k, instance_name: 'Music' }
        if (k === 'whisparr') return { name: k, instance_name: 'Adult' }
        return { name: k, instance_name: '' }
      })
  }

  store.guidedApplied = true
  const finalNames = Array.from(new Set(store.coreServices.map(cs => cs.name)))
  selectedNames.value = finalNames
  prevSelected.value = [...finalNames]
  suppressCoreSync.value = false
  selectedKey.value += 1
  await nextTick()
  triggerRef(selectedNames)
}

// Keep store.coreServices in sync with checkbox changes WITHOUT losing multiple instances
watch(selectedNames, (names) => {
  if (suppressCoreSync.value) return
  const prev = prevSelected.value

  // removals: drop ALL instances for that service
  const removed = prev.filter(k => !names.includes(k))
  if (removed.length) {
    store.coreServices = store.coreServices.filter(cs => !removed.includes(cs.name))
  }

  // additions: add one default instance (user can add more below)
  const added = names.filter(k => !prev.includes(k))
  for (const k of added) {
    if (!store.coreServices.some(cs => cs.name === k)) {
      store.coreServices.push({ name: k, instance_name: '' })
    }
  }

  prevSelected.value = [...names]
})

watch(
  () => store.coreServices.map(cs => cs.name).join('|'),
  () => {
    if (suppressCoreSync.value) return
    const next = Array.from(new Set(store.coreServices.map(cs => cs.name)))
    selectedNames.value = next
    prevSelected.value = [...next]
    selectedKey.value += 1
  }
)

// helpers for multiple instances UI
const instancesFor = (key) => store.coreServices.filter(cs => cs.name === key)
function addInstance(key) {
  if (!selectedNames.value.includes(key)) selectedNames.value.push(key)
  store.coreServices.push({ name: key, instance_name: '' })
}
function removeInstance(key, idx) {
  const list = instancesFor(key)
  const target = list[idx]
  const i = store.coreServices.indexOf(target)
  if (i !== -1) store.coreServices.splice(i, 1)
  if (instancesFor(key).length === 0) {
    selectedNames.value = selectedNames.value.filter(k => k !== key)
  }
}

// ---- Duplicate / Empty validation (includes existing enabled instances) ----
function existingInstanceNamesLC(key) {
  const conf = (store._Config || {})[key]
  const inst = conf?.instances || {}
  const names = Array.isArray(inst)
    ? inst.map(i => (i.instance_name || i.name || '').trim().toLowerCase())
    : Object.keys(inst).map(n => n.trim().toLowerCase())
  return new Set(names.filter(n => n && n !== 'default'))
}

function hasDupInstance(key) {
  const current = instancesFor(key)
    .map(x => (x.instance_name || '').trim().toLowerCase())
    .filter(Boolean)
  const currentSet = new Set(current)
  const existingSet = existingInstanceNamesLC(key)
  // duplicate among "to-be-created" OR conflicts with existing enabled instances
  const hasInternalDup = currentSet.size !== current.length
  const hasExistingConflict = current.some(n => existingSet.has(n))
  return hasInternalDup || hasExistingConflict
}

function hasEmptyInstanceName(key) {
  return instancesFor(key).some(x => !(x.instance_name || '').trim())
}

// expose a hard-block flag to onboarding.vue's Next button
const instanceNameBlocked = computed(() => {
  return coreServiceOptions.value.some(s =>
    selectedNames.value.includes(s.key) && s.supports_instances && (
      hasEmptyInstanceName(s.key) || hasDupInstance(s.key)
    )
  )
})
watch(instanceNameBlocked, (v) => { store._instanceNameBlocked = v }, { immediate: true })
</script>

<template>
    <section class="bg-gray-900 flex justify-center py-12 px-4">
        <div class="w-full max-w-3xl bg-gray-800 rounded-2xl shadow-lg p-8 space-y-6">
            <!-- Guided Setup -->
            <div class="p-4 rounded-lg bg-gray-900 border border-gray-700 space-y-4">
              <div class="flex items-center justify-between">
                <h2 class="text-lg font-semibold text-white">Guided setup</h2>
                <label class="flex items-center gap-2 text-sm text-gray-300" title="Toggle the guided setup questionnaire.">
                  <input type="checkbox" v-model="guidedMode" class="accent-indigo-400 h-4 w-4" />
                  <span>Enable guided mode</span>
                </label>
              </div>

              <div v-if="guidedMode" class="space-y-4 text-sm text-gray-300">
                <div>
                  <p class="font-semibold text-white">Which workflows do you want to use?</p>
                  <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Use Debrid-based workflows (Real-Debrid, AllDebrid, etc.).">
                      <input type="radio" value="debrid" v-model="guided.stack" />
                      <span>Debrid</span>
                    </label>
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Use Usenet workflows (NzbDAV + Arrs).">
                      <input type="radio" value="usenet" v-model="guided.stack" />
                      <span>Usenet</span>
                    </label>
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Enable both Debrid and Usenet workflows.">
                      <input type="radio" value="both" v-model="guided.stack" />
                      <span>Both</span>
                    </label>
                  </div>
                </div>

                <div>
                  <p class="font-semibold text-white">Use Arrs for automation?</p>
                  <div class="mt-2 flex gap-4">
                    <label class="flex items-center gap-2" title="Enable Sonarr/Radarr (and optional Lidarr/Whisparr) automation.">
                      <input type="radio" :value="true" v-model="guided.useArrs" />
                      <span>Yes</span>
                    </label>
                    <label class="flex items-center gap-2" :class="arrsRequired ? 'opacity-60' : ''" title="Skip Arr automation (only available for Debrid-only workflows).">
                      <input type="radio" :value="false" v-model="guided.useArrs" :disabled="arrsRequired" />
                      <span>No</span>
                    </label>
                  </div>
                  <p v-if="arrsRequired" class="mt-1 text-xs text-amber-300">Usenet workflows require Arr services.</p>
                </div>

                <div v-if="guided.stack === 'both' && guided.useArrs">
                  <p class="font-semibold text-white">Arr instance layout</p>
                  <div class="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Use one Arr instance that targets both Debrid and Usenet.">
                      <input type="radio" :value="true" v-model="guided.combineArrs" />
                      <span>Combined (one Arr instance for both)</span>
                    </label>
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Create separate Arr instances for Debrid and Usenet.">
                      <input type="radio" :value="false" v-model="guided.combineArrs" />
                      <span>Separate (Debrid + Usenet instances)</span>
                    </label>
                  </div>
                  <p class="mt-1 text-xs text-gray-400">
                    Combined uses a single Arr instance with a list-based core_service. Separate creates Debrid/Usenet instances and keeps their root folders distinct.
                  </p>
                </div>

                <div v-if="guided.stack !== 'usenet' && !guided.useArrs">
                  <p class="font-semibold text-white">Debrid orchestrator preference</p>
                  <div class="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Use Riven as the Debrid orchestrator.">
                      <input type="radio" value="riven" v-model="guided.orchestrator" />
                      <span>Riven</span>
                    </label>
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Use CLI Debrid as the Debrid orchestrator.">
                      <input type="radio" value="cli" v-model="guided.orchestrator" />
                      <span>CLI Debrid</span>
                    </label>
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Enable both Riven and CLI Debrid.">
                      <input type="radio" value="both" v-model="guided.orchestrator" />
                      <span>Both</span>
                    </label>
                  </div>
                </div>

                <div>
                  <p class="font-semibold text-white">Media server</p>
                  <div class="mt-2 grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Use Plex as the media server.">
                      <input type="radio" value="plex" v-model="guided.mediaServer" />
                      <span>Plex</span>
                    </label>
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Use Jellyfin as the media server.">
                      <input type="radio" value="jellyfin" v-model="guided.mediaServer" />
                      <span>Jellyfin</span>
                    </label>
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Use Emby as the media server.">
                      <input type="radio" value="emby" v-model="guided.mediaServer" />
                      <span>Emby</span>
                    </label>
                    <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="No media server in this container.">
                      <input type="radio" value="none" v-model="guided.mediaServer" />
                      <span>External / None</span>
                    </label>
                  </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Enable Seerr for content requests (Overseerr/Jellyseerr).">
                    <input type="checkbox" v-model="guided.useSeerr" />
                    <span>Enable Seerr (requests)</span>
                  </label>
                  <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" :class="guided.useArrs ? '' : 'opacity-60'" title="Enable Huntarr automation (requires Arr services).">
                    <input type="checkbox" v-model="guided.useHuntarr" :disabled="!guided.useArrs" />
                    <span>Enable Huntarr (Arrs only)</span>
                  </label>
                  <label
                    v-if="guided.stack === 'both'"
                    class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2"
                    :class="guided.useArrs && guided.useHuntarr ? '' : 'opacity-60'"
                    title="Create separate Huntarr instances for Debrid and Usenet."
                  >
                    <input type="checkbox" v-model="guided.splitHuntarr" :disabled="!guided.useArrs || !guided.useHuntarr" />
                    <span>Separate Huntarr for Debrid + Usenet</span>
                  </label>
                  <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" :class="guided.useArrs ? '' : 'opacity-60'" title="Enable Lidarr for music automation.">
                    <input type="checkbox" v-model="guided.includeMusic" :disabled="!guided.useArrs" />
                    <span>Include music automation (Lidarr)</span>
                  </label>
                  <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" :class="guided.useArrs ? '' : 'opacity-60'" title="Enable Whisparr for adult content automation.">
                    <input type="checkbox" v-model="guided.includeAdult" :disabled="!guided.useArrs" />
                    <span>Include adult content automation (Whisparr)</span>
                  </label>
                  <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" :class="guided.useArrs ? '' : 'opacity-60'" title="Create multiple Sonarr/Radarr instances for different quality tiers.">
                    <input type="checkbox" v-model="guided.multiQuality" :disabled="!guided.useArrs" />
                    <span>Multiple quality tiers (Sonarr/Radarr)</span>
                  </label>
                  <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Enable Zilean metadata cache service.">
                    <input type="checkbox" v-model="guided.enableMetadata" />
                    <span>Enable Zilean (metadata cache)</span>
                  </label>
                  <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" :class="guided.mediaServer === 'plex' ? '' : 'opacity-60'" title="Enable Tautulli (Plex monitoring).">
                    <input type="checkbox" v-model="guided.enableMonitoring" :disabled="guided.mediaServer !== 'plex'" />
                    <span>Enable Tautulli (Plex only)</span>
                  </label>
                  <label class="flex items-center gap-2 bg-gray-700 rounded-md px-3 py-2" title="Enable PostgreSQL database and pgAdmin UI.">
                    <input type="checkbox" v-model="guided.enableDbTools" />
                    <span>Enable PostgreSQL + pgAdmin</span>
                  </label>
                </div>

                <div v-if="guided.useArrs && guided.multiQuality" class="mt-2 space-y-2">
                  <p class="text-xs text-gray-400">
                    Instance names for Sonarr and Radarr (used to pull multiple formats). Add or remove tiers as needed.
                  </p>
                  <div class="space-y-2">
                    <div
                      v-for="(tier, idx) in guided.qualityInstances"
                      :key="`tier-${idx}`"
                      class="flex items-center gap-2"
                    >
                      <input
                        v-model.trim="guided.qualityInstances[idx]"
                        type="text"
                        placeholder="e.g., 1080p"
                        title="Instance name used for Sonarr/Radarr quality tier."
                        class="flex-1 rounded-md bg-gray-950 border border-gray-700 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button
                        v-if="guided.qualityInstances.length > 1"
                        type="button"
                        class="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-100 text-xs"
                        @click="guided.qualityInstances.splice(idx, 1)"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    class="mt-2 px-3 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs"
                    title="Add another quality tier instance."
                    @click="guided.qualityInstances.push('')"
                  >
                    Add tier
                  </button>
                </div>

                <div class="flex justify-end">
                  <button
                    type="button"
                    class="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-500"
                    title="Apply the guided selections to the service list below."
                    @click="applyGuidedSelection"
                  >
                    Apply recommendations
                  </button>
                </div>
              </div>
            </div>

            <!-- Intro Text -->
            <p class="text-gray-300 space-y-2">
            Select one or more core services to get started.
            <br />

            <!-- Emphasized Note -->
            <span class="block mt-4 p-4 rounded-md bg-gray-700 border-l-4 border-yellow-400 text-yellow-200">
                <strong>Note:</strong> 
                <br />
                Each core service involves automated backend setup, so we recommend starting with just one.    
                <br />
                You can enable additional services later by relaunching the onboarding process from the settings menu.
            </span>

            <!-- Standard Tips -->
            <span class="block mt-4">
                Each service provides distinct features, so choose what best suits your workflow.
            </span>
            <span v-if="store._capabilities?.optional_only_onboarding" class="block mt-2">
                If you only want optional services, you can skip selecting a core service and click Next.
            </span>

            <!-- Tip Note -->
            <span class="block mt-2 p-3 rounded-md bg-gray-700 border-l-4 border-blue-400 text-blue-200">
                <strong>Tip:</strong> Click a service name to expand its details and learn more.
            </span>
            </p>


            <!-- Loading / Error States -->
            <div v-if="pending" class="text-gray-400 text-center py-10">
                Loading services…
            </div>
            <div v-else-if="error" class="text-red-500 text-center">
                Failed to load services
            </div>

            <!-- Service List -->
            <div v-else class="grid grid-cols-1 gap-4" :key="selectedKey">
            <details
                v-for="service in servicesWithLinks"
                :key="service.key"
                class="group bg-gray-700 p-4 rounded-lg border border-gray-600 hover:shadow-xl transition-shadow"
                :open="selectedNames.includes(service.key)"
            >
                <summary class="flex flex-col sm:flex-row sm:items-center sm:space-x-3 cursor-pointer">
                <div class="flex items-center space-x-3">
                    <label class="inline-flex items-center cursor-pointer">
                    <input
                        type="checkbox"
                        :value="service.key"
                        v-model="selectedNames"
                        :title="service.descriptionText || service.name"
                        class="h-5 w-5 text-indigo-500 bg-gray-600 border-gray-500 rounded focus:ring-indigo-400 focus:ring-2"
                    />
                    </label>
                    <span class="font-semibold text-white group-open:text-indigo-300">
                    {{ service.name }}
                    </span>
                </div>

                <!-- Always-visible Terms line for Emby/Plex -->
                <span
                    v-if="service.tosNotice"
                    class="mt-1 sm:mt-0 sm:ml-3 text-xs text-gray-400"
                    v-html="service.tosNotice"
                />
                </summary>

                <div class="mt-3 text-gray-400 prose prose-sm">
                <p v-html="service.descriptionHtml"></p>

                <!-- Show currently enabled instances from existing config, if any -->
                <div v-if="service.supports_instances && existingInstanceNamesLC(service.key).size" class="mt-3">
                  <div class="text-s text-indigo-300 mb-1">Existing instances:</div>
                  <ul class="text-s text-indigo-300 list-disc pl-5">
                    <li v-for="name in Array.from(existingInstanceNamesLC(service.key))" :key="name">
                      <span class="font-mono">{{ name }}</span>
                    </li>
                  </ul>
                </div>
                </div>

                <!-- Instances UI: shows only if selected and backend supports instances -->
                <div
                  v-if="selectedNames.includes(service.key) && service.supports_instances"
                  class="mt-4 p-3 rounded-md bg-gray-800 border border-gray-600"
                >
                  <div class="flex items-center justify-between mb-2">
                    <label class="text-sm text-gray-300">Instances</label>
                    <button type="button" @click="addInstance(service.key)" class="text-xs px-2 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white" title="Add another instance of this service.">
                      Add another instance
                    </button>
                  </div>

                  <div class="space-y-3">
                    <div
                      v-for="(inst, idx) in instancesFor(service.key)"
                      :key="service.key + '-' + idx"
                      class="p-3 rounded-md bg-gray-900 border border-gray-700"
                    >
                      <div class="flex items-center gap-3">
                        <input
                          v-model.trim="inst.instance_name"
                          type="text"
                          placeholder="e.g., TV, Anime, Movies"
                          title="Instance name used to create a separate service configuration."
                          class="flex-1 rounded-md bg-gray-950 border border-gray-700 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          maxlength="64"
                        />
                        <button
                          v-if="instancesFor(service.key).length > 1"
                          type="button"
                          class="text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-100"
                          @click="removeInstance(service.key, idx)"
                          title="Remove this instance."
                        >Remove</button>
                      </div>
                    </div>
                  </div>

                  <p v-if="hasEmptyInstanceName(service.key)" class="text-xs text-amber-300 mt-2">
                    Please enter an instance name for all {{ service.name }} instances.
                  </p>
                  <p v-else-if="hasDupInstance(service.key)" class="text-xs text-amber-300 mt-2">
                    Duplicate instance names detected for {{ service.name }} (includes existing instances). Please make them unique.
                  </p>
                </div>
            </details>
            </div>
        </div>
    </section>
</template>
