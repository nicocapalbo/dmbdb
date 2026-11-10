export const SETUP_RUN_STORAGE_KEY = 'dumb.setup.run'
export const setupIsRunning = run => ['pending', 'running'].includes(run?.status)
export const setupNeedsAttention = run => Boolean(run && run.status !== 'complete')
export const setupAutomationLabel = value => ({
  automatic: 'Automatic', after_input: 'Automatic after input', manual: 'Manual configuration',
  unsupported: 'Unsupported', unknown: 'Needs review',
}[value] || 'Needs review')

export function safeSetupLink(value) {
  if (typeof value !== 'string' || !value.trim()) return ''
  if (value.startsWith('/') && !value.startsWith('//') && !/[\\\\\u0000-\u0020]/.test(value)) return value
  try {
    const parsed = new URL(value)
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''
  } catch { return '' }
}

export function setupActionMatchesService(action, serviceKey, instanceKey = '') {
  if (!serviceKey) return true
  const instanceName = value => String(value || '').startsWith(serviceKey + '.')
    ? String(value).slice(serviceKey.length + 1) : String(value || '')
  const endpointMatches = (endpoint, fallbackService = '', fallbackInstance = '') => {
    const record = endpoint && typeof endpoint === 'object' ? endpoint : {}
    const identity = String(record.resource_id || record.id || record.key || (typeof endpoint === 'string' ? endpoint : '') || fallbackService)
    const family = record.service_key || identity.split('.')[0] || fallbackService
    if (family !== serviceKey) return false
    if (!instanceKey) return true
    const endpointInstance = record.instance_key || (identity.startsWith(family + '.') ? identity.slice(family.length + 1) : fallbackInstance)
    return !endpointInstance || instanceName(endpointInstance) === instanceName(instanceKey)
  }
  return endpointMatches(action.source, action.service_key, action.instance_key)
    || endpointMatches(action.target, action.target_service_key, action.target_instance_key)
}

export function setupCoverageText(coverage = {}) {
  // Show backend-defined counts; never infer completion from a service count.
  const entries = []
  if (Number.isFinite(coverage.denominator)) {
    const total = coverage.denominator
    for (const [key, label] of [['automatic', 'Automatic'], ['after_input', 'Automatic after input'], ['manual', 'Manual'], ['applied', 'Applied'], ['verified', 'Verified']]) {
      if (Number.isFinite(coverage[key])) entries.push(label + ': ' + coverage[key] + ' / ' + total)
    }
    for (const [key, label] of [['unknown', 'Needs review'], ['unsupported', 'Unsupported']]) {
      if (Number.isFinite(coverage[key]) && coverage[key] > 0) entries.push(label + ': ' + coverage[key] + ' / ' + total)
    }
    return entries
  }
  for (const [key, label] of [['automation', 'Automatic'], ['applied', 'Applied'], ['verified', 'Verified']]) {
    const item = coverage[key]
    if (item && Number.isFinite(item.count) && Number.isFinite(item.total)) entries.push(label + ': ' + item.count + ' / ' + item.total)
  }
  return entries
}

export function setupErrorText(error, fallback = 'Setup request failed. Try again.') {
  const detail = error?.response?.data?.detail
  // Structured validation errors can contain credential-bearing request inputs.
  return typeof detail === 'string' ? detail : fallback
}

export function sanitizeSetupPreview(value, key = '') {
  if (/(?:password|passwd|secret|token|api[_-]?key|debrid[_-]?key|claim)/i.test(key) && value !== '' && value != null) return '[configured]'
  if (Array.isArray(value)) return value.map(item => sanitizeSetupPreview(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, sanitizeSetupPreview(item, name)]))
  return value
}

// Public status responses contain presence markers, never reusable credentials.
export function editableSetupChoices(value) {
  if (typeof value === 'string' && /^\[configured(?: URL)?\]$/.test(value)) return undefined
  if (Array.isArray(value)) return value.map(editableSetupChoices)
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, editableSetupChoices(child)]).filter(([, child]) => child !== undefined),
  )
  return value
}

export const setupRunStatusLabel = status => ({
  pending: 'Waiting to start', running: 'Applying setup', waiting_input: 'Needs your input',
  partial: 'Setup needs attention', complete: 'Setup actions completed',
  failed: 'Setup failed', interrupted: 'Setup interrupted',
}[status] || status || 'Unknown')

