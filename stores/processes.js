import {defineStore} from "pinia";
import useService from "~/services/useService.js";

export const useProcessesStore = defineStore('processes', {
  state: () => ({
    processesList: null
  }),
  getters: {
    getProcessesList: (state) => {
      return state.processesList
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
