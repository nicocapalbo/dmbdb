import { defineStore } from 'pinia'
import useService from '~/services/useService.js'
import { SETUP_RUN_STORAGE_KEY, setupErrorText, setupIsRunning, setupRunNotFound } from '~/helper/setupArrangements.js'
const storage = () => {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}
const remember = runId => {
  try { if (runId) storage()?.setItem(SETUP_RUN_STORAGE_KEY, runId); else storage()?.removeItem(SETUP_RUN_STORAGE_KEY) } catch { /* Backend state remains authoritative when browser storage is unavailable. */ }
}
const discoveries = new WeakMap()
export const useSetupArrangementsStore = defineStore('setupArrangements', {
  state: () => ({
    supported: null, capabilities: null, plan: null, run: null, error: '', loading: false,
    lookupState: 'unknown', refreshFailures: 0, runRevision: 0,
    actionBusy: '', planSignature: '', requestSequence: 0, idempotencyKey: '',
  }),
  getters: { running: state => setupIsRunning(state.run) },
  actions: {
    async discover({ force = false } = {}) {
      if (!force && this.supported !== null) return this.supported
      if (discoveries.has(this)) return discoveries.get(this)
      const request = Promise.resolve().then(async () => {
        try {
          const capabilities = await useService().processService.getCapabilities()
          this.capabilities = capabilities
          this.supported = capabilities?.setup_arrangements === true
          return this.supported
        } catch (error) {
          this.lookupState = 'unavailable'
          this.refreshFailures += 1
          this.error = setupErrorText(error, 'Could not check setup support. Retry to check this backend.', '/api/process/capabilities')
          return null
        } finally { discoveries.delete(this) }
      })
      discoveries.set(this, request)
      return request
    },
    rememberRun(run) {
      this.run = run
      this.runRevision += 1
      this.lookupState = run ? 'ready' : 'empty'
      this.refreshFailures = 0
      if (typeof run?.run_id === 'string') remember(run.run_id)
    },
    async preview(payload, { keepPrevious = false } = {}) {
      const sequence = ++this.requestSequence
      this.loading = true; this.error = ''; if (!keepPrevious) this.plan = null; this.planSignature = ''
      try {
        const plan = await useService().processService.planSetup(payload)
        if (sequence !== this.requestSequence) return null
        this.plan = plan
        this.planSignature = JSON.stringify(payload)
        this.idempotencyKey = globalThis.crypto?.randomUUID?.() || 'setup-' + Date.now() + '-' + Math.random().toString(36).slice(2)
        return plan
      } catch (error) {
        if (sequence === this.requestSequence) this.error = setupErrorText(error, 'Could not prepare the setup plan. Review your choices and retry.', '/api/process/setup/plan')
        return null
      } finally { if (sequence === this.requestSequence) this.loading = false }
    },
    async start(payload) {
      if (this.actionBusy) return this.run
      if (!this.plan || this.planSignature !== JSON.stringify(payload)) throw new Error('The setup choices changed. Review the refreshed plan before starting.')
      this.actionBusy = 'start'; this.error = ''
      try {
        const run = await useService().processService.startSetupRun({ plan_id: this.plan.plan_id, idempotency_key: this.idempotencyKey })
        this.rememberRun(run)
        return run
      } catch (error) {
        this.error = setupErrorText(error, 'Could not start setup. Review the request and retry.', '/api/process/setup/runs')
        throw error
      } finally { this.actionBusy = '' }
    },
    async refresh({ latest = false } = {}) {
      if (this.loading) return null
      this.loading = true; this.error = ''
      if (!this.run) this.lookupState = 'loading'
      let endpoint = '/api/process/capabilities'
      const revision = this.runRevision
      try {
        const support = await this.discover()
        if (support !== true) {
          if (support === false) this.lookupState = 'unsupported'
          return null
        }
        let saved = ''
        try { saved = storage()?.getItem(SETUP_RUN_STORAGE_KEY) || '' } catch { /* Fall back to the backend latest run. */ }
        const runId = this.run?.run_id || (/^[a-zA-Z0-9_-]{1,128}$/.test(saved || '') ? saved : '')
        const api = useService().processService
        let run
        endpoint = '/api/process/setup/runs/latest'
        if (latest || !runId) run = await api.getLatestSetupRun()
        else {
          endpoint = '/api/process/setup/runs/{run_id}'
          try { run = await api.getSetupRun(runId) }
          catch (error) {
            if (!setupRunNotFound(error)) throw error
            endpoint = '/api/process/setup/runs/latest'
            run = await api.getLatestSetupRun()
          }
        }
        if (!run || typeof run.run_id !== 'string') throw { response: { status: 502 } }
        if (revision !== this.runRevision) return this.run
        this.rememberRun(run)
        return run
      } catch (error) {
        if (revision !== this.runRevision) return this.run
        if (endpoint.endsWith('/latest') && setupRunNotFound(error, true)) {
          this.rememberRun(null); remember(''); this.error = ''
        } else {
          this.lookupState = 'unavailable'
          this.refreshFailures += 1
          this.error = setupErrorText(error, 'Could not refresh setup results. Your saved setup has not been discarded.', endpoint)
        }
        return null
      } finally { this.loading = false }
    },
    async operate(operation, actionId = '', values = {}) {
      if (this.actionBusy || !this.run?.run_id) return null
      this.actionBusy = actionId || operation; this.error = ''
      try {
        const api = useService().processService
        const run = actionId ? await api.applySetupAction(this.run.run_id, actionId, { operation, values })
          : operation === 'retry' ? await api.retrySetupRun(this.run.run_id) : await api.recheckSetupRun(this.run.run_id)
        this.rememberRun(run)
        return run
      } catch (error) {
        this.error = setupErrorText(error, 'Setup request failed. Try again.', '/api/process/setup/runs/{run_id}' + (actionId ? '/actions/{action_id}' : '/' + operation))
        return null
      } finally { this.actionBusy = '' }
    },
  },
})
