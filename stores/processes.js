import {defineStore} from "pinia";
import useService from "~/services/useService.js";

export const useProcessesStore = defineStore('processes', {
  state: () => ({
    processesList: null
  }),
  getters: {
    getProcessesList: (state) => state.processesList,
  
    projectName: (state) => {
      const list = state.processesList || []
      return list.some(p => (p.config_key || '').toLowerCase().includes('dumb')) ? 'DUMB' : 'DMB'
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
