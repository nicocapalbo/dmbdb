import axios from "axios";

export const logsRepository = () => ({
  async fetchServiceLogs(processName) {
    try {
      const response = await axios.get(`/api/logs`, {
        params: { process_name: processName },
      });
      return response.data.log || "No logs available.";
    } catch (error) {
      throw error.response || error;
    }
  }
})
