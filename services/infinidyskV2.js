import axios from 'axios'

// These workflows never fall back to the v1 namespace or database endpoints.
export const infinidyskV2Repository = (client = axios) => {
  const base = '/api/process/infinidysk-v2'
  const get = async path => (await client.get(`${base}${path}`, { timeout: 15000 })).data
  // A transport timeout does not cancel the backend worker. The controller
  // reconciles durable status and never automatically repeats a mutation.
  const post = async (path, payload, timeout = 60000) => (await client.post(`${base}${path}`, payload, { timeout })).data
  return {
    capabilities: async () => (await client.get('/api/process/capabilities', { timeout: 15000 })).data,
    status: () => get('/status'),
    // Legacy previews can inventory a large library. Modern backends use the
    // short admission + polling API; neither path imposes a total scan deadline.
    preview: payload => post('/preview', payload, 0),
    previewStart: payload => post('/preview/start', payload, 30000),
    previewTask: id => {
      if (id !== undefined && (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) throw new Error('Invalid migration preview task identity.')
      return get('/preview/task' + (id ? '/' + encodeURIComponent(id) : ''))
    },
    cancelPreview: id => {
      if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid migration preview task identity.')
      return post('/preview/task/' + encodeURIComponent(id) + '/cancel', {}, 30000)
    },
    prepare: payload => post('/prepare', payload),
    activate: payload => post('/activate', payload),
    rehearse: payload => post('/rehearse', payload),
    start: payload => post('/start', payload),
    job: id => get(`/jobs/${encodeURIComponent(id)}`),
    report: async id => (await client.get(`${base}/jobs/${encodeURIComponent(id)}/report`, { timeout: 30000, responseType: 'text' })).data,
    rollback: payload => post('/rollback', payload),
    cancel: payload => post('/cancel', payload),
    retryStage: payload => post('/retry-stage', payload),
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
