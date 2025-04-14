import {defineStore} from "pinia";
import useService from "~/services/useService.js";

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
        this.logsList = await logsService.fetchServiceLogs('DMB')
      } catch (e) {
        throw new Error(e)
      }
    }
  }
})
