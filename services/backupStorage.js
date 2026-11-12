import axios from 'axios'

export const backupStorageRepository = (client = axios) => {
  const base = '/api/process/backup-storage'
  const post = async (path, payload) => (await client.post(`${base}${path}`, payload, { timeout: 60000 })).data
  return {
    catalog: async () => (await client.get(base, { timeout: 15000 })).data,
    preview: payload => post('/preview', payload),
    save: payload => post('/profiles', payload),
    setDefault: destination_id => post('/default', { destination_id }),
    update: async (id, payload) => (await client.put(`${base}/profiles/${encodeURIComponent(id)}`, payload, { timeout: 60000 })).data,
    remove: async id => (await client.delete(`${base}/profiles/${encodeURIComponent(id)}`, { timeout: 60000 })).data,
    check: id => post(`/profiles/${encodeURIComponent(id)}/check`, {}),
    revalidationPreview: id => post(`/profiles/${encodeURIComponent(id)}/revalidate/preview`, {}),
    revalidate: (id, payload) => post(`/profiles/${encodeURIComponent(id)}/revalidate`, payload),
  }
}
