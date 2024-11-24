export const statusRepository = () => {
  const apiBaseUrl = `${window.location.origin}/api`;
  return {
    async getServiceStatus(serviceId) {
      return await fetch(`${apiBaseUrl}/service-status/${serviceId}`, {
        method: 'GET',
      });
    },
    async startService(body) {
      return await fetch(`${apiBaseUrl}/start-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },
    async stopService(body) {
      return await fetch(`${apiBaseUrl}/stop-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },
    async restartService(body) {
      return await fetch(`${apiBaseUrl}/restart-service`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    },
    async checkHealth() {
      return await fetch(`${apiBaseUrl}/health`, {
        method: 'GET',
      });
    },
  };
};

