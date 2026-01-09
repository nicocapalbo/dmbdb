import { defineStore } from 'pinia'
import { configRepository } from '~/services/config.js'
import { defaultLogTimestampFormat, normalizeLogTimestampFormat } from '~/helper/formatTimestamp.js'

let logTimestampPromise = null

export const useUiStore = defineStore('ui', {
  state: () => ({
    logTimestampFormat: { ...defaultLogTimestampFormat },
    logTimestampLoaded: false,
    logTimestampError: null,
  }),
  actions: {
    async loadLogTimestampFormat() {
      if (logTimestampPromise) return logTimestampPromise
      const repo = configRepository()
      logTimestampPromise = repo.getConfig()
        .then((config) => {
          const format = normalizeLogTimestampFormat(config?.dumb?.ui?.log_timestamp)
          this.logTimestampFormat = format
          this.logTimestampLoaded = true
          this.logTimestampError = null
          return format
        })
        .catch((error) => {
          console.warn('Failed to load log timestamp format:', error)
          this.logTimestampFormat = { ...defaultLogTimestampFormat }
          this.logTimestampLoaded = true
          this.logTimestampError = error?.message || 'Failed to load log timestamp format'
          return this.logTimestampFormat
        })
      return logTimestampPromise
    },
    async getLogTimestampFormat() {
      if (this.logTimestampLoaded) return this.logTimestampFormat
      return this.loadLogTimestampFormat()
    },
    async saveLogTimestampFormat(nextFormat) {
      const repo = configRepository()
      const normalized = normalizeLogTimestampFormat(nextFormat)
      await repo.updateGlobalConfig({ dumb: { ui: { log_timestamp: normalized } } })
      this.logTimestampFormat = normalized
      this.logTimestampLoaded = true
      this.logTimestampError = null
      return normalized
    },
  },
})
