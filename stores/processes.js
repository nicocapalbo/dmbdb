import {defineStore} from "pinia";
import useService from "~/services/useService.js";

const normalizeServiceName = (service) => {
  return String(service?.process_name || service?.name || service?.config_key || '').trim()
}

const isProjectService = (service) => {
  const name = normalizeServiceName(service).toLowerCase()
  return name.startsWith('dumb') || name.startsWith('dmb')
}

const sortServices = (services) => {
  return [...services].sort((a, b) => {
    const aIsProject = isProjectService(a)
    const bIsProject = isProjectService(b)
    if (aIsProject !== bIsProject) return aIsProject ? -1 : 1
    const aName = normalizeServiceName(a).toLowerCase()
    const bName = normalizeServiceName(b).toLowerCase()
    return aName.localeCompare(bName)
  })
}

export const useProcessesStore = defineStore('processes', {
  state: () => ({
    processesList: []          // always an array
  }),

  getters: {
    /* Returns 'DUMB' | 'DMB' (defaults to DUMB while loading) */
    projectName: (state) => {
      if (!state.processesList.length) return 'DUMB'
      return state.processesList.some(p =>
        p?.config_key?.toLowerCase().includes('dumb')
      ) ? 'DUMB' : 'DMB'
    },

    /* true ↔ onboarding not completed yet */
    needsOnboarding (state) {
      if (!state.processesList.length) return true        // nothing yet → wizard

      /* decide which project we’re on */
      const isDumb = state.processesList.some(p =>
        p?.config_key?.toLowerCase().includes('dumb')
      )
      const projectKey = isDumb ? 'dumb' : 'dmb'

      /* look up that entry */
      const entry = state.processesList.find(p =>
        p?.config_key?.toLowerCase().includes(projectKey)
      )

      /* show wizard if flag is missing OR explicitly false */
      return entry?.config?.onboarding_completed !== true
    },

    getProcessesList: (state) => sortServices(state.processesList),

    enabledProcesses: (state) => {
      return sortServices(state.processesList.filter(
        (p) => p?.config?.enabled === true || p?.config?.enabled === 'true'
      ))
    }
  },
  actions: {
    async getProcesses() {
      try {
        const {processService} = useService()
        this.processesList = await processService.fetchProcesses()
      } catch (e) {
        console.error("Failed to fetch services:", e);
        throw new Error(e)
      }
    }
  }
})
