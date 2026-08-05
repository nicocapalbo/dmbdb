import axios from "axios";
import { extractRestartInfo } from "~/helper/restartInfo.js";

const withMigrationCompatibilityFallback = async (request, legacyRequest) => {
  try {
    return await request()
  } catch (error) {
    if (Number(error?.response?.status) !== 404) throw error
    return legacyRequest()
  }
}

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
      health_status: typeof data.health_status === 'string' ? data.health_status : null,
      health_reason: typeof data.health_reason === 'string' ? data.health_reason : null,
      health_details: data.health_details && typeof data.health_details === 'object'
        ? data.health_details
        : null,
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
  async stopProcess(processName, protectionOverride = null) {
    const payload = { process_name: processName }
    if (protectionOverride) payload.protection_override = protectionOverride
    const response = await axios.post(`/api/process/stop-service`, {
      ...payload,
    })
    return response.data
  },
  async restartProcess(processName, protectionOverride = null) {
    const payload = { process_name: processName }
    if (protectionOverride) payload.protection_override = protectionOverride
    const response = await axios.post(`/api/process/restart-service`, {
      ...payload,
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
  async getDependencyGraph(processName, scope = 'runtime') {
    const { data } = await axios.get('/api/process/dependency-graph', {
      params: { process_name: processName, scope }
    })
    return data
  },
  async fetchMetricsSnapshot() {
    const { data } = await axios.get('/api/metrics')
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
  async getStartupStatus() {
    const { data } = await axios.get('/api/process/startup-status')
    return data
  },
  async getMediaStormInitialAdminPassword() {
    const { data } = await axios.get('/api/process/mediastorm-initial-admin-password')
    return data
  },
  async getUpdateStatus(processName) {
    const { data } = await axios.get('/api/process/update-status', {
      params: { process_name: processName }
    })
    return data
  },
  async getUpdateNotices(scope = 'project') {
    const { data } = await axios.get('/api/process/update-notices', {
      params: { scope }
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
  async runUpdateInstall(processName, allowOverride = false, target = null, protectionOverride = null) {
    const payload = {
      process_name: processName,
      allow_override: allowOverride
    }
    if (target) {
      payload.target = target
    }
    if (protectionOverride) {
      payload.protection_override = protectionOverride
    }
    const { data } = await axios.post('/api/process/update-install', payload)
    return data
  },
  async getInstallCacheStatus() {
    const { data } = await axios.get('/api/process/install-cache/status')
    return data
  },
  async verifyInstallCache() {
    const { data } = await axios.post('/api/process/install-cache/verify')
    return data
  },
  async pruneInstallCache(maxSizeGib = null) {
    const payload = {}
    if (maxSizeGib != null) payload.max_size_gib = maxSizeGib
    const { data } = await axios.post('/api/process/install-cache/prune', payload)
    return data
  },
  async clearInstallArtifacts(serviceKey = null) {
    const payload = {}
    if (serviceKey) payload.service_key = serviceKey
    const { data } = await axios.post('/api/process/install-cache/artifacts/clear', payload)
    return data
  },
  async cleanupInstallCache(scopes) {
    const { data } = await axios.post('/api/process/install-cache/cleanup', { scopes })
    return data
  },
  async getMediaProtectionStatus(processName = null) {
    const params = {}
    if (processName) params.process_name = processName
    const { data } = await axios.get('/api/process/media-protection/status', { params })
    return data
  },
  async getMediaProtectionPolicy(processName) {
    const { data } = await axios.get('/api/process/media-protection/policy', {
      params: { process_name: processName }
    })
    return data
  },
  async updateMediaProtectionPolicy(payload) {
    const { data } = await axios.put('/api/process/media-protection/policy', payload)
    return data
  },
  async updateMediaProtectionSettings(payload) {
    const { data } = await axios.put('/api/process/media-protection/settings', payload)
    return data
  },
  async getMediaProtectionPreflight(processName, action) {
    const { data } = await axios.post('/api/process/media-protection/preflight', {
      process_name: processName,
      action
    })
    return data
  },
  async getPlexLibrarySettings() {
    const { data } = await axios.get('/api/process/media-protection/plex-library-settings')
    return data
  },
  async updatePlexLibrarySettings(payload) {
    const { data } = await axios.put('/api/process/media-protection/plex-library-settings', payload)
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
  },
  async getSymlinkManifestCompare(params = {}) {
    const { data } = await axios.get('/api/process/symlink-manifest/compare', { params })
    return data
  },
  async getPostgresMigrationPreflight(processName) {
    return withMigrationCompatibilityFallback(async () => {
      const { data } = await axios.get('/api/process/postgres-migration/preflight', {
        params: { process_name: processName }
      })
      return data
    }, async () => {
      const { data } = await axios.get('/api/process/arr-postgres-migration/preflight', {
        params: { process_name: processName }
      })
      return data
    })
  },
  async startPostgresMigration(payload) {
    return withMigrationCompatibilityFallback(async () => {
      const { data } = await axios.post('/api/process/postgres-migration/start', payload)
      return data
    }, async () => {
      const { data } = await axios.post('/api/process/arr-postgres-migration/start', payload)
      return data
    })
  },
  async getPostgresMigrationStatus(jobId, processName = '') {
    return withMigrationCompatibilityFallback(async () => {
      const { data } = await axios.get('/api/process/postgres-migration/status', {
        params: { job_id: jobId, process_name: processName || undefined }
      })
      return data
    }, async () => {
      const { data } = await axios.get('/api/process/arr-postgres-migration/status', {
        params: { job_id: jobId, process_name: processName || undefined }
      })
      return data
    })
  },
  async getLatestPostgresMigration(processName) {
    return withMigrationCompatibilityFallback(async () => {
      const { data } = await axios.get('/api/process/postgres-migration/latest', {
        params: { process_name: processName }
      })
      return data
    }, async () => {
      const { data } = await axios.get('/api/process/arr-postgres-migration/latest', {
        params: { process_name: processName }
      })
      return data
    })
  },
  async rollbackPostgresMigration(jobId, confirmation) {
    const payload = { job_id: jobId, confirmation }
    return withMigrationCompatibilityFallback(async () => {
      const { data } = await axios.post('/api/process/postgres-migration/rollback', payload)
      return data
    }, async () => {
      const { data } = await axios.post('/api/process/arr-postgres-migration/rollback', payload)
      return data
    })
  },
  async getRcloneOptimizerInstances() {
    const { data } = await axios.get('/api/process/rclone-optimizer/instances')
    return data
  },
  async discoverRcloneOptimizerContent(processName) {
    const { data } = await axios.get('/api/process/rclone-optimizer/content', {
      params: { process_name: processName }
    })
    return data
  },
  async startRcloneOptimizer(payload) {
    const { data } = await axios.post('/api/process/rclone-optimizer/jobs', payload)
    return data
  },
  async getRcloneOptimizerJobs(limit = 20) {
    const { data } = await axios.get('/api/process/rclone-optimizer/jobs', {
      params: { limit }
    })
    return data
  },
  async getRcloneOptimizerJob(jobId) {
    const { data } = await axios.get(`/api/process/rclone-optimizer/jobs/${encodeURIComponent(jobId)}`)
    return data
  },
  async getLatestRcloneOptimizerJob(processName = '', activeOnly = false) {
    const { data } = await axios.get('/api/process/rclone-optimizer/latest', {
      params: {
        process_name: processName || undefined,
        active_only: !!activeOnly
      }
    })
    return data
  },
  async cancelRcloneOptimizer(jobId) {
    const { data } = await axios.post('/api/process/rclone-optimizer/cancel', { job_id: jobId })
    return data
  },
  async applyRcloneOptimizer(jobId) {
    const { data } = await axios.post('/api/process/rclone-optimizer/apply', { job_id: jobId })
    return data
  },
  async rollbackRcloneOptimizer(jobId) {
    const { data } = await axios.post('/api/process/rclone-optimizer/rollback', { job_id: jobId })
    return data
  }
})
