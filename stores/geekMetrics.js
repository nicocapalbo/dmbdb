import { defineStore } from 'pinia'
import { processRepository } from '~/services/process.js'

export const useGeekMetricsStore = defineStore('geekMetrics', {
  state: () => ({
    snapshot: null,
    polling: false,
    error: '',
    _timer: null,
  }),
  getters: {
    metricsByProcessName(state) {
      const map = {}
      const managed = state.snapshot?.dumb_managed || []
      for (const entry of managed) {
        if (entry?.name) map[entry.name] = entry
      }
      return map
    },
    systemMetrics(state) {
      return state.snapshot?.system || null
    },
  },
  actions: {
    async fetchOnce() {
      const repo = processRepository()
      try {
        this.snapshot = await repo.fetchMetricsSnapshot()
        this.error = ''
      } catch (err) {
        this.error = err?.message || 'Failed to fetch metrics'
        console.warn('geekMetrics: fetch failed', err)
      }
    },
    startPolling(intervalMs = 5000) {
      if (this.polling) return
      this.polling = true
      this.fetchOnce()
      this._timer = setInterval(() => this.fetchOnce(), intervalMs)
    },
    stopPolling() {
      this.polling = false
      if (this._timer) {
        clearInterval(this._timer)
        this._timer = null
      }
    },
  },
})
