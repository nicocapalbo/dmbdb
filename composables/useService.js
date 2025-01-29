import axios from "axios";
import yaml from "js-yaml";
  
export default function useService() {
  const apiUrl = '/api';

  const fetchProcesses = async () => {
    const response = await axios.get(`${apiUrl}/process/processes`);
    return response.data.processes;
  };

  const fetchProcessStatus = async (processName) => {
    const response = await axios.get(`${apiUrl}/process/service-status`, {
      params: { process_name: processName },
    });
    return response.data.status;
  };

  const startProcess = async (processName) => {
    const response = await axios.post(`${apiUrl}/process/start-service`, {
      process_name: processName,
    });
    return response.data;
  };

  const stopProcess = async (processName) => {
    const response = await axios.post(`${apiUrl}/process/stop-service`, {
      process_name: processName,
    });
    return response.data;
  };

  const restartProcess = async (processName) => {
    const response = await axios.post(`${apiUrl}/process/restart-service`, {
      process_name: processName,
    });
    return response.data;
  };

  const fetchServiceConfig = async (serviceName) => {
    try {
      const response = await axios.post(`${apiUrl}/config/service-config`, {
        service_name: serviceName,
      });
      return response.data;
    } catch (error) {
      throw error.response || error;
    }
  };

  const updateServiceConfig = async (serviceName, updates, configFormat) => {
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
          const response = await axios.post(`${apiUrl}/config/service-config`, requestData);
          return response.data;
      } catch (error) {
          throw error.response || error;
      }
  };

  const updateDMBConfig = async (processName, updates, persist = false) => {
    try {
      const response = await axios.post(`${apiUrl}/config/update-dmb-config`, {
        process_name: processName,
        updates,
        persist,
      });
      return response.data;
  } catch (error) {
      throw error.response || error;
    }
  };

  return {
    fetchProcesses,
    fetchProcessStatus,
    startProcess,
    stopProcess,
    restartProcess,
    fetchServiceConfig,
    updateServiceConfig,
    updateDMBConfig,
  };
}