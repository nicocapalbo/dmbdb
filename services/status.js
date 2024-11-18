export const statusRepository = () => ({
  async getHealthCheck() {
    return await fetch(`http://miniserver:8123/health`, { method:'GET' })
  },
  async getServiceStatus(serviceId) {
    return await fetch(`http://miniserver:8123/service-status/${serviceId}`, { method:'GET' })
  },
  async startService(options) {
    return await fetch(`http://miniserver:8123/start-service`, {
      method:'POST',
      headers: {
        'Content-Type': 'application/json', // Specify the correct content type
      },
      ...options
    })
  },
  async stopService(options) {
    return await fetch(`http://miniserver:8123/stop-service`, {
      method:'POST',
      headers: {
        'Content-Type': 'application/json', // Specify the correct content type
      },
      ...options
    })
  },
  async restartService(options) {
    return await fetch(`http://miniserver:8123/restart-service`, {
      method:'POST',
      headers: {
        'Content-Type': 'application/json', // Specify the correct content type
      },
      ...options })
  }
})
