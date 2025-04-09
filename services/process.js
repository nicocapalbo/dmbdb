import axios from "axios";

export const processRepository = () => ({
  async fetchProcesses() {
    const response = await axios.get(`/api/process/processes`);
    return response.data.processes;
  },
  async fetchProcess(processName) {
    const response = await axios.get(`/api/process/`, {
      params: { process_name: processName },
    });
    return response.data;
  },
  async fetchProcessStatus(processName) {
    const response = await axios.get(`/api/process/service-status`, {
      params: { process_name: processName },
    })
    return response.data.status
  },
  async startProcess(processName) {
    const response = await axios.post(`/api/process/start-service`, {
      process_name: processName,
    })
    return response.data
  },
  async stopProcess(processName) {
    const response = await axios.post(`/api/process/stop-service`, {
      process_name: processName,
    })
    return response.data
  },
  async restartProcess(processName) {
    const response = await axios.post(`/api/process/restart-service`, {
      process_name: processName,
    })
    return response.data
  }
})
