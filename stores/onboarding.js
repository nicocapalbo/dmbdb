import { defineStore } from 'pinia'
import useService from '~/services/useService.js'
import { useProcessesStore } from '~/stores/processes.js'
import { useSetupArrangementsStore } from '~/stores/setupArrangements.js'
import { onboardingSteps, onboardingStepNumber } from '~/helper/onboardingSteps.js'
import { setupErrorText, guidedMediaChoices } from '~/helper/setupArrangements.js'
import { setupRuntimeValues, setupInfiniDyskCoreOptions, setupInfiniDyskTopologies, setupInfiniDyskNeedsRclone, setupInfiniDyskUsesNativeRuntime, setupInfiniDyskRuntimeSupported, isSetupInfiniDyskRuntimeField } from '~/helper/setupInfiniDysk.js'

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
  let mountType = ('mount_type' in opts) ? String(opts.mount_type || '') : String(defaults.mount_type || '')
  mountType = mountType.trim().toLowerCase()
  if (!mountType) mountType = 'rclone'
  return mountType === 'external_rclone'
}

export const useOnboardingStore = defineStore('onboarding', {
  state: () => ({
    needsOnboarding: null,
    submitting: false,
    lastResponse: null,
    arrangementValues: {},
    _guidedMediaSelections: {},
    _setupRuntimeTopologies: {},
    navigationError: '',
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
    guidedWorkflowIntent: null,
    serviceUiSupported: null,
    serviceUiEnabled: false,
    serviceUiServices: [],
    serviceUiLoading: false,
    serviceUiError: '',
    serviceUiPrompt: false,
    preflightRunning: false,
    preflightRanAt: '',
    preflightChecks: [],
    preflightError: ''
  }),

  getters: {
    totalCore: s => s.coreServices.length,
    totalOpt: s => s.optionalServices.length,

    wizardSteps() {
      return onboardingSteps({
        providers: this.debridCoreServices,
        services: this.servicesMetaWithOptions,
        serviceUi: this.serviceUiPrompt,
        arrangements: this._capabilities?.setup_arrangements === true,
      })
    },
    currentWizardStep() { return this.wizardSteps[this.step - 1] || this.wizardSteps[0] },
    optionsStart() { return this.wizardSteps.findIndex(entry => entry.component === 'options') + 1 },
    setupPayload() { return { ...this.reviewPayload, arrangement: { values: setupRuntimeValues(this.arrangementValues, this._capabilities), intent: this.guidedWorkflowIntent || {} } } },

    debridCoreServices() {
      const withProviders = new Set(
        (this._coreMeta || [])
          .filter(s => Array.isArray(s.debrid_providers) && s.debrid_providers.length > 0)
          .map(s => s.key)
      )
      const intent = this.guidedWorkflowIntent || {}
      const usenetOnlyDecypharr = intent.stack === 'usenet'
        && Array.isArray(intent.usenetCoreServices)
        && intent.usenetCoreServices.includes('decypharr')
      return this.coreServices.filter(cs => withProviders.has(cs.name) && !(cs.name === 'decypharr' && usenetOnlyDecypharr))
    },

    // Capability probe: does a given core key support instances?
    coreSupportsInstances: (s) => (coreKey) => {
      const meta = s._coreMeta.find(m => m.key === coreKey)
      return !!meta?.supports_instances
    },
    coreNeedsRclone: (s) => (coreKey) => setupInfiniDyskNeedsRclone(s._coreMeta.find(meta => meta.key === coreKey), setupInfiniDyskRuntimeSupported(s._capabilities) ? s._setupRuntimeTopologies : {}),
    coreUsesNativeRuntime: (s) => (coreKey) => setupInfiniDyskUsesNativeRuntime(s._coreMeta.find(meta => meta.key === coreKey), setupInfiniDyskRuntimeSupported(s._capabilities) ? s._setupRuntimeTopologies : {}),

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
          if (!('use_embedded_rclone' in opts) && !('mount_type' in opts)) continue
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
          if (dep === 'rclone' && !this.coreNeedsRclone(meta.key)) continue
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
          if (!('use_embedded_rclone' in opts) && !('mount_type' in opts)) continue
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
          if (dep === 'rclone' && (!this.coreNeedsRclone(coreName) || this.coreUsesNativeRuntime(coreName))) continue
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
      return this.currentWizardStep?.serviceKey || null
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
          if (dep === 'rclone' && (!this.coreNeedsRclone(core.name) || this.coreUsesNativeRuntime(core.name))) continue

          // instance filter: if this core has an instance, only take matching suffixed entries in pass 1
          if (wantInst && instSuffix !== wantInst) continue

          if (baseKey === core.name) {
            svcOpts[core.name] = setupInfiniDyskCoreOptions(core.name, opts, this.coreUsesNativeRuntime(core.name))
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
          if (dep === 'rclone' && (!this.coreNeedsRclone(core.name) || this.coreUsesNativeRuntime(core.name))) continue

          if (baseKey === core.name) {
            if (!svcOpts[core.name]) svcOpts[core.name] = setupInfiniDyskCoreOptions(core.name, opts, this.coreUsesNativeRuntime(core.name))
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

    // Rendering and navigation use the same declarative sequence.
    reviewStep() { return onboardingStepNumber(this.wizardSteps, 'review') },
    logsStep() { return onboardingStepNumber(this.wizardSteps, 'progress') },
    successStep() { return onboardingStepNumber(this.wizardSteps, 'result') },
    errorStep() { return onboardingStepNumber(this.wizardSteps, 'error') },

    preflightBlockingChecks(state) {
      return (state.preflightChecks || []).filter(check => check?.critical && check?.ok === false)
    },

    preflightHasBlockingIssues() {
      return this.preflightBlockingChecks.length > 0
    }
  },

  actions: {
    syncSetupTopology(plan) {
      const currentId = this.currentWizardStep.id
      this._setupRuntimeTopologies = setupInfiniDyskTopologies(plan, this._capabilities)
      const locked = {}
      for (const field of plan?.arrangement_schema?.fields || []) {
        if (field.readonly !== true || !isSetupInfiniDyskRuntimeField(field)) continue
        const [key, option] = field.key.split('::')
        const topology = this._setupRuntimeTopologies[key]
        if (topology) locked[field.key] = topology[option]
      }
      this.arrangementValues = { ...this.arrangementValues, ...locked }
      const nextIndex = this.wizardSteps.findIndex(step => step.id === currentId)
      if (nextIndex >= 0) this.step = nextIndex + 1
    },
    async previewSetupChoices({ keepPrevious = false } = {}) {
      const setup = useSetupArrangementsStore()
      let plan = await setup.preview(this.setupPayload, { keepPrevious })
      if (plan) this.syncSetupTopology(plan)
      // Removing a no-longer-required rclone changes the payload. Bind the
      // reviewed plan to that exact payload before setup can be submitted.
      if (plan && setup.planSignature !== JSON.stringify(this.setupPayload)) {
        plan = await setup.preview(this.setupPayload, { keepPrevious: true })
        if (plan) this.syncSetupTopology(plan)
      }
      return plan
    },
    async check() {
      const { configService } = useService()
      this.needsOnboarding = await configService.getOnboardingStatus()
    },

    async next() {
      this.navigationError = ''
      try {
        if (this.currentWizardStep?.id === 'companions') await this.loadMetadata()
        if (this.step < this.wizardSteps.length) this.step++
      } catch (error) {
        this.navigationError = setupErrorText(error, 'Could not load service options. Your choices were retained; retry Next.')
      }
    },
    back() { if (this.step > 1) this.step-- },

    async skip() {
      const { configService } = useService()
      this.step = this.successStep
      await configService.setOnboardingComplete()
      this.needsOnboarding = false
    },

    seedArrangementMediaChoices(fields) {
      if (this._capabilities?.setup_arrangements !== true) return false
      const seeded = guidedMediaChoices(fields, this.arrangementValues, this.guidedWorkflowIntent, this._guidedMediaSelections)
      const changed = JSON.stringify(seeded.values) !== JSON.stringify(this.arrangementValues)
      this._guidedMediaSelections = seeded.defaults
      if (changed) this.arrangementValues = seeded.values
      return changed
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

    async runPreflightChecks() {
      const { processService, configService } = useService()
      const checks = []
      this.preflightRunning = true
      this.preflightError = ''

      const addCheck = (check) => {
        checks.push({
          key: check.key,
          label: check.label,
          ok: check.ok === true ? true : check.ok === false ? false : null,
          critical: check.critical !== false,
          detail: check.detail || ''
        })
      }

      try {
        const health = await processService.getHealthCheck()
        const isHealthy = String(health?.status || '').toLowerCase() === 'healthy'
        addCheck({
          key: 'api-health',
          label: 'Backend health check',
          ok: isHealthy,
          critical: true,
          detail: isHealthy ? 'DUMB API responded healthy.' : String(health?.details || health?.status || 'Backend reported unhealthy status.')
        })
      } catch (err) {
        addCheck({
          key: 'api-health',
          label: 'Backend health check',
          ok: false,
          critical: true,
          detail: String(err?.response?.data?.detail || err?.message || 'Unable to reach /api/health.')
        })
      }

      try {
        this._capabilities = await processService.getCapabilities()
        const capCount = Object.keys(this._capabilities || {}).length
        addCheck({
          key: 'capabilities',
          label: 'Backend capabilities',
          ok: capCount > 0,
          critical: true,
          detail: capCount > 0 ? `${capCount} capability flags detected.` : 'Capabilities endpoint returned no flags.'
        })
      } catch (err) {
        this._capabilities = {}
        addCheck({
          key: 'capabilities',
          label: 'Backend capabilities',
          ok: false,
          critical: true,
          detail: String(err?.response?.data?.detail || err?.message || 'Failed to read /api/process/capabilities.')
        })
      }

      try {
        const { core_services } = await processService.getCoreServices()
        this._coreMeta = Array.isArray(core_services) ? core_services : []
        addCheck({
          key: 'core-catalog',
          label: 'Core services catalog',
          ok: this._coreMeta.length > 0,
          critical: true,
          detail: this._coreMeta.length > 0
            ? `${this._coreMeta.length} core services available for onboarding.`
            : 'No core services were returned.'
        })
      } catch (err) {
        this._coreMeta = []
        addCheck({
          key: 'core-catalog',
          label: 'Core services catalog',
          ok: false,
          critical: true,
          detail: String(err?.response?.data?.detail || err?.message || 'Failed to load /api/process/core-services.')
        })
      }

      try {
        this._Config = await configService.getConfig()
        const configuredMounts = [
          this._Config?.decypharr?.mount_path,
          this._Config?.infinidysk?.mount_path,
          this._Config?.nzbdav?.mount_path,
          this._Config?.cli_debrid?.symlink_library_path
        ].filter(path => String(path || '').trim().length > 0)
        addCheck({
          key: 'mount-config',
          label: 'Storage configuration inventory',
          ok: null,
          critical: false,
          detail: configuredMounts.length
            ? `Detected ${configuredMounts.length} configured mount/symlink root path(s). This inventory does not verify mount readiness or consumer access; review the arrangement's bounded readiness checks.`
            : 'No mount paths detected yet. Storage readiness and consumer access remain unverified.'
        })
      } catch (err) {
        addCheck({
          key: 'mount-config',
          label: 'Storage configuration inventory',
          ok: null,
          critical: false,
          detail: String(err?.response?.data?.detail || err?.message || 'Failed to read config for mount checks.')
        })
      }

      try {
        const data = await configService.getServiceUiStatus()
        this.serviceUiSupported = true
        this.serviceUiEnabled = !!data?.enabled
        this.serviceUiServices = Array.isArray(data?.services) ? data.services : []
        this.serviceUiPrompt = !this.serviceUiEnabled
        addCheck({
          key: 'service-ui',
          label: 'Embedded UI readiness',
          ok: true,
          critical: false,
          detail: this.serviceUiEnabled
            ? 'Embedded service UIs are already enabled.'
            : 'Embedded service UIs are available and can be enabled during onboarding.'
        })
      } catch (err) {
        this.serviceUiSupported = false
        this.serviceUiEnabled = false
        this.serviceUiServices = []
        this.serviceUiPrompt = false
        this.serviceUiError = 'Embedded UI support is not available on this backend.'
        addCheck({
          key: 'service-ui',
          label: 'Embedded UI readiness',
          ok: false,
          critical: false,
          detail: String(err?.response?.data?.detail || 'Embedded UI endpoint is unavailable on this backend.')
        })
      }

      this.preflightChecks = checks
      this.preflightRanAt = new Date().toISOString()
      this.preflightError = this.preflightHasBlockingIssues
        ? 'Resolve blocking preflight checks before continuing.'
        : ''
      this.preflightRunning = false
      return checks
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

      const validKeys = Object.keys(defaults).filter(k => serviceKey !== 'whisparr' || k !== 'whisparr_profiles')

      // Existing state — IMPORTANT: store under the *full* key, including instance suffix if present
      const prev = this._userServiceOptions[key] || {}

      // Start with a clone of previous values
      const next = { ...prev }
      // Saved libraries are managed by the backend, not onboarding edits.
      if (serviceKey === 'whisparr') delete next.whisparr_profiles

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
      if (this.submitting || (!this.coreServices.length && !this.optionalServices.length)) return
      this.submitting = true
      try {
        if (this._capabilities?.setup_arrangements === true) {
          const setup = useSetupArrangementsStore()
          const run = await setup.start(this.setupPayload)
          this.lastResponse = { run_id: run?.run_id, status: run?.status }
          this.step = this.logsStep
        } else {
          this.step = this.logsStep
          // Metadata omits unsupported instance fields. An arbitrary 422 must
          // never remove the user's chosen instance or optional settings.
          const response = await useService().processService.startCoreServices(this.reviewPayload)
          this.lastResponse = { status: 'submitted', results: response?.results || [] }
          this.step = this.successStep
        }
      } catch (err) {
        this.lastResponse = setupErrorText(err, err?.message || 'Setup could not start. Review the configuration and try again.')
        this.step = this.errorStep
      } finally { this.submitting = false }
    },

    async leaveSetup() {
      // This flag controls navigation; the backend retains unfinished actions.
      await this.complete()
      this.needsOnboarding = false
      this.coreServices = this.coreServices.map(({ debrid_key, ...entry }) => entry)
      this._userServiceOptions = {}
      this.arrangementValues = {}
      const setup = useSetupArrangementsStore()
      setup.planSignature = ''
      setup.idempotencyKey = ''
    },

    async complete() {
      const { configService } = useService()
      const procStore = useProcessesStore()
      await configService.setOnboardingComplete()
      // Leaving the wizard is independent of application readiness. The retained
      // run remains authoritative when a process refresh is temporarily unavailable.
      try { await procStore.getProcesses() } catch { /* Dashboard can retry its normal refresh. */ }
    }
  }
})
