import { backupStorageText } from './backupStorage.js'

export const installationBackupServicesSupported = capabilities => capabilities?.installation_backup === true
  && capabilities?.installation_backup_protocol === 1 && capabilities?.installation_backup_services === true
  && capabilities?.installation_backup_services_protocol === 1

export const backupServiceId = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\x00-\x1f\x7f]/.test(value) ? value : null
export const backupServiceIds = values => Array.isArray(values) && values.length > 0 && values.length <= 64
  && values.every(value => backupServiceId(value)) && new Set(values).size === values.length ? [...values].sort() : null

export const backupServiceChoices = response => {
  if (response?.protocol !== 1 || !Array.isArray(response.services)) throw new Error('DUMB did not confirm the available service backup choices. Refresh status before selecting services.')
  const seen = new Set()
  return response.services.map(service => {
    const id = backupServiceId(service?.id)
    const required = service?.required_service_ids === undefined || (Array.isArray(service.required_service_ids) && service.required_service_ids.length === 0) ? [] : backupServiceIds(service.required_service_ids)
    if (!id || seen.has(id) || !required || typeof service.name !== 'string' || !service.name.trim() || typeof service.available !== 'boolean' || !Array.isArray(service.blocking_reasons)) throw new Error('DUMB returned an unsupported service backup choice. Refresh status before selecting services.')
    seen.add(id)
    return { ...service, id, required_service_ids: required, name: backupStorageText(service.name), blocking_reasons: service.blocking_reasons.map(reason => backupStorageText(typeof reason === 'string' ? reason : reason?.message || '')).filter(Boolean) }
  })
}

export const backupScopeFields = (capabilities, scope = 'installation', serviceIds = []) => {
  if (!['installation', 'services'].includes(scope)) throw new Error('Choose the entire installation or selected services before continuing.')
  if (!Array.isArray(serviceIds)) throw new Error('Choose service instances from the available backup choices.')
  if (scope === 'installation') {
    if (serviceIds.length) throw new Error('Clear the selected services before choosing an entire installation backup.')
    return installationBackupServicesSupported(capabilities) ? { scope: 'installation', service_ids: [] } : {}
  }
  if (!installationBackupServicesSupported(capabilities)) throw new Error('This backend does not support individual-service backups and restores.')
  const ids = backupServiceIds(serviceIds)
  if (!ids) throw new Error('Select at least one available service instance before continuing.')
  return { scope: 'services', service_ids: ids }
}

export const backupScopeLabel = value => {
  const scope = value?.kind === 'services' ? value : value?.service_scope
  if (scope !== undefined && scope?.kind !== 'services' && scope?.kind !== 'installation') return 'Backup scope unavailable'
  if (scope?.kind !== 'services') return 'Entire DUMB installation'
  const names = Array.isArray(scope.services) ? scope.services.map(service => backupStorageText(service?.name || '')).filter(Boolean) : []
  if (names.length) return 'Services: ' + names.join(', ')
  const count = backupServiceIds(scope.service_ids)?.length
  return count ? `${count} selected service${count === 1 ? '' : 's'}` : 'Selected services'
}

export const backupScopeMatches = (request, response) => {
  const scope = response?.service_scope
  if (request.scope !== 'services') return scope === undefined || scope?.kind === 'installation'
  return scope?.kind === 'services' && JSON.stringify(backupServiceIds(request.service_ids)) === JSON.stringify(backupServiceIds(scope.service_ids))
}

export const backupServiceSelectionReady = (services, selected) => {
  const ids = backupServiceIds(selected)
  return Boolean(ids) && ids.every(id => services.some(service => service.id === id && service.available === true && service.blocking_reasons.length === 0 && (service.required_service_ids || []).every(required => ids.includes(required))))
}
