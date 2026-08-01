import axios from "axios";

export const logsRepository = () => ({
  async fetchServiceLogs(processName, params) {
    const qp = { process_name: processName }
    if (params && typeof params.cursor === 'number') qp.cursor = params.cursor
    if (params && typeof params.tail_bytes === 'number') qp.tail_bytes = params.tail_bytes
    if (params && typeof params.file_id === 'string') qp.file_id = params.file_id

    const { data } = await axios.get('/api/logs', { params: qp })

    const legacyMode = !params
    if (legacyMode) {
      // Prefer full snapshot if present; fall back to chunk
      if (typeof data?.log === 'string') return data.log
      if (typeof data?.chunk === 'string') return data.chunk
      return ''
    }
    return data
  }
})
