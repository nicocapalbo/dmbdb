import { defineStore } from 'pinia'
import useService from '~/services/useService.js'

const normalizeNotice = (notice, type) => ({
  ...notice,
  type: notice?.type || type,
})

export const useProjectUpdateNoticesStore = defineStore('projectUpdateNotices', {
  state: () => ({
    notices: [],
    loading: false,
    error: '',
    detailsOpen: false,
  }),

  getters: {
    availableNotices: (state) => state.notices.filter((notice) => notice.type === 'available'),
  },

  actions: {
    async loadNotices() {
      if (this.loading) return
      this.loading = true
      this.error = ''
      try {
        const { processService } = useService()
        const payload = await processService.getUpdateNotices('project')
        const available = Array.isArray(payload?.available)
          ? payload.available.map((notice) => normalizeNotice(notice, 'available'))
          : []
        const info = Array.isArray(payload?.info)
          ? payload.info.map((notice) => normalizeNotice(notice, 'info'))
          : []
        const applied = Array.isArray(payload?.applied)
          ? payload.applied.map((notice) => normalizeNotice(notice, 'applied'))
          : []
        this.notices = [...available, ...info, ...applied]
      } catch (error) {
        this.error = 'Could not load update notices.'
        console.warn('Failed to load update notices:', error)
      } finally {
        this.loading = false
      }
    },

    openDetails() {
      this.detailsOpen = true
    },

    closeDetails() {
      this.detailsOpen = false
    },

    clear() {
      this.notices = []
      this.error = ''
      this.detailsOpen = false
    },
  },
})
