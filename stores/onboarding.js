import { defineStore } from 'pinia'
import useService from '~/services/useService.js'
import { useProcessesStore } from '~/stores/processes.js'

/**
 * @typedef {Object} CoreServicePayload
 * @property {string} name
 * @property {string=} instance_name            // ← include only if backend supports instances
 * @property {string|string[]=} debrid_service
 * @property {string|string[]=} debrid_key
 * @property {Object<string, any>=} service_options
 */

// --- helper: parse a possibly instance-suffixed key
// formats supported:
//   "radarr"                      (global core options)
//   "radarr.dependency"          (global dependency options)
//   "radarr::Test 1"             (instance-specific core options)
//   "radarr.dependency::Test 1"  (instance-specific dependency options)
function splitInstanceSuffix(fullKey = '') {
  const [baseKey, instSuffix] = String(fullKey).split('::', 2)
  return { baseKey, instSuffix: instSuffix || '' }
}

function decypharrNeedsRclone(opts = {}, defaults = {}) {
  const branchName = ('branch' in opts) ? String(opts.branch || '') : String(defaults.branch || '')
  const betaEnabled = branchName.trim().toLowerCase() === 'beta'
  let mountType = ('mount_type' in opts) ? String(opts.mount_type || '') : String(defaults.mount_type || '')
  mountType = mountType.trim().toLowerCase()
  if (betaEnabled) {
    if (!mountType) mountType = 'dfs'
    return mountType === 'rclone'
  }
  if (!mountType) mountType = 'rclone'
  return mountType === 'external_rclone'
}

