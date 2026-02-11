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
  async getHealthCheck() {
    const { data } = await axios.get('/api/health')
    return data
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
  },
  async getSymlinkBackupStatus(processName) {
    const { data } = await axios.get('/api/process/symlink-backup-status', {
      params: { process_name: processName }
    })
    return data
  },
  async getSymlinkBackupManifests(processName) {
    const { data } = await axios.get('/api/process/symlink-backup-manifests', {
      params: { process_name: processName }
    })
    return data
  },
  async getSymlinkManifestFiles(manifestPath) {
    const params = {}
    if (manifestPath) params.manifest_path = manifestPath
    const { data } = await axios.get('/api/process/symlink-manifest-files', { params })
    return data
  },
  async rescheduleSymlinkBackup(processName) {
    const { data } = await axios.post('/api/process/symlink-backup/reschedule', {
      process_name: processName
    })
    return data
  },
  async runSymlinkRepair(payload) {
    const { data } = await axios.post('/api/process/symlink-repair', payload)
    return data
  },
  async runSymlinkRepairAsync(payload) {
    const { data } = await axios.post('/api/process/symlink-repair-async', payload)
    return data
  },
  async runSymlinkManifestBackup(payload) {
    const { data } = await axios.post('/api/process/symlink-manifest/backup', payload)
    return data
  },
  async runSymlinkManifestBackupAsync(payload) {
    const { data } = await axios.post('/api/process/symlink-manifest/backup-async', payload)
    return data
  },
  async getSymlinkJobStatus(jobId) {
    const { data } = await axios.get('/api/process/symlink-job-status', {
      params: { job_id: jobId }
    })
    return data
  },
  async getLatestSymlinkJob(processName, operation = 'symlink_manifest_backup', activeOnly = true) {
    const { data } = await axios.get('/api/process/symlink-job-latest', {
      params: {
        process_name: processName,
        operation: operation || 'symlink_manifest_backup',
        active_only: !!activeOnly
      }
    })
    return data
  },
  async runSymlinkManifestRestore(payload) {
    const { data } = await axios.post('/api/process/symlink-manifest/restore', payload)
    return data
  },
  async runSymlinkManifestRestoreAsync(payload) {
    const { data } = await axios.post('/api/process/symlink-manifest/restore-async', payload)
    return data
  }
})
