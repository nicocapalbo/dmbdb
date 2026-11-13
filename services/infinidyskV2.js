import axios from 'axios'

// These workflows never fall back to the v1 namespace or database endpoints.
export const infinidyskV2Repository = (client = axios) => {
  const base = '/api/process/infinidysk-v2'
  const get = async path => (await client.get(`${base}${path}`, { timeout: 15000 })).data
  // A transport timeout does not cancel the backend worker. The controller
  // reconciles durable status and never automatically repeats a mutation.
  const post = async (path, payload) => (await client.post(`${base}${path}`, payload, { timeout: 60000 })).data
  return {
    capabilities: async () => (await client.get('/api/process/capabilities', { timeout: 15000 })).data,
    status: () => get('/status'),
    preview: payload => post('/preview', payload),
    rehearse: payload => post('/rehearse', payload),
    start: payload => post('/start', payload),
    job: id => get(`/jobs/${encodeURIComponent(id)}`),
    report: async id => (await client.get(`${base}/jobs/${encodeURIComponent(id)}/report`, { timeout: 30000, responseType: 'text' })).data,
    rollback: payload => post('/rollback', payload),
    cancel: payload => post('/cancel', payload),
    retryConsumers: payload => post('/retry-consumers', payload),
    finishConsumerRecovery: payload => post('/finish-consumer-recovery', payload),
    cleanupPreview: payload => post('/cleanup/preview', payload),
    cleanup: payload => post('/cleanup', payload),
    postgresStatus: () => get('/postgres/status'),
    postgresPreview: payload => post('/postgres/preview', payload),
    postgresStart: payload => post('/postgres/start', payload),
    postgresCutover: payload => post('/postgres/cutover', payload),
    postgresCancel: payload => post('/postgres/cancel', payload),
    postgresRollback: payload => post('/postgres/rollback', payload),
  }
}