export function setupChoiceLines(field, value) {
  if (value === undefined || value === null || value === '') return []
  if (setupFieldIsSecret(field) || value === '[configured]') return ['Configured']
  const label = choice => (field.options || []).find(option => String(option.value) === String(choice))?.label || String(choice)
  if (field.type === 'multiselect') return value.length ? value.map(label) : ['No connections selected']
  if (field.type === 'object' || field.type === 'list') {
    const fields = setupNestedFields(field)
    const describe = row => fields.filter(child => setupFieldVisible(child, row, fields)).flatMap(child =>
      setupChoiceLines(child, setupFieldValue(child, row)).map(line => (child.label || child.key) + ': ' + line))
    return field.type === 'list'
      ? (Array.isArray(value) ? value : []).flatMap((row, index) => describe(row).map(line => (field.item_label || 'Entry') + ' ' + (index + 1) + ' · ' + line))
      : describe(value && typeof value === 'object' ? value : {})
  }
  if (field.type === 'libraries') return value.map(library => [
    library.name, library.media_type,
    ...(library.paths || []),
    library.create_if_missing ? 'Create only if missing' : 'Reuse an existing library',
    library.create_if_missing && library.scan_on_create === true ? 'Scan after creating this library' : '',
  ].filter(Boolean).join(' · '))
  if (field.type === 'nntp_providers') return value.map(provider => [
    provider.name || 'Usenet provider', provider.host, provider.port ? 'Port ' + provider.port : '',
    provider.tls === false ? 'TLS disabled' : 'TLS enabled',
    provider.connections ? provider.connections + ' connections' : '',
    provider.account_connection_limit ? 'Account limit ' + provider.account_connection_limit : '',
  ].filter(Boolean).join(' · '))
  if (field.type === 'external_service') return [
    [value.service_key, value.url === '[configured URL]' ? 'Configured URL' : value.url, value.verify_tls === false ? 'TLS verification disabled' : 'TLS verification enabled'].filter(Boolean).join(' · '),
  ]
  if (field.type === 'boolean') return [value ? 'Yes' : 'No']
  return [label(value)]
}

export const setupFieldIsSecret = field => field.secret === true || field.type === 'password' || /password|passwd|secret|token|api[_-]?key|debrid[_-]?key|claim/i.test(field.key || '')
export const setupFieldValue = (field, values = {}) => field.readonly !== true && Object.prototype.hasOwnProperty.call(values, field.key)
  ? values[field.key] : setupFieldIsSecret(field) ? undefined : setupSafeDefault(field.default ?? field.default_value, setupNestedFields(field))
export const setupNestedFields = field => field.type === 'list' ? field.item_fields || [] : field.fields || []
function setupSafeDefault(value, fields = []) {
  if (Array.isArray(value)) return value.map(item => setupSafeDefault(item, fields))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    const child = fields.find(field => field.key === key) || { key }
    return setupFieldIsSecret(child) ? [] : [[key, setupSafeDefault(item, setupNestedFields(child))]]
  }))
  return value
}
export function setupDefaultValues(fields = []) {
  return Object.fromEntries(fields.filter(field => !setupFieldIsSecret(field)).flatMap(field => {
    const value = setupFieldValue(field)
    return value === undefined || value === null ? [] : [[field.key, structuredClone(value)]]
  }))
}

export function setupFieldVisible(field, values = {}, fields = []) {
  const condition = field.visible_when
  if (!condition) return true
  const dependency = fields.find(item => item.key === condition.key) || { key: condition.key }
  const value = setupFieldValue(dependency, values) ?? condition.default
  if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return value === condition.equals
  if (Object.prototype.hasOwnProperty.call(condition, 'not_equals')) return value !== condition.not_equals
  return true
}

export const setupActionStateLabel = value => ({
  planned: 'Not applied', pending: 'Waiting', running: 'In progress',
  waiting_input: 'Needs your input', waiting_dependency: 'Waiting for a dependency',
  applied: 'Applied', already_present: 'Already configured', passed: 'Passed',
  unchecked: 'Not checked', not_checked: 'Not checked', unavailable: 'No automatic check',
  failed: 'Failed', skipped: 'Skipped', deferred: 'Deferred', interrupted: 'Interrupted',
  not_applicable: 'Not required', unsupported: 'Unsupported', unknown: 'Unknown',
}[value] || String(value || 'Unknown').replaceAll('_', ' '))

export const setupCheckLabel = check => check?.ok === true ? 'Passed'
  : check?.ok === false ? (check.critical ? 'Blocking issue' : 'Warning') : 'Not verified'

