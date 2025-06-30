import {defineStore} from "pinia";
import useService from "~/services/useService.js";
import { useProcessesStore } from "~/stores/processes.js"

export const useLogsStore = defineStore('logs',{
  state: () => ({
    logsList: null
  }),
  getters: {
    getLogsList: (state) => {
      return state.logsList
    }
  },
  actions: {
    async getAllLogs() {
      try {
        const { logsService } = useService()
        const processesStore = useProcessesStore()
        const projectName = processesStore.projectName || 'DMB'
        this.logsList = await logsService.fetchServiceLogs(projectName)
      } catch (e) {
        throw new Error(e)
      }
    }
  }
})
