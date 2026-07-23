import axios from "axios";

export const aiRepository = () => ({
  async getSettings() {
    const { data } = await axios.get('/api/ai/settings')
    return data
  },
  async updateSettings(updates) {
    const { data } = await axios.put('/api/ai/settings', updates)
    return data
  },
  async getPresets() {
    const { data } = await axios.get('/api/ai/presets')
    return data
  },
  async testProvider(payload) {
    const { data } = await axios.post('/api/ai/test', payload)
    return data
  },
  async listModels(payload) {
    const { data } = await axios.post('/api/ai/models', payload)
    return data
  },
  async diagnose(payload) {
    const { data } = await axios.post('/api/ai/diagnose', payload)
    return data
  },
  async diagnoseStack(payload) {
    const { data } = await axios.post('/api/ai/diagnose-stack', payload)
    return data
  },
  async followUp(payload) {
    const { data } = await axios.post('/api/ai/follow-up', payload)
    return data
  }
})
