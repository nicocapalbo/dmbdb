import { defineStore } from 'pinia'
import useService from '~/services/useService.js'
import { SETUP_RUN_STORAGE_KEY, setupErrorText, setupIsRunning } from '~/helper/setupArrangements.js'
const storage = () => {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}
const remember = runId => {
  try { if (runId) storage()?.setItem(SETUP_RUN_STORAGE_KEY, runId); else storage()?.removeItem(SETUP_RUN_STORAGE_KEY) } catch { /* Backend state remains authoritative when browser storage is unavailable. */ }
}
export const useSetupArrangementsStore = defineStore('setupArrangements', {
  state: () => ({
    supported: null, capabilities: null, plan: null, run: null, error: '', loading: false,
    actionBusy: '', planSignature: '', requestSequence: 0, idempotencyKey: '',
  }),
  getters: { running: state => setupIsRunning(state.run) },
  actions: {
    async discover() {
      if (this.supported !== null) return this.supported
      try {
        const capabilities = await useService().processService.getCapabilities()
        this.capabilities = capabilities
        this.supported = capabilities?.setup_arrangements === true
      } catch { this.capabilities = null; this.supported = false }
      return this.supported
    },
    rememberRun(run) {
      this.run = run
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
        if (sequence === this.requestSequence) this.error = setupErrorText(error, 'Could not prepare the setup plan. Review your choices and retry.')
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
        this.error = setupErrorText(error)
        throw error
      } finally { this.actionBusy = '' }
    },
    async refresh({ latest = false } = {}) {
      if (this.loading || !(await this.discover())) return null
      this.loading = true; this.error = ''
      try {
        let saved = ''
        try { saved = storage()?.getItem(SETUP_RUN_STORAGE_KEY) || '' } catch { /* Fall back to the backend latest run. */ }
        const runId = this.run?.run_id || (/^[a-zA-Z0-9_-]{1,128}$/.test(saved || '') ? saved : '')
        const api = useService().processService
        let run
        if (latest || !runId) run = await api.getLatestSetupRun()
        else {
          try { run = await api.getSetupRun(runId) }
          catch (error) {
            if (Number(error?.response?.status) !== 404) throw error
            run = await api.getLatestSetupRun()
          }
        }
        this.rememberRun(run)
        return run
      } catch (error) {
        if (Number(error?.response?.status) === 404) {
          this.run = null; remember('')
        } else this.error = setupErrorText(error, 'Could not refresh setup results. Your saved setup has not been discarded.')
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
      } catch (error) { this.error = setupErrorText(error); return null }
      finally { this.actionBusy = '' }
    },
  },
})
