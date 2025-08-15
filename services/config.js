import axios from "axios";

export const configRepository = () => ({
  async fetchServiceConfig(serviceName) {
    try {
      const response = await axios.post(`/api/config/service-config`, {
        service_name: serviceName,
      });
      return response.data;
    } catch (error) {
      throw error.response || error;
    }
  },
  async updateServiceConfig(serviceName, updates, configFormat) {
    try {
      const payload = {
        service_name: serviceName,
        updates: updates,
        config_format: configFormat
      };
      const response = await axios.post(`/api/config/service-config`, payload);
      return response.data;
    } catch (error) {
      throw error.response || error;
    }
  },
  async getOnboardingStatus() {
    const { data } = await axios.get('/api/config/onboarding-status');
    return data.needs_onboarding;
  },
  async setOnboardingComplete() {
    const { data } = await axios.post('/api/config/onboarding-completed');
    return data;
  },
  async resetOnboarding() {
    const { data } = await axios.post('/api/config/reset-onboarding');
    return data;
  },
  async getConfig() {
    const { data } = await axios.get('/api/config/');
    return data;
  },
  async updateConfig(processName, updates, persist = false) {
    try {
      const payload = {
        process_name: processName,
        updates,
        persist
      }
      const response = await axios.post(`/api/config/`, payload);
      return response.data;
    } catch (error) {
      throw error.response || error;
    }
  },
  async getConfigSchema() {
    const { data } = await axios.get('/api/config/schema');
    return data;
  },
  async getProcessConfigSchema(processName) {
    const { data } = await axios.post('/api/config/process-config/schema', {
      process_name: processName,
    });
    return data;
  },
})
