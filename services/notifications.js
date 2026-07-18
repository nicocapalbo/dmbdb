import axios from 'axios'

export default () => ({
  async getConfig() {
    const { data } = await axios.get('/api/notifications/config')
    return data
  },
  async updateConfig(config) {
    const { data } = await axios.post('/api/notifications/config', { config })
    return data
  },
  async getEvents() {
    const { data } = await axios.get('/api/notifications/events')
    return data
  },
  async testDestination(destinationId, title, body) {
    const { data } = await axios.post('/api/notifications/test', {
      destination_id: destinationId,
      title,
      body,
    })
    return data
  },
  async sendManual(payload) {
    const { data } = await axios.post('/api/notifications/send', payload)
    return data
  },
  async getHistory(params = {}) {
    const { data } = await axios.get('/api/notifications/history', { params })
    return data
  },
  async clearHistory() {
    const { data } = await axios.delete('/api/notifications/history')
    return data
  },
})
