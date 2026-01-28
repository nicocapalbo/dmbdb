import axios from "axios";
import { extractRestartInfo } from "~/helper/restartInfo.js";

export const processRepository = () => ({
  async fetchProcessStatusDetails(processName, options = {}) {
    const params = { process_name: processName }
    if (options.includeHealth) {
      params.include_health = true
    }
    const response = await axios.get(`/api/process/service-status`, {
      params,
    })
    const data = response?.data || {}
    return {
      process_name: data.process_name ?? processName,
      status: data.status ?? 'unknown',
      healthy: typeof data.healthy === 'boolean' ? data.healthy : null,
      health_reason: typeof data.health_reason === 'string' ? data.health_reason : null,
      restart: extractRestartInfo(data),
    }
  },
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
    const data = await this.fetchProcessStatusDetails(processName)
    return data.status
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
  },
  async startCoreServices (payload) {
    const { data } = await axios.post('/api/process/start-core-service', payload)
    return data
  },
  async getCoreServices() {
    const { data } = await axios.get('/api/process/core-services')
    return data
  },
  async getOptionalServices(coreService = null, optionalServices = []) {
    const { data } = await axios.get(
      '/api/process/optional-services',
      {
        params: {
          core_service: coreService,
          optional_services: optionalServices
        }
      }
    )
    return data
  },
  async getCapabilities() {
    const { data } = await axios.get('/api/process/capabilities')
    return data
  },
  async getUpdateStatus(processName) {
    const { data } = await axios.get('/api/process/update-status', {
      params: { process_name: processName }
    })
    return data
  },
  async runUpdateCheck(processName, force = false) {
    const { data } = await axios.post('/api/process/update-check', {
      process_name: processName,
      force
    })
    return data
  },
  async runUpdateInstall(processName, allowOverride = false, target = null) {
    const payload = {
      process_name: processName,
      allow_override: allowOverride
    }
    if (target) {
      payload.target = target
    }
    const { data } = await axios.post('/api/process/update-install', payload)
    return data
  },
  async rescheduleAutoUpdate(processName) {
    const { data } = await axios.post('/api/process/auto-update/reschedule', {
      process_name: processName
    })
    return data
  }
})
