import {defineStore} from "pinia";

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
        const {fetchProcesses} = useService()
        this.processesList = await fetchProcesses()
      } catch (e) {
        console.error("Failed to fetch services:", e);
        throw new Error(e)
      }
    }
  }
})
