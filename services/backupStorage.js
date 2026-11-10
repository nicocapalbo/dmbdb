import axios from 'axios'

export const backupStorageRepository = (client = axios) => {
  const base = '/api/process/backup-storage'
  const post = async (path, payload) => (await client.post(`${base}${path}`, payload, { timeout: 60000 })).data
  return {
    catalog: async () => (await client.get(base, { timeout: 15000 })).data,
    preview: payload => post('/preview', payload),
    save: payload => post('/profiles', payload),
    setDefault: destination_id => post('/default', { destination_id }),
  }
}
