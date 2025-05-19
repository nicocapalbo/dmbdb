import axios from "axios";

export const configRepository =() => ({
  async fetchServiceConfig(serviceName){
    try {
      const response = await axios.post(`/api/config/service-config`, {
        service_name: serviceName,
      });
      return response.data;
    } catch (error) {
      throw error.response || error;
    }
  },
  async updateServiceConfig(serviceName, updates, configFormat){
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
  async updateDMBConfig(processName, updates, persist = false){
    try {
      const payload = {
        process_name: processName,
        updates,
        persist
      }
      const response = await axios.post(`/api/config/update-dmb-config`, payload);
      return response.data;
    } catch (error) {
      throw error.response || error;
    }
  },
})
