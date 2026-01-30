import axios from "axios";

export const seerrSyncRepository = () => ({
  async getStatus() {
    const { data } = await axios.get('/api/seerr-sync/status')
    return data
  },
  async getFailed() {
    const { data } = await axios.get('/api/seerr-sync/failed')
    return data
  },
  async getState() {
    const { data } = await axios.get('/api/seerr-sync/state')
    return data
  },
  async clearFailed(fingerprint = null) {
    const params = {}
    if (fingerprint) params.fingerprint = fingerprint
    const { data } = await axios.delete('/api/seerr-sync/failed', { params })
    return data
  },
  async testConnection(url, api_key) {
    const { data } = await axios.post('/api/seerr-sync/test', { url, api_key })
    return data
  }
})
