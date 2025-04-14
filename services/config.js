import axios from "axios";
import yaml from "js-yaml";

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
      const requestData = {
        service_name: serviceName,
      };
      if (configFormat === "rclone" || configFormat === "python" || configFormat === "postgresql") {
        requestData.updates = updates;
      } else if (configFormat === "yaml") {
        requestData.updates = yaml.load(updates);
      } else if (configFormat === "json") {
        requestData.updates = JSON.parse(updates);
      } else {
        requestData.updates = updates;
      }
      const response = await axios.post(`/api/config/service-config`, requestData);
      return response.data;
    } catch (error) {
      throw error.response || error;
    }
  },
  async updateDMBConfig(processName, updates, persist = false){
    try {
      const response = await axios.post(`/api/config/update-dmb-config`, {
        process_name: processName,
        updates,
        persist,
      });
      return response.data;
    } catch (error) {
      throw error.response || error;
    }
  },
})