export function setupLibraryOptions(field) {
  const service = field.service_key || String(field.key || '').split('::')[0].split('.')[0]
  const fallback = service === 'audiobookshelf' ? ['book', 'podcast']
    : service === 'plex' ? ['movie', 'show', 'music']
      : ['movie', 'show', 'music', 'book', 'mixed']
  return (field.media_types || fallback).map(item => typeof item === 'object' ? item : { value: item, label: item })
}
export function setupLibrarySupportsLanguage(field) {
  return field.supports_language ?? (field.service_key || String(field.key || '').split('::')[0]) !== 'audiobookshelf'
}

// Seed only advertised connection choices. Preserve any deliberate user override.
export function guidedMediaChoices(fields, values, intent, previousDefaults = {}) {
  const selected = intent?.mediaServer
  if (!['plex', 'jellyfin', 'emby', 'external', 'none'].includes(selected)) return { values, defaults: previousDefaults }
  const next = { ...values }
  const defaults = { ...previousDefaults }
  for (const field of fields) {
    if (field.type !== 'connection' || !field.key.endsWith('::media_server')) continue
    if (!['seerr', 'pulsarr', 'maintainerr', 'tautulli', 'aiostreams'].includes(field.service_key || field.key.split('.')[0].split('::')[0])) continue
    const option = (field.options || []).find(option => option.value === selected)
    if (!option) continue
    if (!Object.prototype.hasOwnProperty.call(values, field.key) || values[field.key] === previousDefaults[field.key]) {
      next[field.key] = selected
      defaults[field.key] = selected
    }
  }
  return { values: next, defaults }
}

export function setupActionFields(action, fields) {
  const keys = new Set((action.input_fields || action.input_keys || action.missing_inputs || []).map(input => typeof input === 'string' ? input : input.key))
  // A conditional input still needs its advertised controlling choice when an
  // older action supplies only the missing field keys.
  let changed = true
  while (changed) {
    changed = false
    for (const field of fields) {
      const dependency = field.visible_when?.key
      if (keys.has(field.key) && dependency && !keys.has(dependency) && fields.some(item => item.key === dependency)) {
        keys.add(dependency)
        changed = true
      }
    }
  }
  return fields.filter(field => keys.has(field.key))
}

export function setupAdoptionKeys(action) {
  const source = typeof action.source === 'string' ? action.source : action.source?.resource_id || action.source?.id || action.service_key
  return { consent: source + '::adopt_existing', preview: source + '::adoption_preview_id' }
}

export function setupChangeValue(change, value) {
  if (change.secret === true || setupFieldIsSecret({ key: change.field })) return value == null || value === '' ? 'Not configured' : 'Hidden credential'
  const safe = (item, key = '') => {
    if (setupFieldIsSecret({ key }) && item != null && item !== '') return '[hidden]'
    if (Array.isArray(item)) return item.map(child => safe(child))
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([name, child]) => [name, safe(child, name)]))
    if (typeof item === 'string' && /^https?:\/\//i.test(item)) {
      try { const url = new URL(item); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.href } catch { return 'Configured endpoint' }
    }
    return item
  }
  const result = safe(value)
  return result == null || result === '' ? 'Not configured' : typeof result === 'object' ? JSON.stringify(result) : String(result)
}

export const setupPreviewNeedsConsent = action => action.evidence?.requires_consent === true || (action.evidence?.changes || []).some(change => change.requires_consent === true)

const setupTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
})
export function setupTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) return null
  const date = new Date(milliseconds)
  return { datetime: date.toISOString(), text: setupTimeFormatter.format(date) }
}
const setupRetryCancelled = run => run?.cancel_requested === true || run?.status === 'abandoned'
export function setupActionTiming(action, run = {}) {
  return {
    checked: setupTimestamp(action.checked_at),
    retry: !setupRetryCancelled(run) && action.retryable === true && !action.retry_exhausted
      ? setupTimestamp(action.next_retry_at) : null,
    attempts: Number.isSafeInteger(action.attempts) && action.attempts > 0 ? action.attempts : null,
  }
}
export function setupRefreshDelay(run, now = Date.now()) {
  if (!run || setupRetryCancelled(run)) return null
  if (setupIsRunning(run)) return 3000
  const retry = setupTimestamp(run.next_retry_at)
  if (!retry) return null
  const remaining = Date.parse(retry.datetime) - now
  // A retained overdue deadline or clock skew must not create a tight GET loop.
  return remaining <= 0 ? 5000 : Math.min(30000, Math.max(1000, remaining + 200))
}
