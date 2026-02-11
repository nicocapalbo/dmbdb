import { defineStore } from 'pinia'
import { configRepository } from '~/services/config.js'
import { defaultLogTimestampFormat, normalizeLogTimestampFormat } from '~/helper/formatTimestamp.js'

let logTimestampPromise = null
let sidebarPrefsPromise = null

const defaultSidebarPreferences = {
  show_all_services: false,
  compact_mode: false,
  tools_open: false,
  quick_filter: 'all',
  service_search: '',
  saved_views: [],
  active_saved_view_id: '',
  service_shortcuts: {},
}

const normalizeSidebarPreferences = (value) => {
  const input = value && typeof value === 'object' ? value : {}
  const quickFilter = String(input.quick_filter || defaultSidebarPreferences.quick_filter)
  return {
    show_all_services: input.show_all_services === true,
    compact_mode: input.compact_mode === true,
    tools_open: input.tools_open === true,
    quick_filter: ['all', 'running', 'stopped', 'unhealthy'].includes(quickFilter)
      ? quickFilter
      : defaultSidebarPreferences.quick_filter,
    service_search: String(input.service_search || ''),
    saved_views: Array.isArray(input.saved_views) ? input.saved_views : [],
    active_saved_view_id: String(input.active_saved_view_id || ''),
    service_shortcuts: input.service_shortcuts && typeof input.service_shortcuts === 'object'
      ? input.service_shortcuts
      : {},
  }
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    logTimestampFormat: { ...defaultLogTimestampFormat },
    logTimestampLoaded: false,
    logTimestampError: null,
    sidebarPreferences: { ...defaultSidebarPreferences },
    sidebarPreferencesLoaded: false,
    sidebarPreferencesError: null,
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
    async loadSidebarPreferences() {
      if (sidebarPrefsPromise) return sidebarPrefsPromise
      const repo = configRepository()
      sidebarPrefsPromise = repo.getConfig()
        .then((config) => {
          const prefs = normalizeSidebarPreferences(config?.dumb?.ui?.sidebar)
          this.sidebarPreferences = prefs
          this.sidebarPreferencesLoaded = true
          this.sidebarPreferencesError = null
          return prefs
        })
        .catch((error) => {
          console.warn('Failed to load sidebar preferences:', error)
          this.sidebarPreferences = { ...defaultSidebarPreferences }
          this.sidebarPreferencesLoaded = true
          this.sidebarPreferencesError = error?.message || 'Failed to load sidebar preferences'
          return this.sidebarPreferences
        })
      return sidebarPrefsPromise
    },
    async getSidebarPreferences() {
      if (this.sidebarPreferencesLoaded) return this.sidebarPreferences
      return this.loadSidebarPreferences()
    },
    async saveSidebarPreferences(nextPrefs) {
      const repo = configRepository()
      const normalized = normalizeSidebarPreferences(nextPrefs)
      await repo.updateGlobalConfig({ dumb: { ui: { sidebar: normalized } } })
      this.sidebarPreferences = normalized
      this.sidebarPreferencesLoaded = true
      this.sidebarPreferencesError = null
      return normalized
    },
  },
})
