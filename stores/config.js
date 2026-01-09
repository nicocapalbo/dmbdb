import { defineStore } from 'pinia'
import { configRepository } from '~/services/config.js'

let autoRestartPolicyPromise = null

export const useConfigStore = defineStore('config', {
  state: () => ({
    autoRestartPolicy: null,
    autoRestartLoaded: false,
    autoRestartError: null,
  }),
  actions: {
    async loadAutoRestartPolicy() {
      if (autoRestartPolicyPromise) return autoRestartPolicyPromise
      const repo = configRepository()
      autoRestartPolicyPromise = repo.getConfig()
        .then((config) => {
          this.autoRestartPolicy = config?.dumb?.auto_restart ?? null
          this.autoRestartLoaded = true
          this.autoRestartError = null
          return this.autoRestartPolicy
        })
        .catch((error) => {
          console.warn('Failed to load auto-restart policy:', error)
          this.autoRestartPolicy = null
          this.autoRestartLoaded = true
          this.autoRestartError = error?.message || 'Failed to load auto-restart policy'
          return null
        })
      return autoRestartPolicyPromise
    },
    async getAutoRestartPolicy() {
      if (this.autoRestartLoaded) return this.autoRestartPolicy
      return this.loadAutoRestartPolicy()
    },
  },
})