export const useOnboardingStore = defineStore('onboarding', {
  state: () => ({
    needsOnboarding: null,
    submitting: false,
    lastResponse: null,
    step: 1,
    /** @type {CoreServicePayload[]} */
    coreServices: [],
    /** mix of string or { key, service_options } */
    optionalServices: [],

    // internal caches
    _coreMeta: [],
    _optionalMeta: [],
    _Config: {},
    _userServiceOptions: {},
    _capabilities: {},
    guidedApplied: false,
    serviceUiSupported: null,
    serviceUiEnabled: false,
    serviceUiServices: [],
    serviceUiLoading: false,
    serviceUiError: '',
    serviceUiPrompt: false
  }),

  getters: {
    totalCore: s => s.coreServices.length,
    totalOpt: s => s.optionalServices.length,

    optionsStart() {
      return this.debridCoreServices.length + 3
    },

    debridCoreServices() {
      const withProviders = new Set(
        (this._coreMeta || [])
          .filter(s => Array.isArray(s.debrid_providers) && s.debrid_providers.length > 0)
          .map(s => s.key)
      )
      return this.coreServices.filter(cs => withProviders.has(cs.name))
    },

    // Capability probe: does a given core key support instances?
    coreSupportsInstances: (s) => (coreKey) => {
      const meta = s._coreMeta.find(m => m.key === coreKey)
      return !!meta?.supports_instances
    },

    allServicesMeta(state) {
      const picked = new Set(this.coreServices.map(s => s.name))
      const list = []
      const shouldSkipDecypharrRclone = (() => {
        const meta = state._coreMeta.find(m => m.key === 'decypharr')
        const defaults = meta?.service_options?.decypharr || {}
        let hasExplicit = false
        let needsRclone = null
        for (const [fullKey, opts] of Object.entries(state._userServiceOptions || {})) {
          if (!opts || Object.keys(opts).length === 0) continue
          const { baseKey } = splitInstanceSuffix(fullKey)
          if (baseKey !== 'decypharr') continue
          if (!('use_embedded_rclone' in opts) && !('mount_type' in opts) && !('branch' in opts)) continue
          hasExplicit = true
          needsRclone = decypharrNeedsRclone(opts, defaults)
          break
        }
        if (hasExplicit) return !needsRclone
        return !decypharrNeedsRclone({}, defaults)
      })()
      for (const meta of state._coreMeta.filter(m => picked.has(m.key))) {
        list.push(meta.key)
        for (const dep of meta.dependencies || []) {
          if (meta.key === 'decypharr' && dep === 'rclone' && shouldSkipDecypharrRclone) continue
          list.push(`${meta.key}.${dep}`)
        }
      }
      for (const o of this.optionalServices) {
        list.push(typeof o === 'string' ? o : o.key)
      }
      return list
    },

    servicesMetaWithOptions(state) {
      const meta = this._coreMeta || []
      const optMeta = this._optionalMeta || []
      const list = []
      const shouldSkipDecypharrRclone = (() => {
        const metaDec = meta.find(m => m.key === 'decypharr')
        const defaults = metaDec?.service_options?.decypharr || {}
        let hasExplicit = false
        let needsRclone = null
        for (const [fullKey, opts] of Object.entries(state._userServiceOptions || {})) {
          if (!opts || Object.keys(opts).length === 0) continue
          const { baseKey } = splitInstanceSuffix(fullKey)
          if (baseKey !== 'decypharr') continue
          if (!('use_embedded_rclone' in opts) && !('mount_type' in opts) && !('branch' in opts)) continue
          hasExplicit = true
          needsRclone = decypharrNeedsRclone(opts, defaults)
          break
        }
        if (hasExplicit) return !needsRclone
        return !decypharrNeedsRclone({}, defaults)
      })()
      const coreNames = Array.from(new Set(state.coreServices.map(cs => cs.name)))
      for (const coreName of coreNames) {
        const metaCore = meta.find(m => m.key === coreName)
        if (!metaCore) continue
        const hasCoreOpts = Object.keys(metaCore.service_options?.[coreName] || {}).length > 0
        if (hasCoreOpts) list.push(`${coreName}`)
        for (const dep of metaCore.dependencies || []) {
          if (coreName === 'decypharr' && dep === 'rclone' && shouldSkipDecypharrRclone) continue
          const depOpts = metaCore.service_options?.[dep] || {}
          if (Object.keys(depOpts).length > 0) {
            list.push(`${coreName}.${dep}`)
          }
        }
      }
      for (const o of state.optionalServices) {
        const key = typeof o === 'string' ? o : o.key
        const opt = optMeta.find(m => m.key === key)
        if (!opt) continue
        const optOpts = opt.service_options || {}
        if (Object.keys(optOpts).length > 0) {
          list.push(key)
        }
      }
      if (list.includes('plex')) {
        return list.filter(k => k !== 'plex').concat('plex')
      }
      return list
    },

    currentServiceKey() {
      const idx = this.step - this.optionsStart
      return this.servicesMetaWithOptions[idx] ?? null
    },

    currentServiceOptions() {
      const inst = this.currentServiceKey
      if (!inst) return { key: null, options: {}, descriptions: {} }
      const [parentKey, serviceKey = parentKey] = inst.split('.', 2)
      const coreMeta = this._coreMeta.find(c => c.key === parentKey)
      if (coreMeta && (coreMeta.service_options?.[serviceKey] || coreMeta.service_option_descriptions?.[serviceKey])) {
        return {
          key: inst,
          options: coreMeta.service_options[serviceKey] || {},
          descriptions: coreMeta.service_option_descriptions[serviceKey] || {}
        }
      }
      const opt = this._optionalMeta.find(o => o.key === parentKey)
      if (opt) {
        return {
          key: inst,
          options: opt.service_options || {},
          descriptions: opt.service_option_descriptions || {}
        }
      }
      return { key: inst, options: {}, descriptions: {} }
    },

    reviewPayload(state) {
      const optionalKeys = state.optionalServices.map(o => typeof o === 'string' ? o : o.key)
      const optionalServiceOptions = {}
      for (const [fullKey, opts] of Object.entries(state._userServiceOptions)) {
        if (!opts || Object.keys(opts).length === 0) continue
        const { baseKey } = splitInstanceSuffix(fullKey)
        const [parent] = baseKey.split('.', 2)
        if (!optionalKeys.includes(parent)) continue
        optionalServiceOptions[parent] = opts
      }
      const core_services = state.coreServices.map(core => {
        const meta = state._coreMeta.find(m => m.key === core.name)
        const svcOpts = {}
        const wantInst = (meta?.supports_instances && core.instance_name?.trim()) ? core.instance_name.trim() : ''

        // Pass 1: prefer instance-suffixed keys that match this core's instance
        for (const [fullKey, opts] of Object.entries(state._userServiceOptions)) {
          if (!opts || Object.keys(opts).length === 0) continue
          const { baseKey, instSuffix } = splitInstanceSuffix(fullKey)
          const [parent, dep = parent] = baseKey.split('.', 2)

          // optional service (not instance-scoped for now) — allow both suffixed/unsuffixed, but suffix ignored
          if (optionalKeys.includes(parent)) {
            svcOpts[parent] = opts
            continue
          }

          if (parent !== core.name) continue

          // instance filter: if this core has an instance, only take matching suffixed entries in pass 1
          if (wantInst && instSuffix !== wantInst) continue

          if (baseKey === core.name) {
            svcOpts[core.name] = opts
          } else {
            svcOpts[dep] = opts
          }
        }

        // Pass 2: fall back to global (unsuffixed) keys where not already provided by pass 1
        for (const [fullKey, opts] of Object.entries(state._userServiceOptions)) {
          if (!opts || Object.keys(opts).length === 0) continue
          const { baseKey, instSuffix } = splitInstanceSuffix(fullKey)
          if (instSuffix) continue // only global in pass 2
          const [parent, dep = parent] = baseKey.split('.', 2)
          if (parent !== core.name) continue

          if (baseKey === core.name) {
            if (!svcOpts[core.name]) svcOpts[core.name] = opts
          } else {
            if (!svcOpts[dep]) svcOpts[dep] = opts
          }
        }

        /** @type {CoreServicePayload} */
        const payload = {
          name: core.name,
          debrid_service: core.debrid_service,
          debrid_key: core.debrid_key,
          service_options: svcOpts
        }
        // Back-compat: only include instance_name when supported
        if (meta?.supports_instances && core.instance_name?.trim()) {
          payload.instance_name = core.instance_name.trim()
        }
        return payload
      })
      return { core_services, optional_services: optionalKeys, optional_service_options: optionalServiceOptions }
    },

    // step indices (1-based)
    reviewStep() {
      return this.optionsStart + this.allServicesMeta.length + (this.serviceUiPrompt ? 1 : 0)
    },
    logsStep() {
      return this.reviewStep + 1
    },
    successStep() {
      return this.logsStep + 1
    },
    errorStep() {
      return this.logsStep + 2
    }
  },

  actions: {
    async check() {
      const { configService } = useService()
      this.needsOnboarding = await configService.getOnboardingStatus()
    },

    next() { this.step++ },
    back() { if (this.step > 1) this.step-- },

    async skip() {
      const { configService } = useService()
      this.step = this.successStep
      await configService.setOnboardingComplete()
      this.needsOnboarding = false
    },

    async loadMetadata() {
      const { processService } = useService()
      const { core_services } = await processService.getCoreServices()
      this._coreMeta = core_services

      // Prefill instance_name for cores that support instances (UX only)
      this.coreServices = this.coreServices.map(cs => {
        const meta = this._coreMeta.find(m => m.key === cs.name)
        if (meta?.supports_instances && !('instance_name' in cs)) {
          return { ...cs, instance_name: '' }
        }
        return cs
      })

      const chosenKeys = this.optionalServices.map(o => typeof o === 'string' ? o : o.key)
      if (!chosenKeys.length) {
        this._optionalMeta = []
      } else {
        const map = new Map()
        if (!this.coreServices.length) {
          const { optional_services } = await processService.getOptionalServices(null, chosenKeys)
          optional_services.filter(o => chosenKeys.includes(o.key)).forEach(o => map.set(o.key, o))
        } else {
          for (const cs of this.coreServices) {
            const { optional_services } = await processService.getOptionalServices(cs.name, chosenKeys)
            optional_services.filter(o => chosenKeys.includes(o.key)).forEach(o => map.set(o.key, o))
          }
        }
      this._optionalMeta = Array.from(map.values())
      }
    },

    async loadCoreMeta() {
      const { processService } = useService()
      const { core_services } = await processService.getCoreServices()
      this._coreMeta = core_services
    },

    async loadConfig() {
      const { configService } = useService()
      try { this._Config = await configService.getConfig() } catch (err) { console.error('Failed to load config:', err) }
    },

    async loadCapabilities() {
      const { processService } = useService()
      try {
        this._capabilities = await processService.getCapabilities()
      } catch (err) {
        this._capabilities = {}
      }
    },

    async loadServiceUiStatus() {
      const { configService } = useService()
      this.serviceUiLoading = true
      this.serviceUiError = ''
      try {
        const data = await configService.getServiceUiStatus()
        this.serviceUiSupported = true
        this.serviceUiEnabled = !!data?.enabled
        this.serviceUiServices = Array.isArray(data?.services) ? data.services : []
        this.serviceUiPrompt = !this.serviceUiEnabled
      } catch (err) {
        this.serviceUiSupported = false
        this.serviceUiEnabled = false
        this.serviceUiServices = []
        this.serviceUiPrompt = false
        this.serviceUiError = 'Embedded UI support is not available on this backend.'
      } finally {
        this.serviceUiLoading = false
      }
    },

    async setServiceUiEnabled(enabled) {
      if (!this.serviceUiSupported) return
      const { configService } = useService()
      this.serviceUiLoading = true
      this.serviceUiError = ''
      try {
        const data = await configService.setServiceUiEnabled(enabled)
        this.serviceUiEnabled = !!data?.enabled
        this.serviceUiServices = Array.isArray(data?.services) ? data.services : []
      } catch (err) {
        this.serviceUiError = 'Failed to update embedded UI settings.'
        this.serviceUiEnabled = !enabled
      } finally {
        this.serviceUiLoading = false
      }
    },

    setUserServiceOptions(key, opts) {
      // Support instance-scoped keys via the ::suffix convention, but use base key for defaults lookup
      const { baseKey } = splitInstanceSuffix(key)
      const [parentKey, serviceKey = parentKey] = baseKey.split('.', 2)

      // Lookup defaults
      const coreMeta = this._coreMeta.find(m => m.key === parentKey)
      const optMeta = this._optionalMeta.find(m => m.key === parentKey)

      const defaults =
        coreMeta?.service_options?.[serviceKey] ||
        optMeta?.service_options || {}

      const validKeys = Object.keys(defaults)

      // Existing state — IMPORTANT: store under the *full* key, including instance suffix if present
      const prev = this._userServiceOptions[key] || {}

      // Start with a clone of previous values
      const next = { ...prev }

      for (const [k, v] of Object.entries(opts)) {
        if (!validKeys.includes(k)) continue

        const defaultVal = defaults[k]

        if (v === defaultVal) {
          delete next[k]  // remove if it matches default
        } else {
          next[k] = v     // store if it differs
        }
      }

      this._userServiceOptions[key] = next
    },

    async submit() {
      if (!this.coreServices.length && !this.optionalServices.length) return
      this.submitting = true
      try {
        // show live‑logs step
        this.step = this.logsStep

        // kick off services (first attempt)
        const payload = this.reviewPayload
        try {
          this.lastResponse = await useService().processService.startCoreServices(payload)
        } catch (e) {
          // ultra-back-compat: if 422 (old backend rejects unknown fields),
          // strip instance_name and retry once.
          const status = e?.response?.status ?? e?.status
          if (status === 422) {
            const stripped = {
              core_services: (payload.core_services || []).map(cs => {
                const { instance_name, ...rest } = cs
                return rest
              }),
              optional_services: payload.optional_services || []
            }
            this.lastResponse = await useService().processService.startCoreServices(stripped)
          } else {
            throw e
          }
        }

        // persist onboarding complete
        await this.complete()
        // wait for 30s before showing success
        await new Promise(resolve => setTimeout(resolve, 30000))
        // then show success
        this.step = this.successStep
      } catch (err) {
        this.lastResponse = err?.response?.data ?? err
        this.step = this.errorStep
      } finally {
        this.submitting = false
      }
    },

    async complete() {
      const { configService } = useService()
      const procStore = useProcessesStore()
      await procStore.getProcesses()
      await configService.setOnboardingComplete()
      await procStore.getProcesses()
    }
  }
})
