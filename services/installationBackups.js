import axios from 'axios'
import { backupPreviewIdentity } from '../helper/installationBackupProgress.js'

export const installationBackupsRepository = (client = axios) => {
  const base = '/api/process/installation-backups'
  const get = async (path, params) => (await client.get(base + path, { params, timeout: 30000 })).data
  const post = async (path, payload, timeout = 60000) => (await client.post(base + path, payload, { timeout })).data
  const jobPath = id => {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) throw new Error('Invalid backup job identity.')
    return '/jobs/' + encodeURIComponent(id)
  }
  return {
    capabilities: async () => (await client.get('/api/process/capabilities', { timeout: 15000 })).data,
    status: () => get('/status'),
    catalog: destination_id => get('/catalog', { destination_id }),
    preview: payload => post('/preview', payload, 0),
    previewStatus: preview_id => {
      if (preview_id !== undefined && !backupPreviewIdentity(preview_id)) throw new Error('Invalid backup preview identity.')
      return get('/preview/status', preview_id ? { preview_id } : undefined)
    },
    cancelPreview: preview_id => {
      if (!backupPreviewIdentity(preview_id)) throw new Error('Invalid backup preview identity.')
      return post('/preview/' + encodeURIComponent(preview_id) + '/cancel', {}, 30000)
    },
    start: payload => post('/start', payload, 0),
    job: id => get(jobPath(id)),
    saveSchedule: async payload => (await client.put(base + '/schedule', payload, { timeout: 30000 })).data,
    restorePreview: payload => post('/restore/preview', payload, 0),
    restoreStart: payload => post('/restore/start', payload, 0),
    rollback: (id, confirmation) => post(jobPath(id) + '/rollback', { confirmation }),
  }
}
